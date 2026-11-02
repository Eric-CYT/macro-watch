"""
每 3 個交易日一期的「焦點市場推敲」與「資金動向評估」。
市場（使用者指定 7 個）：美元 DXY、黃金、加密、美股、台股、美債、原油
σ（波動調整後變動）= N 日變動 ÷ (近 60 日日變動標準差 × √N)；與儀表板資金流向圖同算法。
美債以「價格方向」計資金流向（殖利率下跌 = 資金流入）。
"""
from __future__ import annotations

import math

CYCLE = 3  # 交易日

MARKETS = {
    "dxy": "美元 DXY", "gold": "黃金", "btc": "加密（BTC）", "spx": "美股（S&P 500）",
    "taiex": "台股", "us10y": "美債（10Y）", "wti": "原油（WTI）",
}
RISK = ["spx", "taiex", "btc", "wti"]
SAFE = ["gold", "us10y", "dxy"]


# ------------------------------------------------------------------ 基本計算
def _hist(M, k):
    return ((M.get(k) or {}).get("history")) or []


def zscore(series, n, mode="pct"):
    """mode: pct（價格，對數報酬）| bp（利率水準變動）| bond（利率→債券價格方向 = −Δ殖利率）"""
    if len(series) < 70 or len(series) <= n:
        return None
    v = [x[1] for x in series]
    d = []
    for i in range(len(v) - 61, len(v) - 1):
        if i < 1:
            continue
        if mode == "pct":
            d.append(math.log(v[i] / v[i - 1]) * 100)
        else:
            d.append((v[i] - v[i - 1]) * 100 * (-1 if mode == "bond" else 1))
    mu = sum(d) / len(d)
    sd = (sum((x - mu) ** 2 for x in d) / len(d)) ** 0.5
    a, b = v[-1 - n], v[-1]
    raw = (b / a - 1) * 100 if mode == "pct" else (b - a) * 100 * (-1 if mode == "bond" else 1)
    return {"z": round(raw / (sd * n ** 0.5), 2) if sd else 0.0, "raw": round(raw, 2)}


def flow(M, k, n):
    """資金流向 σ：美債用價格方向"""
    return zscore(_hist(M, k), n, "bond" if k == "us10y" else "pct")


def level(M, k, n):
    """原始方向 σ：利率類用殖利率水準（bp）"""
    rate = (M.get(k) or {}).get("rate")
    return zscore(_hist(M, k), n, "bp" if rate else "pct")


def rotation_label(z3, z20):
    if z3 is None or z20 is None:
        return "資料不足"
    if z3 > 0.5:
        return "持續流入" if z20 > 0.5 else "由流出轉流入（早期反轉）" if z20 < -0.3 else "開始流入"
    if z3 < -0.5:
        return "持續流出" if z20 < -0.5 else "由流入轉流出（早期反轉）" if z20 > 0.3 else "開始流出"
    if z20 > 0.5:
        return "流入減速"
    if z20 < -0.5:
        return "流出減速"
    return "無明顯方向"


def _fmt(k, raw):
    if k == "us10y":
        return f"殖利率{'−' if raw > 0 else '+'}{abs(raw):.0f}bp"  # raw 為債券價格方向
    return f"{raw:+.2f}%"


