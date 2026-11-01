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
        "你是資深總經交易員教練。根據以下『已驗證的事實』（不可捏造任何數字），"
        f"用繁體中文產出 {len(base_qs)} 個推敲型問題（後 3 題須圍繞跨資產資金流向），"
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
        for i, q in enumerate(arr[:len(base_qs)]):
            out.append({**base_qs[i], "text": q["text"], "hint": q.get("hint", base_qs[i]["hint"]), "llm": True})
        return out if len(out) == len(base_qs) else None
    except Exception:  # noqa: BLE001
        return None


def generate(metrics, news_items, events):
    qs, mv = rule_questions(metrics, news_items, events)
    fq, _ = flow_questions(metrics)
    base = qs + fq
    llm = llm_questions(base, mv, news_items, events)
    return (llm or base), mv, ("llm" if llm else "rules")


# ====================================================================== 資金流向題（第 4–6 題）
# 與前端「跨資產資金流向」圖使用同一套算法：σ = N 日報酬 ÷ (近 60 日日報酬標準差 × √N)
FLOW_ASSETS = [
    ("gold", "黃金", "safe"), ("copper", "銅", "risk"), ("wti", "原油", "risk"),
    ("spx", "美股", "risk"), ("sox", "費半", "risk"), ("taiex", "台股", "risk"),
    ("btc", "加密", "risk"), ("dxy", "美元", "safe"), ("us10y", "美債", "safe"),
]
FLOW_NAME = {k: n for k, n, _ in FLOW_ASSETS}


def flow_score(series, n, bond=False):
    import math
    if not series or len(series) < 70 or len(series) <= n:
        return None
    v = [x[1] for x in series]
    daily = []
    for i in range(len(v) - 61, len(v)):
        if i < 1:
            continue
        daily.append(-(v[i] - v[i - 1]) * 100 if bond else math.log(v[i] / v[i - 1]) * 100)
    hist = daily[:-1]
    mu = sum(hist) / len(hist)
    sd = (sum((x - mu) ** 2 for x in hist) / len(hist)) ** 0.5
    a, b = v[-1 - n], v[-1]
    raw = -(b - a) * 100 if bond else (b / a - 1) * 100
    return {"z": round(raw / (sd * n ** 0.5), 2) if sd else 0.0, "raw": round(raw, 2)}


def flow_table(metrics):
    out = {}
    for n in (1, 5, 20):
        out[n] = {}
        for k, _, _ in FLOW_ASSETS:
            s = flow_score((metrics.get(k) or {}).get("history"), n, bond=(k == "us10y"))
            if s:
                out[n][k] = s
    return out


def _fz(k, s):
    unit = f"殖利率{'−' if s['raw'] > 0 else '+'}{abs(s['raw']):.0f}bp" if k == "us10y" else f"{s['raw']:+.1f}%"
    return f"{FLOW_NAME[k]} {s['z']:+.1f}σ（{unit}）"


