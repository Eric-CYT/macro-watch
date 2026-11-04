"""
ntfy 推播（免費、免註冊）：https://ntfy.sh
  - 頻道名稱放在 GitHub Secret「NTFY_TOPIC」；沒設定就完全不推播
  - 每個事件有唯一 key，記錄在 data/cache/notify_state.json，同一事件只推一次
  - 台北 00:00–07:30 的一般通知延後到 07:30 送達；緊急警報立即送出
事件：
  1. 新一期推敲題目產生（同時提醒上一期預判已可驗證）
  2. 跨資產警報觸發（流動性緊縮／套息交易反轉／科技股估值壓力）
  3. 連動矩陣情境改變（近 3 日變化）
  4. 外資台指期淨未平倉單日變化 ≥ 5,000 口
  5. 外資現貨單日買賣超 ≥ 500 億
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

TPE = timezone(timedelta(hours=8))
NTFY = os.environ.get("NTFY_SERVER", "https://ntfy.sh").rstrip("/")

# 與 src/lib/matrixConfig.js 的 SCENARIOS 相同（改那邊時請同步這裡）
SCENARIOS = [
    ("完美流動性派對", {"dxy": "down", "us10y": "down"}),
    ("極端恐慌 / 衰退", {"spx": "down", "us10y": "down"}),
    ("通膨復燃恐懼", {"wti": "up", "us10y": "up"}),
    ("強勢美元吸金", {"dxy": "up", "us10y": "up"}),
]
TXF_JUMP = 5000
INST_BIG = 500  # 億元


def _fp(v):
    return "—" if v is None else f"{v:+.2f}%"


def _fb(v):
    return "—" if v is None else f"{v:+.1f}bp"


def alerts(M, cfg):
    """與 src/lib/alerts.js 同邏輯"""
    a = (cfg or {}).get("alerts") or {}
    g = lambda k, f: (M.get(k) or {}).get(f)  # noqa: E731
    out = []
    L, C, V = a.get("liquidity"), a.get("carry"), a.get("valuation")

    def ge(x, t):
        return x is not None and x >= t

    def le(x, t):
        return x is not None and x <= t

    if L:
        d1, d5, y1, y5 = g("dxy", "chg_1d"), g("dxy", "chg_5d"), g("us02y", "chg_1d"), g("us02y", "chg_5d")
        if (ge(d1, L["dxy_pct_1d"]) and ge(y1, L["us02y_bp_1d"])) or (ge(d5, L["dxy_pct_5d"]) and ge(y5, L["us02y_bp_5d"])):
            out.append(("liquidity", L["label"], f"{L['desc']}\nDXY 1D {_fp(d1)} / 5D {_fp(d5)}；US02Y 1D {_fb(y1)} / 5D {_fb(y5)}"))
    if C:
        j1, j5 = g("usdjpy", "chg_1d"), g("usdjpy", "chg_5d")
        if le(j1, C["usdjpy_pct_1d"]) or le(j5, C["usdjpy_pct_5d"]):
            out.append(("carry", C["label"], f"{C['desc']}\nUSD/JPY 1D {_fp(j1)} / 5D {_fp(j5)}（負值＝日圓升值）"))
    if V:
        t1, t5 = g("us10y", "chg_1d"), g("us10y", "chg_5d")
        if ge(t1, V["us10y_bp_1d"]) or ge(t5, V["us10y_bp_5d"]):
            out.append(("valuation", V["label"], f"{V['desc']}\nUS10Y 1D {_fb(t1)} / 5D {_fb(t5)}"))
    return out


FLAT_Z = 0.25


def scenario_states(M, n=3):
    """與 src/lib/matrixStats.js autoDriverStates 相同：N 日變化 ÷（近 60 日單日波動 × √N），|z| < 0.25 視為持平"""
    st = {}
    for k in ("dxy", "us10y", "wti", "spx"):
        m = M.get(k) or {}
        h = m.get("history") or []
        if len(h) <= n + 61:
            continue
        rate = bool(m.get("rate"))
        a, b = h[-1 - n][1], h[-1][1]
        chg = (b - a) * 100 if rate else (b / a - 1) * 100
        tail = h[-62:]
        d = [((y[1] - x[1]) * 100 if rate else (y[1] / x[1] - 1) * 100) for x, y in zip(tail, tail[1:])][-60:]
        mu = sum(d) / len(d)
        sd = (sum((x - mu) ** 2 for x in d) / (len(d) - 1)) ** 0.5
        z = chg / (sd * n ** 0.5) if sd else 0
        st[k] = "flat" if chg == 0 or abs(z) < FLAT_Z else ("up" if chg > 0 else "down")
    return st


def scenarios(M):
    st = scenario_states(M)
    return sorted(name for name, cond in SCENARIOS if all(st.get(k) == v for k, v in cond.items())), st


def build_events(M, FL, cfg, generated, qinfo=None):
    """回傳 [(key, title, message, priority, tags, path)]；key 用來去重"""
    ev = []
    day = (M.get("spx") or {}).get("date") or datetime.now(TPE).date().isoformat()

    if generated:
        q = qinfo or {}
        focus = "、".join(q.get("focus_names") or [])
        msg = f"本期焦點：{focus}" if focus else "新一期題目已產生"
        if q.get("regime"):
            msg += f"\n系統判讀：{q['regime']}"
        msg += "\n上一期的預判已到期，可到「統整驗證」看結果。"
        ev.append((f"q:{generated}", "📝 新一期推敲題目", msg, 3, ["memo"], "#/reflect"))

    for aid, label, msg in alerts(M, cfg):
        pr = 5 if aid == "carry" else 4
        ev.append((f"alert:{aid}:{day}", f"⚠ {label}", msg, pr, ["warning"], "#/"))

    names, st = scenarios(M)
    sig = "|".join(names) or "無"
    ev.append((f"scen:{sig}", "🧭 連動情境改變", (f"目前情境：{'、'.join(names)}" if names else "目前無明確情境（混合訊號）")
               + "\n近 3 日：" + "、".join(f"{ {'dxy': '美元', 'us10y': '美債殖利率', 'wti': '原油', 'spx': '美股'}[k] }{'上漲' if v == 'up' else '下跌'}"
                                         for k, v in st.items() if v != "flat") + ("（其餘持平）" if "flat" in st.values() else ""), 3, ["compass"], "#/matrix"))

    tx = ((FL or {}).get("txf") or {}).get("series") or []
    if len(tx) >= 2 and tx[-1][1] is not None and tx[-2][1] is not None:
        d = tx[-1][1] - tx[-2][1]
        if abs(d) >= TXF_JUMP:
            word = "淨空單增加" if d < 0 else "淨空單減少／淨多單增加"
            ev.append((f"txf:{tx[-1][0]}", "📊 外資台指期大幅調整",
                       f"{tx[-1][0]} 外資{word} {abs(d):,} 口\n目前淨未平倉 {tx[-1][1]:+,} 口", 4, ["chart_with_downwards_trend" if d < 0 else "chart_with_upwards_trend"], "#/"))

    inst = ((FL or {}).get("tw_inst") or {}).get("series") or []
    if inst and inst[-1][1] is not None and abs(inst[-1][1]) >= INST_BIG:
        r = inst[-1]
        ev.append((f"inst:{r[0]}", f"💰 外資現貨{'買超' if r[1] > 0 else '賣超'} {abs(r[1]):,.0f} 億",
                   f"{r[0]} 外資 {r[1]:+,.2f} 億、投信 {r[2]:+,.2f} 億、自營商 {r[3]:+,.2f} 億\n三大法人合計 {r[4]:+,.2f} 億", 4, ["moneybag"], "#/"))
    return ev


def _delay_for(priority, now=None):
    """台北 00:00–07:29 的一般通知延到 07:30；priority ≥ 5 立即"""
    now = now or datetime.now(TPE)
    if priority >= 5 or not (0 <= now.hour < 7 or (now.hour == 7 and now.minute < 30)):
        return None
    target = now.replace(hour=7, minute=30, second=0, microsecond=0)
    if (target - now).total_seconds() < 60:  # ntfy 最短延遲 10 秒，太接近就直接送
        return None
    return str(int(target.timestamp()))


def send(topic, title, message, priority=3, tags=None, click=None, session=None):
    import requests
    body = {"topic": topic, "title": title, "message": message, "priority": priority, "tags": tags or []}
    if click:
        body["click"] = click
    d = _delay_for(priority)
    if d:
        body["delay"] = d
    s = session or requests
    r = s.post(NTFY, data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
               headers={"Content-Type": "application/json"}, timeout=10)
    if r.status_code >= 300:
        raise RuntimeError(f"ntfy HTTP {r.status_code}: {r.text[:120]}")


def run(M, FL, cfg, generated, state_file: Path, pages_url=None, qinfo=None, sender=None):
    """回傳 (送出的數量, 錯誤訊息list)"""
    sender = sender or send
    topic = os.environ.get("NTFY_TOPIC", "").strip()
    if not topic:
        return 0, []
    st = json.loads(state_file.read_text()) if state_file.exists() else {}
    sent = st.get("sent", [])
    first = not st
    events = build_events(M, FL, cfg, generated, qinfo)
    errs, n = [], 0
    base = (pages_url or "").rstrip("/") + "/"
    if first:
        # 第一次啟用：只送一則確認訊息，並把目前已存在的狀態記為「已送」，避免一次灌爆
        try:
            sender(topic, "✅ Macro Watch 推播已啟用",
                   "之後有新題目、警報、情境改變、外資大動作時會通知你。\n台北 00:00–07:30 的一般通知會延到 07:30 送達。",
                   3, ["white_check_mark"], base if pages_url else None)
            n = 1
        except Exception as e:  # noqa: BLE001
            errs.append(f"ntfy: {e}")
        sent = [k for k, *_ in events]
    else:
        for key, title, msg, pr, tags, path in events:
            if key in sent:
                continue
            # 情境：只在「改變」時通知（同一組情境出現過但中間換過，也會再通知）
            if key.startswith("scen:") and st.get("last_scen") == key:
                continue
            try:
                sender(topic, title, msg, pr, tags, (base + path) if pages_url else None)
                n += 1
                sent.append(key)
            except Exception as e:  # noqa: BLE001
                errs.append(f"ntfy {key}: {e}")
            time.sleep(0.3)
    scen = next((k for k, *_ in events if k.startswith("scen:")), None)
    sent = [k for k in sent if not k.startswith("scen:")]  # 情境 key 不永久保存，靠 last_scen 判斷改變
    state_file.write_text(json.dumps({"sent": sent[-300:], "last_scen": scen,
                                      "updated": datetime.now(TPE).isoformat(timespec="seconds")}, ensure_ascii=False))
    return n, errs