# ------------------------------------------------------------------ 資金動向評估
def assess(M):
    rows = {}
    for k, name in MARKETS.items():
        f3, f20 = flow(M, k, CYCLE), flow(M, k, 20)
        if not f3:
            continue
        rows[k] = {"name": name, "z3": f3["z"], "raw3": f3["raw"], "z20": (f20 or {}).get("z"),
                   "raw20": (f20 or {}).get("raw"), "label": rotation_label(f3["z"], (f20 or {}).get("z")),
                   "txt3": _fmt(k, f3["raw"])}

    # 1) 風險偏好
    r = [rows[k]["z3"] for k in RISK if k in rows]
    s = [rows[k]["z3"] for k in SAFE if k in rows]
    ra, sa = (sum(r) / len(r) if r else 0), (sum(s) / len(s) if s else 0)
    if ra > 0.3 and sa > 0.3:
        regime, regime_txt = "liquidity_up", "風險與避險資產同時流入 → 流動性擴張"
    elif ra < -0.3 and sa < -0.3:
        regime, regime_txt = "deleverage", "風險與避險資產同時流出 → 去槓桿／現金為王"
    elif ra <= -0.3 and sa >= 0:
        regime, regime_txt = "risk_off", "風險資產流出、避險資產流入 → Risk-off"
    elif ra >= 0.3 and sa <= 0:
        regime, regime_txt = "risk_on", "風險資產流入、避險資產流出 → Risk-on"
    else:
        regime, regime_txt = "mixed", "大類資產方向不明顯 → 類別內輪動或觀望"

    # 2) 流動性（美元、2Y 殖利率、高收益債利差：上升 = 收緊）
    liq_items = []
    score = 0
    for k, nm in (("dxy", "美元"), ("us02y", "美債 2Y 殖利率"), ("hy", "高收益債利差")):
        z = level(M, k, CYCLE)
        if not z:
            continue
        sgn = 1 if z["z"] > 0.5 else -1 if z["z"] < -0.5 else 0
        score += sgn
        unit = f"{z['raw']:+.0f}bp" if (M.get(k) or {}).get("rate") else f"{z['raw']:+.2f}%"
        liq_items.append({"name": nm, "z": z["z"], "txt": unit, "effect": "收緊" if sgn > 0 else "寬鬆" if sgn < 0 else "持平"})
    liquidity = "收緊" if score >= 2 else "偏收緊" if score == 1 else "寬鬆" if score <= -2 else "偏寬鬆" if score == -1 else "中性"

    # 3) 傳導鏈（期望關係是否成立）
    def zz(k):
        x = level(M, k, CYCLE)
        return x["z"] if x else None
    chains = []
    for name, a, b, expect, why in (
        ("美元流動性 → 加密", "dxy", "btc", -1, "美元走強通常收縮加密的流動性"),
        ("外資匯率 → 台股", "usdtwd", "taiex", -1, "新台幣貶值（USD/TWD↑）通常伴隨外資賣超台股"),
        ("實質利率 → 黃金", "us10y", "gold", -1, "殖利率上升提高持有黃金的機會成本"),
        ("利率 → 美股估值", "us10y", "spx", -1, "殖利率上升壓縮股票估值"),
        ("日圓套息 → 美股", "usdjpy", "spx", 1, "日圓急升（USD/JPY↓）常引發套息平倉、拋售風險資產"),
        ("美元 → 原油", "dxy", "wti", -1, "原油以美元計價，美元走強通常壓抑油價"),
    ):
        za, zb = zz(a), zz(b)
        if za is None or zb is None:
            continue
        if abs(za) < 0.5 or abs(zb) < 0.5:
            status = "不明顯"
        else:
            status = "成立" if (za * zb * expect) > 0 else "失效（背離）"
        chains.append({"name": name, "za": za, "zb": zb, "status": status, "why": why})

    # 4) 系統下一期傾向（動能規則，僅供對照；以 outcome() 的方向定義：us10y 'up' = 殖利率上升）
    calls = []
    for k, rw in rows.items():
        lab = rw["label"]
        if lab in ("持續流入", "開始流入", "由流出轉流入（早期反轉）"):
            d = "up"
        elif lab in ("持續流出", "開始流出", "由流入轉流出（早期反轉）"):
            d = "down"
        else:
            continue
        if k == "us10y":  # 資金流入債券 = 殖利率下跌
            d = "down" if d == "up" else "up"
        calls.append({"asset": k, "dir": d, "basis": lab})

    # 5) 文字結論
    order = sorted(rows.items(), key=lambda kv: kv[1]["z3"], reverse=True)
    lines = [f"本期（{CYCLE} 個交易日）{regime_txt}（風險資產平均 {ra:+.1f}σ、避險資產平均 {sa:+.1f}σ）。"]
    lines.append(f"流動性環境：{liquidity}（" + "、".join(f"{i['name']} {i['txt']}" for i in liq_items) + "）。")
    if order:
        top, bot = order[0], order[-1]
        lines.append(f"最強流入：{top[1]['name']} {top[1]['z3']:+.1f}σ（{top[1]['label']}）；最強流出：{bot[1]['name']} {bot[1]['z3']:+.1f}σ（{bot[1]['label']}）。")
    rev = [rw["name"] + "：" + rw["label"] for rw in rows.values() if "反轉" in rw["label"]]
    if rev:
        lines.append("出現早期反轉訊號：" + "；".join(rev) + "，轉折常最先出現在這裡，值得優先推敲。")
    broken = [c["name"] for c in chains if c["status"].startswith("失效")]
    if broken:
        lines.append("傳導鏈失效：" + "、".join(broken) + "——平常的關係不成立，代表有其他力量主導。")
    if calls:
        up = [MARKETS[c["asset"]] for c in calls if (c["dir"] == "up") != (c["asset"] == "us10y")]
        dn = [MARKETS[c["asset"]] for c in calls if (c["dir"] == "down") != (c["asset"] == "us10y")]
        lines.append(f"系統下一期傾向（動能規則）：資金續流入 {('、'.join(up) or '—')}；續流出 {('、'.join(dn) or '—')}。")
    return {
        "cycle": CYCLE, "regime": regime, "regime_txt": regime_txt, "risk_avg": round(ra, 2), "safe_avg": round(sa, 2),
        "liquidity": liquidity, "liq_items": liq_items, "rows": rows, "chains": chains, "calls": calls, "text": lines,
    }


