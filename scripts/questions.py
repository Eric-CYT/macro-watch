"""
每日推敲提問生成器。
預設：規則式（免費、可重現）——找出 z-score 最大的異動、違反常見相關性的背離、以及當日事件/新聞主題。
選用：若設定環境變數 GEMINI_API_KEY（Google AI Studio 免費額度），改由 LLM 依同樣的事實改寫問題；失敗自動退回規則式。
"""
from __future__ import annotations

import json
import os
import statistics
from collections import Counter

import requests

# 預期相關方向：+1 同向，-1 反向
PAIRS = [
    ("dxy", "btc", -1, "美元強弱 vs 加密資產"),
    ("us10y", "sox", -1, "長端利率 vs 半導體估值"),
    ("vix", "spx", -1, "恐慌指數 vs 大盤"),
    ("usdtwd", "taiex", -1, "新台幣匯率 vs 台股（外資流向）"),
    ("sox", "taiex", 1, "費半 vs 台股（隔夜連動）"),
    ("us10y", "gold", -1, "利率 vs 黃金"),
    ("copper", "us10y", 1, "銅（景氣） vs 長端利率"),
    ("hy", "spx", -1, "信用利差 vs 大盤"),
    ("usdjpy", "spx", 1, "日圓套息 vs 風險資產"),
]

HINTS = {
    "dxy": "拆解美元：是歐元弱（佔 57.6%）還是普遍性美元強？對照 US02Y 看是不是利差驅動。",
    "us10y": "先分辨是實質利率還是通膨預期推升；對照 2Y 判斷是 bear steepener 還是 bear flattener。",
    "us02y": "2Y 最貼近 Fed 路徑：對照 FedWatch 的降息機率變化，確認市場是否在重新定價政策。",
    "btc": "確認是現貨 ETF 資金、槓桿清算還是美元流動性驅動；對照 DXY 與 VIX 是否同步。",
    "vix": "VIX 上升但大盤沒跌，常是避險需求提前；留意期限結構（VIX vs VIX3M）是否倒掛。",
    "usdjpy": "日圓急升時看 BOJ 發言、美日利差（US02Y vs JGB 2Y）與日股是否同步下跌。",
    "taiex": "台股約五成以上權重在半導體：先看台積電與費半隔夜表現，再看外資買賣超與新台幣。",
    "sox": "區分是基本面（財報/指引）還是利率估值壓縮；看龍頭與二線股是否同向。",
    "copper": "銅反映全球製造業與中國需求；對照 ISM 與中國數據，確認是需求還是供給事件。",
    "gold": "黃金與實質利率常反向；若同漲，可能是避險或央行買盤主導。",
    "wti": "油價牽動通膨預期：對照 10Y 損益平衡通膨率與能源股反應。",
    "spx": "看市場寬度：是少數權值股撐盤還是普漲？對照等權重指數。",
    "hy": "信用利差擴大通常領先股市；看是否集中在能源或特定產業。",
    "usdtwd": "新台幣貶值常伴隨外資匯出；對照集中市場外資買賣超與央行動作。",
    "spread": "殖利率曲線由負轉正（解除倒掛）歷史上常出現在衰退前後，關鍵是由短端下跌還是長端上升造成。",
}

NAMES = {
    "dxy": "美元指數 DXY", "us10y": "美債10年殖利率", "us02y": "美債2年殖利率", "btc": "比特幣",
    "vix": "VIX", "usdjpy": "USD/JPY", "taiex": "台股加權指數", "sox": "費城半導體 SOX",
    "copper": "銅", "gold": "黃金", "wti": "WTI 原油", "spx": "S&P 500", "hy": "高收益債利差",
    "usdtwd": "USD/TWD", "spread": "10Y-2Y 利差",
}


def _changes(series, n=61):
    vals = [v for _, v in series[-n:]]
    return [b - a for a, b in zip(vals, vals[1:])] if len(vals) > 2 else []


def _is_rate(k):
    return k in ("us10y", "us02y", "hy", "spread")


def moves(metrics: dict):
    """回傳每個資產今日變動、z-score（相對近 60 日日變動標準差）"""
    out = {}
    for k, m in metrics.items():
        s = m.get("history") or []
        if len(s) < 25 or k not in NAMES:
            continue
        if _is_rate(k):
            chg = [c * 100 for c in _changes(s)]  # bp
            today = (s[-1][1] - s[-2][1]) * 100
            unit = "bp"
        else:
            vals = [v for _, v in s[-61:]]
            chg = [(b / a - 1) * 100 for a, b in zip(vals, vals[1:]) if a]
            today = (s[-1][1] / s[-2][1] - 1) * 100
            unit = "%"
        sd = statistics.pstdev(chg[:-1]) if len(chg) > 5 else 0
        z = today / sd if sd else 0
        out[k] = {"chg": round(today, 2), "unit": unit, "z": round(z, 2), "date": s[-1][0]}
    return out


def _fmt(k, mv):
    sign = "+" if mv["chg"] >= 0 else ""
    return f"{NAMES[k]} {sign}{mv['chg']}{mv['unit']}（{abs(mv['z']):.1f} 個標準差）"