def flow_questions(metrics):
    T = flow_table(metrics)
    qs = []
    f5 = T.get(5, {})

    # Q4：資金輪動（5 日最強流入 vs 最強流出）
    if len(f5) >= 2:
        top = max(f5, key=lambda k: f5[k]["z"])
        bot = min(f5, key=lambda k: f5[k]["z"])
        qs.append({
            "text": f"【資金輪動】過去 5 個交易日，資金最明顯從 {_fz(bot, f5[bot])} 流向 {_fz(top, f5[top])}。"
                    f"你認為這是避險輪動、產業輪動，還是流動性收縮下的被動調整？哪一個總經變數（利率、美元、通膨預期、景氣）最能解釋這個方向？",
            "hint": "先判斷流入方是「防禦型」還是「成長型」資產，再對照美債 2Y 與 DXY：若利率與美元同步走強，多半是流動性因素而非基本面。",
            "assets": [bot, top], "type": "flow",
        })

    # Q5：風險資產 vs 避險資產是否「同進同出」
    f1 = T.get(1, {})
    risk = [f1[k]["z"] for k, _, g in FLOW_ASSETS if g == "risk" and k in f1]
    safe = [f1[k]["z"] for k, _, g in FLOW_ASSETS if g == "safe" and k in f1]
    if risk and safe:
        r, s_ = sum(risk) / len(risk), sum(safe) / len(safe)
        if r > 0.3 and s_ > 0.3:
            state = f"風險資產（平均 {r:+.1f}σ）與避險資產（平均 {s_:+.1f}σ）今天同時流入"
            ask = "這通常代表整體流動性擴張（降息預期、央行注資、美元回流）。你認為是哪一個？能持續嗎？"
        elif r < -0.3 and s_ < -0.3:
            state = f"風險資產（平均 {r:+.1f}σ）與避險資產（平均 {s_:+.1f}σ）今天同時流出"
            ask = "連避險資產都被賣，常見於去槓桿或保證金追繳（現金為王）。你看到哪些跡象支持或否定這個解讀？"
        elif r <= -0.3 and s_ >= 0:
            state = f"今天是典型的 Risk-off：風險資產平均 {r:+.1f}σ、避險資產平均 {s_:+.1f}σ"
            ask = "這次避險是由事件（地緣、數據）觸發，還是趨勢性的？如果明天反轉，代表什麼？"
        elif r >= 0.3 and s_ <= 0:
            state = f"今天偏 Risk-on：風險資產平均 {r:+.1f}σ、避險資產平均 {s_:+.1f}σ"
            ask = "風險偏好回升的燃料是什麼（財報、利率回落、美元走弱）？哪個資產最可能是下一個資金去處？"
        else:
            state = f"風險資產（平均 {r:+.1f}σ）與避險資產（平均 {s_:+.1f}σ）整體方向不明顯"
            ask = "大類資產沒有明確的風險偏好方向時，資金通常在類別內部輪動。你認為今天的主角是個別事件，還是市場在等待下一個催化劑（數據、央行）？"
        best = max(f1, key=lambda k: abs(f1[k]["z"]))
        qs.append({
            "text": f"【風險偏好】{state}，其中變動最大的是 {_fz(best, f1[best])}。{ask}",
            "hint": "觀察黃金、美債、美元三個避險資產是否「同方向」：三者分歧時，通常要看是利率驅動（黃金與美債反向）還是避險驅動（三者同漲）。",
            "assets": [best], "type": "flow",
        })

    # Q6：短線 vs 中期方向背離（反彈還是反轉？），否則問台股外資流向
    f20 = T.get(20, {})
    flips = [(k, f1[k]["z"], f20[k]["z"]) for k in f1 if k in f20
             and f1[k]["z"] * f20[k]["z"] < 0 and abs(f1[k]["z"]) >= 0.8 and abs(f20[k]["z"]) >= 0.5]
    if flips:
        k, z1, z20 = max(flips, key=lambda x: abs(x[1]) + abs(x[2]))
        d1 = "流入" if z1 > 0 else "流出"
        d20 = "流入" if z20 > 0 else "流出"
        qs.append({
            "text": f"【時間框架背離】{FLOW_NAME[k]} 今天資金{d1}（{z1:+.1f}σ），但近 20 日整體是{d20}（{z20:+.1f}σ）。"
                    f"你判斷這是逆勢的短線反彈／回檔，還是中期趨勢反轉的第一天？你會用什麼條件（價位、數據、成交量）來確認？",
            "hint": "反轉通常需要「催化劑 + 跨資產確認」：只有單一資產轉向、其他相關資產沒跟上時，多半只是反彈。",
            "assets": [k], "type": "flow",
        })
    else:
        tw = f1.get("taiex")
        twd = (metrics.get("usdtwd") or {}).get("chg_1d")
        if tw and twd is not None:
            fx = "新台幣貶值（外資傾向匯出）" if twd > 0 else "新台幣升值（外資傾向匯入）"
            qs.append({
                "text": f"【外資流向】台股今天 {tw['z']:+.1f}σ（{tw['raw']:+.1f}%），同時 {fx}，USD/TWD {twd:+.2f}%。"
                        f"股市與匯率的訊號一致嗎？如果不一致，你認為是內資撐盤、外資在期貨端避險，還是匯率由其他因素（央行、出口商）主導？",
                "hint": "台股與新台幣同向（股漲台幣升）代表外資真實流入；股漲台幣貶，常見於內資或權值股作帳，延續性較弱。",
                "assets": ["taiex", "usdtwd"], "type": "flow",
            })
    while len(qs) < 3:
        qs.append({"text": "【資金流向】把資金流向圖切到 20D 並排序：流入最多與流出最多的兩個資產，背後是同一個總經主題嗎？",
                   "hint": "若兩端屬於同一主題的正反面（例如利率上升：美元流入、費半流出），這個主題就是目前市場的主軸。",
                   "assets": [], "type": "flow"})
    return qs[:3], T