# ------------------------------------------------------------------ 焦點市場 3 層提問
DRIVERS = {
    "dxy": ("利差（美債 2Y）、避險需求、歐元與日圓的強弱（DXY 有 57.6% 是歐元）", ["us02y", "usdjpy"]),
    "gold": ("實質利率（美債 10Y）、美元、避險需求、央行買盤", ["us10y", "dxy"]),
    "btc": ("美元流動性、風險偏好（美股）、現貨 ETF 資金、槓桿與清算", ["dxy", "spx"]),
    "spx": ("企業盈餘與財報、利率（美債 10Y）、風險偏好（VIX）", ["us10y", "vix"]),
    "taiex": ("半導體循環（費半）、外資動向（新台幣）、美股", ["sox", "usdtwd"]),
    "us10y": ("通膨預期、Fed 政策路徑（美債 2Y）、避險需求、公債供給", ["us02y", "spx"]),
    "wti": ("供需與 OPEC+、地緣政治、景氣（銅）、美元", ["copper", "dxy"]),
}
NEXT = {
    "dxy": "台股與新台幣、加密資產、黃金、新興市場",
    "gold": "美元、實質利率、加密（另類資產）、礦業股",
    "btc": "高 Beta 科技股、加密相關股、市場整體風險偏好",
    "spx": "台股（隔日開盤）、費半、加密、VIX",
    "taiex": "新台幣匯率、外資期貨部位、亞洲科技股",
    "us10y": "美股估值（特別是科技／費半）、黃金、美元、房地產",
    "wti": "通膨預期與美債殖利率、能源股、航運與化工、新台幣（進口成本）",
}
NAMES_ALL = {**MARKETS, "us02y": "美債 2Y", "usdjpy": "USD/JPY", "vix": "VIX", "sox": "費半", "usdtwd": "USD/TWD", "copper": "銅"}