def rule_questions(metrics, news_items, events):
    mv = moves(metrics)
    ranked = sorted(mv, key=lambda k: abs(mv[k]["z"]), reverse=True)
    qs = []

    # Q1：最大異動
    if ranked:
        k = ranked[0]
        up = mv[k]["chg"] >= 0
        verb = "走高" if up else "走低"
        qs.append({
            "text": f"今天波動最大的是 {_fmt(k, mv[k])}。你認為這次{verb}是由什麼驅動？它是一次性的消息衝擊，還是趨勢的延續？其他資產有沒有『確認』這個訊號？",
            "hint": HINTS.get(k, ""), "assets": [k], "type": "mover",
        })

    # Q2：最強的相關性背離
    best = None
    for a, b, sign, label in PAIRS:
        if a in mv and b in mv:
            za, zb = mv[a]["z"], mv[b]["z"]
            if abs(za) < 0.8 or abs(zb) < 0.5:
                continue
            violation = za * zb * sign  # 負值 = 違反預期
            if violation < 0 and (best is None or violation < best[0]):
                best = (violation, a, b, sign, label)
    if best:
        _, a, b, sign, label = best
        rel = "反向" if sign < 0 else "同向"
        qs.append({
            "text": f"背離訊號（{label}）：{_fmt(a, mv[a])}，但 {_fmt(b, mv[b])}。兩者平常多為{rel}，今天卻不是。你認為是市場已提前定價、有其他資金在承接，還是其中一方的訊號是雜訊？",
            "hint": f"{HINTS.get(a, '')} {HINTS.get(b, '')}".strip(), "assets": [a, b], "type": "divergence",
        })

    # Q3：事件日 / 新聞主題
    if events:
        ev = "、".join(events)
        assets = ranked[:3]
        qs.append({
            "text": f"今天是 {ev} 事件日。結合 {', '.join(NAMES[k] for k in assets)} 的反應，市場解讀偏鷹還是偏鴿？這個反應和你事前的預期一致嗎？若不一致，你漏看了什麼？",
            "hint": "事件日的『第一反應』常在隔日被修正：記下今天的收盤位置，明天回頭驗證。", "assets": assets, "type": "event",
        })
    else:
        c = Counter(t for n in news_items[:60] for t in n.get("tags", []))
        if c:
            topic, cnt = c.most_common(1)[0]
            heads = [n["title"] for n in news_items if topic in n.get("tags", [])][:2]
            qs.append({
                "text": f"今天新聞焦點集中在「{topic}」（{cnt} 則），例如：「{heads[0]}」。這個主題有反映在價格上嗎？哪個資產的反應最不合理？",
                "hint": "新聞多但價格不動 = 已定價或不重要；新聞少但價格大動 = 可能有你沒看到的資訊。", "assets": [], "type": "news",
            })

    # 補足到 3 題
    for k in ranked[1:]:
        if len(qs) >= 3:
            break
        if any(k in q["assets"] for q in qs):
            continue
        qs.append({
            "text": f"{_fmt(k, mv[k])}。如果這個走勢再延續一週，你的部位或觀察清單中哪一項會最先受影響？你會怎麼調整？",
            "hint": HINTS.get(k, ""), "assets": [k], "type": "mover",
        })
    while len(qs) < 3:
        qs.append({"text": "今天市場相對平靜。回顧本週，哪一個宏觀變數的變化最讓你意外？為什麼？",
                   "hint": "平靜日適合檢查假設：列出你目前的核心看法，以及什麼數據會推翻它。", "assets": [], "type": "calm"})
    return qs[:3], mv


def llm_questions(base_qs, mv, news_items, events):
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        return None
    model = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
    facts = {
        "moves": mv, "events": events,
        "headlines": [n["title"] for n in news_items[:15]],
        "draft_questions": [q["text"] for q in base_qs],
    }
    prompt = (
        "你是資深總經交易員教練。根據以下『已驗證的事實』（不可捏造任何數字），用繁體中文產出 3 個推敲型問題，"
        "每題附一句重點提示。只輸出 JSON：[{\"text\":...,\"hint\":...}]。\n" + json.dumps(facts, ensure_ascii=False)
    )
    try:
        r = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
            params={"key": key},
            json={"contents": [{"parts": [{"text": prompt}]}],
                  "generationConfig": {"responseMimeType": "application/json", "temperature": 0.6}},
            timeout=60,
        )
        txt = r.json()["candidates"][0]["content"]["parts"][0]["text"]
        arr = json.loads(txt)
        out = []
        for i, q in enumerate(arr[:3]):
            out.append({**base_qs[i], "text": q["text"], "hint": q.get("hint", base_qs[i]["hint"]), "llm": True})
        return out if len(out) == 3 else None
    except Exception:  # noqa: BLE001
        return None


def generate(metrics, news_items, events):
    qs, mv = rule_questions(metrics, news_items, events)
    llm = llm_questions(qs, mv, news_items, events)
    return (llm or qs), mv, ("llm" if llm else "rules")