def market_questions(M, k, A, period):
    rw = A["rows"].get(k)
    if not rw:
        return []
    name = MARKETS[k]
    rank = sorted(A["rows"], key=lambda x: abs(A["rows"][x]["z3"]), reverse=True).index(k) + 1
    z20 = rw["z20"]
    lab = rw["label"]
    if "反轉" in lab:
        phase = "短期方向和近 20 日相反，可能是轉折的早期訊號"
    elif lab.startswith("持續"):
        phase = "短期與中期同方向，屬於趨勢延續"
    elif "減速" in lab:
        phase = "中期趨勢仍在，但本期動能明顯放慢"
    elif lab.startswith("開始"):
        phase = "本期出現明顯移動，但中期還沒有形成方向"
    else:
        phase = "本期沒有明顯的資金方向"
    # 驅動因子的實際數字
    drv_txt, keys = DRIVERS[k]
    drv_nums = []
    for d in keys:
        x = level(M, d, CYCLE)
        if x:
            unit = f"{x['raw']:+.0f}bp" if (M.get(d) or {}).get("rate") else f"{x['raw']:+.2f}%"
            drv_nums.append(f"{NAMES_ALL.get(d, d)} {unit}（{x['z']:+.1f}σ）")
    # 反向最明顯的市場（資金可能的來源或去處）
    others = [(o, r) for o, r in A["rows"].items() if o != k]
    cp = min(others, key=lambda o: o[1]["z3"] * rw["z3"]) if others else None
    cp_txt = ""
    if cp and cp[1]["z3"] * rw["z3"] < -0.25:
        src, dst = (cp[1]["name"], name) if rw["z3"] > 0 else (name, cp[1]["name"])
        cp_txt = f"同一期間 {cp[1]['name']} {cp[1]['z3']:+.1f}σ，方向相反——資金可能從 {src} 流向 {dst}，也可能只是巧合。"
    z20t = f"{z20:+.1f}σ" if z20 is not None else "—"
    return [
        {"layer": 1, "type": "focus", "market": k, "assets": [k],
         "text": f"【{name}｜① 發生了什麼】本期（{period}）{name} {rw['txt3']}，資金流向 {rw['z3']:+.1f}σ（7 個市場中變化第 {rank} 大）；"
                 f"近 20 日 {z20t}，系統判讀為「{lab}」：{phase}。你認為這是趨勢的延續、轉折，還是一次性的衝擊？你從哪些跡象（波動、量、與其他市場的關係）判斷？",
         "hint": "先分辨『價格在動』還是『結構在變』：結構變化通常伴隨相關市場一起動、波動率放大，而且不會在一兩天內被收回。"},
        {"layer": 2, "type": "focus", "market": k, "assets": [k] + [x for x in keys if x in MARKETS],
         "text": f"【{name}｜② 誰在推、錢從哪來】這個市場常見的驅動因子是 {drv_txt}。本期相關數據：{'、'.join(drv_nums) or '—'}。{cp_txt}"
                 f"你認為這次真正的推手是誰？資金是從哪裡來（或流到哪裡去）？",
         "hint": "找出資金的「來源」比找去處更重要：如果找不到對應流出的市場，這次移動可能只是部位調整或流動性變化，而不是真正的輪動。"},
        {"layer": 3, "type": "focus", "market": k, "assets": [k],
         "text": f"【{name}｜③ 下一站與驗證】如果 {name} 這波資金移動才剛開始，下一個會被影響的市場是誰？（常見的傳導對象：{NEXT[k]}）"
                 f"請寫下你對下一期（{CYCLE} 個交易日）{name} 的方向判斷，以及什麼訊號出現代表你錯了。",
         "hint": "在下方「我的判斷」選方向與 3 日期間，下一期作答時系統會自動對答案；失效條件寫得越具體（價位、數據、某市場反向），越能幫你及早認錯。"},
    ]


def build(M, period, focus_n=2):
    A = assess(M)
    by_abs = sorted(A["rows"], key=lambda k: (abs(A["rows"][k]["z3"]), abs(A["rows"][k]["z20"] or 0)), reverse=True)
    focus = by_abs[:focus_n]
    markets = {k: {"name": MARKETS[k], "stats": A["rows"][k], "questions": market_questions(M, k, A, period)} for k in A["rows"]}
    questions = [q for k in focus for q in markets[k]["questions"]]
    return {"version": 2, "assessment": A, "markets": markets, "focus": focus, "questions": questions}
