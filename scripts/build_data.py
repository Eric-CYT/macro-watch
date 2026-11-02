"""
主程式：抓取 → 交叉比對 → 產出前端用 JSON。
用法：python scripts/build_data.py --out public/data --archive data
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import news as news_mod  # noqa: E402
import cycle as cycle_mod  # noqa: E402
import flows as flows_mod  # noqa: E402
import questions as q_mod  # noqa: E402
import sources as S  # noqa: E402
import validate as V  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CONFIG = json.loads((ROOT / "shared" / "config.json").read_text(encoding="utf-8"))

ERRORS: list[str] = []


T0 = time.time()


def log(msg):
    print(f"[{time.time() - T0:6.1f}s] {msg}", flush=True)


def safe(label, fn, *a, **kw):
    t = time.time()
    try:
        r = fn(*a, **kw)
        log(f"✓ {label} ({time.time() - t:.1f}s)")
        return r
    except Exception as e:  # noqa: BLE001
        ERRORS.append(f"{label}: {type(e).__name__}: {str(e)[:160]}")
        log(f"✗ {label} ({time.time() - t:.1f}s) {type(e).__name__}: {str(e)[:120]}")
        return None


def pmap(items, fn, workers=8):
    """平行抓取；items 為 (key, args...)；回傳 {key: result}"""
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {k: ex.submit(fn, *args) for k, *args in items}
        return {k: f.result() for k, f in futs.items()}


def ago(days):
    return (date.today() - timedelta(days=days)).isoformat()


def trim(series, n):
    return series[-n:] if series else series


def yahoo_hist(sym, rng="2y"):
    r = safe(f"Yahoo {sym}", S.yahoo_chart, sym, rng, "1d")
    return r


def chg(series, n, rate=False):
    if not series or len(series) <= n:
        return None
    a, b = series[-1 - n][1], series[-1][1]
    if rate:
        return round((b - a) * 100, 1)  # bp
    return round((b / a - 1) * 100, 3) if a else None


def metric(key, name, group, unit, hist, source, checks, decimals=2, rate=False, note=None, fallback=False):
    m = {
        "key": key, "name": name, "group": group, "unit": unit, "decimals": decimals, "rate": rate,
        "source": source, "checks": checks, "note": note,
        "history": trim(hist, 400) if hist else [],
    }
    if hist:
        m["last"] = hist[-1][1]
        m["date"] = hist[-1][0]
        m["chg_1d"] = chg(hist, 1, rate)
        m["chg_5d"] = chg(hist, 5, rate)
        m["chg_20d"] = chg(hist, 20, rate)
    status = V.worst(checks)
    if fallback:
        status = "fail" if status in ("ok", "single") else status
    m["status"] = status if hist else "missing"
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "public" / "data"))
    ap.add_argument("--archive", default=str(ROOT / "data"))
    args = ap.parse_args()
    out = Path(args.out)
    arch = Path(args.archive)
    out.mkdir(parents=True, exist_ok=True)
    (arch / "questions").mkdir(parents=True, exist_ok=True)
    (arch / "cache").mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)

    # ------------------------------------------------------------ 抓取
    YSYM = {
        "tnx": "^TNX", "wti": "CL=F", "gold": "GC=F", "copper": "HG=F", "dxy": "DX-Y.NYB",
        "usdjpy": "JPY=X", "usdtwd": "TWD=X", "taiex": "^TWII", "btc": "BTC-USD", "vix": "^VIX",
        "spx": "^GSPC", "sox": "^SOX",
        "EURUSD": "EURUSD=X", "GBPUSD": "GBPUSD=X", "USDCAD": "CAD=X", "USDSEK": "SEK=X", "USDCHF": "CHF=X",
    }
    log("開始抓取 Yahoo")
    Y = pmap([(k, sym) for k, sym in YSYM.items()], yahoo_hist, workers=6)
    Y["USDJPY"] = Y["usdjpy"]

    FSTART = {
        "DGS10": ago(800), "DGS2": ago(800), "T10Y2Y": ago(800), "BAMLH0A0HYM2": ago(800),
        "DCOILWTICO": ago(120), "PCOPPUSDM": ago(400), "DEXJPUS": ago(60), "DEXTAUS": ago(60),
        "DEXUSEU": ago(60), "DEXUSUK": ago(60), "DEXCAUS": ago(60), "DEXSDUS": ago(60), "DEXSZUS": ago(60),
        "VIXCLS": ago(60), "SP500": ago(60),
        "WALCL": ago(1200), "WDTGAL": ago(1200), "RRPONTSYD": ago(1200), "WTREGEN": ago(1200),
        "CPIAUCNS": "2010-01-01", "CPILFENS": "2010-01-01", "PAYEMS": "2010-01-01", "UNRATE": "2010-01-01",
    }
    log("開始抓取 FRED")
    F = pmap([(sid, f"FRED {sid}", S.fred, sid, st) for sid, st in FSTART.items()], safe, workers=8)

    TR = safe("Treasury", S.treasury_yields) or {}
    BIN = safe("Binance BTCUSDT", S.binance_klines, "BTCUSDT", "1d", 730)
    BIN_PX = safe("Binance price", S.binance_price, "BTCUSDT")
    CG = safe("CoinGecko", S.coingecko_prices) or {}
    TW = safe("TWSE", S.twse_taiex)
    # ISM：已驗證歷史 + 官網新值，累積保存
    ism_seed = json.loads((ROOT / "shared" / "ism_seed.json").read_text(encoding="utf-8"))["data"]
    ism_cache_f = arch / "cache" / "ism.json"
    ism_hist = dict(ism_seed)
    if ism_cache_f.exists():
        ism_hist.update(json.loads(ism_cache_f.read_text()))
    ISM_NEW = safe("ISM 官網", S.ism_latest) or {}
    ISM_NEWS = safe("ISM 新聞轉載", S.ism_from_news) or {}
    ism_news_note = []
    for d, vals in ISM_NEWS.items():
        # 同一月份：取轉載最多的數值；至少 2 家不同媒體一致才採用，且不可有互相矛盾的數值
        best_v, srcs = max(vals.items(), key=lambda kv: len(kv[1]))
        others = [v for v in vals if v != best_v]
        if len(srcs) >= 2 and not others and d not in ISM_NEW:
            ISM_NEW[d] = best_v
            ism_news_note.append(f"{d[:7]}={best_v}（{len(srcs)} 家媒體一致）")
        elif others:
            ism_news_note.append(f"{d[:7]} 媒體數值不一致 {sorted(vals)}，不採用")
    ism_conflict = {d: (ism_hist[d], v) for d, v in ISM_NEW.items() if d in ism_hist and abs(ism_hist[d] - v) > 0.05}
    for d, v in ISM_NEW.items():
        if d not in ism_seed:  # 已驗證的種子值不被覆寫
            ism_hist[d] = v
    ism_cache_f.write_text(json.dumps({d: v for d, v in ism_hist.items() if d not in ism_seed}, indent=1))
    ISM = sorted([d, v] for d, v in ism_hist.items())

    # BLS 每日額度 25 次 → 只在快取超過 10 小時才打
    bls_cache = arch / "cache" / "bls.json"
    BLS = None
    if bls_cache.exists():
        c = json.loads(bls_cache.read_text())
        if now.timestamp() - c.get("t", 0) < 10 * 3600 and set(c.get("data", {})) == set(S.BLS_SERIES.values()):
            BLS = c["data"]
    if BLS is None:
        fresh = safe("BLS", S.bls_latest)
        if fresh:
            BLS = fresh
            bls_cache.write_text(json.dumps({"t": now.timestamp(), "data": fresh}))
        elif bls_cache.exists():
            BLS = json.loads(bls_cache.read_text())["data"]

    cal_cache = arch / "cache" / "calendar.json"
    CAL = {}
    if cal_cache.exists():
        c = json.loads(cal_cache.read_text())
        if now.timestamp() - c.get("t", 0) < 6 * 86400:
            CAL = c["data"]
    if not CAL:
        CAL = S.bls_release_calendar()
        if CAL:
            cal_cache.write_text(json.dumps({"t": now.timestamp(), "data": CAL}))
        elif cal_cache.exists():
            CAL = json.loads(cal_cache.read_text())["data"]

    def ypts(k):
        return (Y.get(k) or {}).get("points")

    def yprice(k):
        return (Y.get(k) or {}).get("price")

    M = {}
    # Yahoo 失敗時的備援序列（官方/獨立來源），並標示為備援
    FB = {}
    if not ypts("dxy"):
        try:
            fm0 = {k: V.to_map(F[s_]) for k, s_ in {"EURUSD": "DEXUSEU", "USDJPY": "DEXJPUS", "GBPUSD": "DEXUSUK",
                                                    "USDCAD": "DEXCAUS", "USDSEK": "DEXSDUS", "USDCHF": "DEXSZUS"}.items()}
            dd = sorted(set.intersection(*(set(m) for m in fm0.values())))
            FB["dxy"] = ([[d, round(V.dxy_from_fx({k: fm0[k][d] for k in fm0}), 3)] for d in dd],
                         "ICE 公式 × 聯準會匯率（備援）")
        except Exception:  # noqa: BLE001
            pass
    for k, sid, nm in (("usdjpy", "DEXJPUS", "FRED DEXJPUS（備援）"), ("usdtwd", "DEXTAUS", "FRED DEXTAUS（備援）"),
                       ("spx", "SP500", "FRED SP500（備援）"), ("vix", "VIXCLS", "FRED VIXCLS（備援）"),
                       ("wti", "DCOILWTICO", "FRED WTI 現貨（備援）")):
        if not ypts(k) and F.get(sid):
            FB[k] = (F[sid], nm)
    if not ypts("gold"):
        g = safe("CoinGecko PAXG 歷史", S.coingecko_history, "pax-gold", 365)
        if g:
            FB["gold"] = (g, "CoinGecko PAXG（實體黃金代幣，備援）")

    def pick(k, default_src):
        if ypts(k):
            return ypts(k), default_src, False
        if k in FB:
            return FB[k][0], FB[k][1], True
        return None, default_src, False

    # ------------------------------------------------------------ 殖利率
    tnx = ypts("tnx")
    if tnx and sorted(v for _, v in tnx)[len(tnx) // 2] > 20:  # 舊制 ×10 報價
        tnx = [[d, v / 10] for d, v in tnx]
    for key, tr_key, fred_id, name in (("us10y", "10 Yr", "DGS10", "美債 10Y"), ("us02y", "2 Yr", "DGS2", "美債 2Y")):
        hist = TR.get(tr_key)
        fb = False
        src = "美國財政部 Daily Par Yield Curve"
        if not hist:
            hist, src, fb = F.get(fred_id), f"FRED {fred_id}（備援）", True
        checks = [V.compare_series("財政部", hist, "FRED " + fred_id, F.get(fred_id), 0.011, "abs")]
        if key == "us10y":
            checks.append(V.compare_series("財政部", hist, "Yahoo ^TNX", tnx, 0.06, "abs",
                                           note="Cboe ^TNX 取樣時間與財政部不同，容許 6bp"))
        M[key] = metric(key, name, "rates", "%", hist, src, checks, 3, rate=True, fallback=fb)
        if key == "us10y" and tnx:
            M[key]["live"] = {"v": tnx[-1][1], "d": tnx[-1][0], "src": "Yahoo ^TNX"}

    t10, t2 = V.to_map(TR.get("10 Yr") or F.get("DGS10") or []), V.to_map(TR.get("2 Yr") or F.get("DGS2") or [])
    spread = [[d, round(t10[d] - t2[d], 3)] for d in sorted(set(t10) & set(t2))]
    M["spread"] = metric("spread", "10Y-2Y 利差", "rates", "%", spread, "財政部 10Y − 2Y 計算",
                         [V.compare_series("計算值", spread, "FRED T10Y2Y", F.get("T10Y2Y"), 0.011, "abs")], 3, rate=True)
    M["hy"] = metric("hy", "高收益債利差 (OAS)", "rates", "%", F.get("BAMLH0A0HYM2"), "FRED BAMLH0A0HYM2（ICE BofA）",
                     [V.compare(None, None, None, None, 0, note="僅 FRED 免費提供；FRED 自 2026/4 起只保留近 3 年")], 2, rate=True)

    # ------------------------------------------------------------ 原物料
    h, src, fb = pick("wti", "Yahoo CL=F（近月期貨）")
    M["wti"] = metric("wti", "WTI 原油", "cmdty", "USD/bbl", h, src,
                      [V.compare_series("CL=F", ypts("wti"), "FRED WTI 現貨", F.get("DCOILWTICO"), 6.0,
                                        note="期貨近月 vs 庫欣現貨：強烈逆價差時現貨可比近月高數%，此項為量級檢查")], fallback=fb)
    h, src, fb = pick("gold", "Yahoo GC=F（近月期貨）")
    M["gold"] = metric("gold", "黃金", "cmdty", "USD/oz", h, src,
                       [V.compare("GC=F 即時", yprice("gold"), "PAXG（CoinGecko）", (CG.get("pax-gold") or {}).get("usd"), 2.5,
                                  note="PAXG 為 1:1 實體黃金代幣，近似現貨；期貨有正價差")], 1, fallback=fb)
    cu = ypts("copper")
    cu_chk = V.compare(None, None, None, None, 0, note="比對來源無資料")
    fcu = F.get("PCOPPUSDM")
    if cu and fcu:
        mon = fcu[-1][0][:7]
        vals = [v for d, v in cu if d.startswith(mon)]
        if vals:
            cu_chk = V.compare(f"HG=F {mon} 月均", sum(vals) / len(vals) * 2204.62, "FRED/IMF 全球銅價",
                               fcu[-1][1], 15, on=mon, note="量級檢查（COMEX 與 LME 存在關稅價差），單位已換算 USD/噸")
    M["copper"] = metric("copper", "銅", "cmdty", "USD/lb", cu, "Yahoo HG=F（COMEX 近月）", [cu_chk], 3)

    # ------------------------------------------------------------ 外匯
    dxy_checks = []
    try:
        fx_live = {k: yprice(k) for k in V.DXY_WEIGHTS}
        dxy_checks.append(V.compare("DX-Y.NYB", yprice("dxy"), "六國匯率公式計算", V.dxy_from_fx(fx_live), 0.3,
                                    note="ICE 公式：50.14348112 × EURUSD^-0.576 × USDJPY^0.136 × …"))
    except Exception as e:  # noqa: BLE001
        dxy_checks.append(V.compare(None, None, None, None, 0, note=f"Yahoo 匯率不足：{e}"))
    try:
        fm = {k: V.to_map(F[s]) for k, s in {"EURUSD": "DEXUSEU", "USDJPY": "DEXJPUS", "GBPUSD": "DEXUSUK",
                                             "USDCAD": "DEXCAUS", "USDSEK": "DEXSDUS", "USDCHF": "DEXSZUS"}.items()}
        days = sorted(set.intersection(*(set(m) for m in fm.values())))
        fred_dxy = [[d, V.dxy_from_fx({k: fm[k][d] for k in fm})] for d in days]
        dxy_checks.append(V.compare_series("DX-Y.NYB", ypts("dxy"), "FRED 聯準會匯率計算", fred_dxy, 0.6,
                                           note="聯準會為紐約中午報價，ICE 為收盤，容許 0.6%；聯準會 H.10 每週一才更新上週資料",
                                           max_lag_days=14))
    except Exception as e:  # noqa: BLE001
        dxy_checks.append(V.compare(None, None, None, None, 0, note=f"FRED 匯率不足：{e}"))
    h, src, fb = pick("dxy", "Yahoo DX-Y.NYB（ICE）")
    M["dxy"] = metric("dxy", "美元指數 DXY", "fx", "", h, src, dxy_checks, 2, fallback=fb)
    h, src, fb = pick("usdjpy", "Yahoo JPY=X")
    M["usdjpy"] = metric("usdjpy", "USD/JPY", "fx", "", h, src, fallback=fb, checks=
                         [V.compare_series("JPY=X", ypts("usdjpy"), "FRED DEXJPUS", F.get("DEXJPUS"), 0.8,
                                           note="聯準會紐約中午報價（H.10 每週一更新）", max_lag_days=14)], decimals=2)
    h, src, fb = pick("usdtwd", "Yahoo TWD=X")
    M["usdtwd"] = metric("usdtwd", "USD/TWD", "fx", "", h, src, fallback=fb, checks=
                         [V.compare_series("TWD=X", ypts("usdtwd"), "FRED DEXTAUS", F.get("DEXTAUS"), 0.8,
                                           note="聯準會紐約中午報價（H.10 每週一更新）", max_lag_days=14)], decimals=3)

    # ------------------------------------------------------------ 股市 / 加密 / 波動率
    tw = ypts("taiex")
    tw_fb = False
    if not tw and TW:
        tw, tw_fb = TW, True
    M["taiex"] = metric("taiex", "台股加權指數", "eq", "", tw, "Yahoo ^TWII" if not tw_fb else "證交所（備援）",
                        [V.compare_series("^TWII", tw, "證交所官方 FMTQIK", TW, 0.1)], 2, fallback=tw_fb)
    h, src, fb = pick("spx", "Yahoo ^GSPC")
    M["spx"] = metric("spx", "S&P 500", "eq", "", h, src, fallback=fb, checks=
                      [V.compare_series("^GSPC", ypts("spx"), "FRED SP500", F.get("SP500"), 0.1)], decimals=2)
    M["sox"] = metric("sox", "費城半導體 SOX", "eq", "", ypts("sox"), "Yahoo ^SOX",
                      [V.compare(None, None, None, None, 0, note="無第二個免費來源（指數授權屬 Nasdaq）")], 2)
    h, src, fb = pick("vix", "Yahoo ^VIX")
    M["vix"] = metric("vix", "VIX 恐慌指數", "eq", "", h, src, fallback=fb, checks=
                      [V.compare_series("^VIX", ypts("vix"), "FRED VIXCLS（Cboe）", F.get("VIXCLS"), 1.0)], decimals=2)
    btc_hist = BIN or ypts("btc")
    btc_src = "Binance BTC/USDT（UTC 日切）" if BIN else "Yahoo BTC-USD（備援）"
    btc_px = BIN_PX or (btc_hist[-1][1] if btc_hist else None)
    btc_checks = [
        V.compare("Binance BTCUSDT", btc_px, "CoinGecko BTC/USD", (CG.get("bitcoin") or {}).get("usd"), 0.8),
        V.compare("Binance BTCUSDT", btc_px, "Yahoo BTC-USD", yprice("btc"), 0.8, note="USDT 與 USD 的匯差通常 <0.1%"),
    ]
    if btc_hist and BIN_PX:
        btc_hist = btc_hist[:-1] + [[btc_hist[-1][0], BIN_PX]]
    M["btc"] = metric("btc", "BTC/USDT", "crypto", "USDT", btc_hist, btc_src, btc_checks, 0, fallback=not BIN)

    # ------------------------------------------------------------ 總經（月資料）
    def yoy(s):
        m = V.to_map(s or [])
        res = []
        for d, v in s or []:
            p = f"{int(d[:4]) - 1}{d[4:]}"
            if p in m:
                res.append([d, round((v / m[p] - 1) * 100, 3)])
        return res

    def diff(s):
        return [[b[0], round(b[1] - a[1], 1)] for a, b in zip(s or [], (s or [])[1:])
                if _next_month(a[0]) == b[0]]  # 跳過缺月（例如 2025/10 政府停擺）

    bls = BLS or {}

    def bls_chk(fid, tol):
        return V.compare_series("FRED " + fid, F.get(fid), "BLS 官方 API", bls.get(fid), tol, "abs",
                                max_lag_days=70)

    macro = {
        "cpi": {"name": "CPI 年增率", "unit": "%", "series": yoy(F.get("CPIAUCNS")),
                "checks": [bls_chk("CPIAUCNS", 0.0015)], "source": "FRED CPIAUCNS（未季調，同 BLS 官方年增率算法）"},
        "core": {"name": "核心 CPI 年增率", "unit": "%", "series": yoy(F.get("CPILFENS")),
                 "checks": [bls_chk("CPILFENS", 0.0015)], "source": "FRED CPILFENS（未季調）"},
        "nfp": {"name": "非農新增就業", "unit": "千人", "series": diff(F.get("PAYEMS")),
                "checks": [bls_chk("PAYEMS", 0.5)], "source": "FRED PAYEMS 月差"},
        "unrate": {"name": "失業率", "unit": "%", "series": F.get("UNRATE") or [],
                   "checks": [bls_chk("UNRATE", 0.05)], "source": "FRED UNRATE"},
        "ism": {"name": "ISM 製造業 PMI", "unit": "", "series": ISM,
                "checks": ([{"status": "warn", "a": "已驗證值", "b": "ISM 官網", "va": a, "vb": b,
                             "diff": round(b - a, 2), "tol": 0.05, "unit": "", "on": d,
                             "note": "官網數值與已驗證紀錄不一致（可能為修正值），請人工確認"}
                            for d, (a, b) in ism_conflict.items()]
                           or [V.compare(None, None, None, None, 0,
                                         note=("本次取得新值：" + "、".join(f"{d[:7]}={v}" for d, v in sorted(ISM_NEW.items()))
                                               if ISM_NEW else "本次無新公布值，使用已驗證歷史值")
                                         + ("；新聞比對：" + "；".join(ism_news_note) if ism_news_note else "")
                                         + "；ISM 不授權 FRED，2025/12 以前無免費來源")]),
                "source": "ISM Report On Business（官網 / 媒體轉載 ≥2 家一致）"},
    }
    for k, m in macro.items():
        m["status"] = V.worst(m["checks"]) if m["series"] else "missing"
        m["key"] = k

    # ------------------------------------------------------------ 盤中 & 熱圖
    vix_i = safe("Yahoo ^VIX 5m", S.yahoo_chart, "^VIX", "1d", "5m")
    btc_i = safe("Binance 15m", S.binance_klines, "BTCUSDT", "15m", 96)
    heat = {}
    groups = {
        "sectors": [("XLK", "科技"), ("XLC", "通訊"), ("XLY", "非必需消費"), ("XLF", "金融"), ("XLV", "醫療"),
                    ("XLI", "工業"), ("XLE", "能源"), ("XLP", "必需消費"), ("XLB", "原物料"), ("XLU", "公用事業"),
                    ("XLRE", "不動產")],
        "sox": [("NVDA", "NVIDIA"), ("AVGO", "Broadcom"), ("TSM", "台積電ADR"), ("AMD", "AMD"), ("ASML", "ASML"),
                ("MU", "Micron"), ("QCOM", "Qualcomm"), ("AMAT", "應材"), ("LRCX", "科林"), ("KLAC", "KLA"),
                ("TXN", "德儀"), ("ADI", "ADI"), ("MRVL", "Marvell"), ("INTC", "Intel"), ("ARM", "Arm"),
                ("NXPI", "NXP")],
        "tw": [("2330.TW", "台積電"), ("2317.TW", "鴻海"), ("2454.TW", "聯發科"), ("2308.TW", "台達電"),
               ("2382.TW", "廣達"), ("3711.TW", "日月光"), ("2881.TW", "富邦金"), ("2891.TW", "中信金")],
    }
    all_syms = [(sym, f"Yahoo {sym}", S.yahoo_chart, sym, "1mo", "1d") for lst in groups.values() for sym, _ in lst]
    HR = pmap(all_syms, safe, workers=6) if time.time() - T0 < 360 else {}
    for g, lst in groups.items():
        heat[g] = []
        for sym, nm in lst:
            pts = (HR.get(sym) or {}).get("points") or []
            heat[g].append({"sym": sym, "name": nm, "last": pts[-1][1] if pts else None,
                            "chg": chg(pts, 1), "chg5": chg(pts, 5), "date": pts[-1][0] if pts else None})

    # ------------------------------------------------------------ 資金籌碼與流動性
    FL = {}
    tw_days = [d for d, _ in ((M.get("taiex") or {}).get("history") or [])][-130:]
    t = time.time()
    try:
        cache, n_new, errs = flows_mod.twse_institutional(
            tw_days, arch / "cache" / "twse_inst.json", max_new=15 if time.time() - T0 < 480 else 2, pause=2.0)
        FL["tw_inst"] = flows_mod.tw_inst_block(cache)
        if sum(1 for d in tw_days if d not in cache) > 0:
            FL["tw_inst"]["note"] += f"；歷史回補中（已 {len(FL['tw_inst']['series'])} 天，每次更新補 15 天）"
        log(f"✓ 證交所三大法人 新增 {n_new} 天，快取 {len(cache)} 天 ({time.time() - t:.1f}s)")
        ERRORS.extend(f"證交所三大法人 {e}" for e in errs if "尚未公布" not in e)
    except Exception as e:  # noqa: BLE001
        ERRORS.append(f"證交所三大法人: {type(e).__name__}: {str(e)[:120]}")
    t = time.time()
    try:
        cache, errs = flows_mod.taifex_update(arch / "cache" / "taifex_txf.json")
        second = safe("期交所 OpenAPI", flows_mod.taifex_openapi_check)
        FL["txf"] = flows_mod.txf_block(cache, second)
        log(f"✓ 期交所台指期法人 快取 {len(cache)} 天 ({time.time() - t:.1f}s)")
        ERRORS.extend(f"期交所 {e}" for e in errs)
    except Exception as e:  # noqa: BLE001
        ERRORS.append(f"期交所: {type(e).__name__}: {str(e)[:120]}")
    DTS = safe("財政部 DTS TGA", flows_mod.tga_dts, ago(120))
    FL["netliq"] = flows_mod.netliq_block(F.get("WALCL"), F.get("WDTGAL"), F.get("RRPONTSYD"), F.get("WTREGEN"), DTS)
    for k, b in FL.items():
        b.setdefault("key", k)

    # ------------------------------------------------------------ 沿用上一版（單項失敗時）
    prev = None
    pages = os.environ.get("PAGES_URL")
    if pages:
        try:
            prev = S._get(pages.rstrip("/") + "/data/market.json", retries=1).json()
        except Exception:  # noqa: BLE001
            prev = None
    if prev:
        for k, m in M.items():
            if m["status"] == "missing" and k in prev.get("metrics", {}):
                M[k] = {**prev["metrics"][k], "status": "stale", "note": "本次抓取失敗，沿用上一版資料"}
        for k, m in macro.items():
            if m["status"] == "missing" and k in prev.get("macro", {}):
                macro[k] = {**prev["macro"][k], "status": "stale"}
        for k in ("tw_inst", "txf", "netliq"):
            if (k not in FL or FL[k]["status"] == "missing") and k in prev.get("flows", {}):
                FL[k] = {**prev["flows"][k], "status": "stale", "note": "本次抓取失敗，沿用上一版資料"}

    # ------------------------------------------------------------ 新聞
    news = news_mod.fetch_news()
    (out / "news.json").write_text(S.dumps(news), encoding="utf-8")

    # ------------------------------------------------------------ 事件
    def events_on(d):
        ev = list(CAL.get(d, []))
        y, mth = int(d[:4]), int(d[5:7])
        if S.first_business_day(y, mth) == d:
            ev.append("ISM PMI")
        if d in CONFIG["fomc"]:
            ev.append("FOMC")
        return ev

    upcoming = []
    for i in range(0, 45):
        d = (date.today() + timedelta(days=i)).isoformat()
        for e in events_on(d):
            upcoming.append({"date": d, "event": e})

    # ------------------------------------------------------------ 推敲提問：每 3 個交易日一期（v2）
    qdir = arch / "questions"
    qdate = (M.get("spx") or {}).get("date")
    generated = None
    if qdate:
        close_utc = datetime.fromisoformat(qdate).replace(tzinfo=timezone.utc) + timedelta(hours=21, minutes=15)
        qfile = qdir / f"{qdate}.json"
        force = os.environ.get("FORCE_QUESTIONS") == "1"
        prev = sorted(p for p in qdir.glob("20*.json") if p.stem < qdate)
        prev_ver, prev_date = None, None
        if prev:
            prev_date = prev[-1].stem
            try:
                prev_ver = json.loads(prev[-1].read_text(encoding="utf-8")).get("version")
            except Exception:  # noqa: BLE001
                prev_ver = None
        spx_dates = [d for d, _ in (M.get("spx") or {}).get("history") or []]
        elapsed = sum(1 for d in spx_dates if prev_date and prev_date < d <= qdate) if prev_date else 99
        # 規則：距上一期滿 3 個交易日；若上一期是舊制（v1），下一次收盤就切換新制
        due = elapsed >= cycle_mod.CYCLE or prev_ver != 2
        if (now >= close_utc and not qfile.exists() and due) or force:
            period_from = spx_dates[-1 - cycle_mod.CYCLE] if len(spx_dates) > cycle_mod.CYCLE else qdate
            period = f"{period_from[5:]}→{qdate[5:]}，{cycle_mod.CYCLE} 個交易日"
            built = cycle_mod.build(M, period)
            snap = {k: {"v": M[k].get("last"), "chg_1d": M[k].get("chg_1d"), "rate": M[k]["rate"]}
                    for k in ("vix", "dxy", "us10y", "us02y", "spread", "hy", "usdjpy", "usdtwd", "btc", "taiex",
                              "spx", "sox", "gold", "wti", "copper") if k in M and M[k].get("last") is not None}
            # 期間內的事件
            evs = sorted({e for d in spx_dates if period_from < d <= qdate for e in events_on(d)})
            payload = {"date": qdate, "version": 2, "generated_at": now.isoformat(timespec="seconds"), "engine": "rules",
                       "cycle": {"from": period_from, "to": qdate, "n": cycle_mod.CYCLE}, "events": evs, "snapshot": snap,
                       **built,
                       "headlines": [{"title": n["title"], "url": n["url"], "tags": n["tags"]} for n in news["items"][:8]]}
            qfile.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
            generated = qdate
    idx = []
    for p in sorted(qdir.glob("20*.json")):
        try:
            ev = json.loads(p.read_text(encoding="utf-8")).get("events", [])
        except Exception:  # noqa: BLE001
            ev = []
        idx.append({"d": p.stem, "ev": ev})
    (qdir / "index.json").write_text(json.dumps(idx, ensure_ascii=False), encoding="utf-8")
    shutil.copytree(qdir, out / "questions", dirs_exist_ok=True)

    # ------------------------------------------------------------ 輸出
    allm = list(M.values()) + list(macro.values()) + list(FL.values())
    summary = {s: sum(1 for m in allm if m["status"] == s) for s in ("ok", "warn", "single", "fail", "stale", "missing")}
    market = {
        "updated": now.isoformat(timespec="seconds"),
        "metrics": M, "macro": macro, "flows": FL, "heatmap": heat,
        "intraday": {"vix": (vix_i or {}).get("points") or [], "btc": btc_i or []},
        "events": upcoming[:20],
        "quality": {"summary": summary, "errors": ERRORS + [f"新聞 {e}" for e in news["errors"]]},
        "questions_generated": generated,
    }
    (out / "market.json").write_text(S.dumps(market), encoding="utf-8")
    compact = {
        "updated": market["updated"], "summary": summary, "errors": market["quality"]["errors"],
        "questions_generated": generated,
        "metrics": {k: {f: m.get(f) for f in ("name", "source", "status", "last", "date", "chg_1d", "chg_5d", "checks", "note")}
                    | {"tail": (m.get("history") or [])[-3:]} for k, m in M.items()},
        "macro": {k: {"name": m.get("name"), "status": m.get("status"), "checks": m.get("checks"),
                      "tail": (m.get("series") or [])[-3:]} for k, m in macro.items()},
        "flows": {k: {"name": b.get("name"), "status": b.get("status"), "checks": b.get("checks"), "note": b.get("note"),
                      "n": len(b.get("series") or []), "tail": (b.get("series") or [])[-3:]} for k, b in FL.items()},
        "heatmap_missing": {g: [x["sym"] for x in v if x["chg"] is None] for g, v in heat.items()},
        "heatmap_dates": {g: sorted({x["date"] for x in v if x["date"]}) for g, v in heat.items()},
    }
    (out / "quality.json").write_text(json.dumps(compact, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "config.json").write_text(json.dumps(CONFIG, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False))
    for e in market["quality"]["errors"]:
        print("  !", e)
    for m in allm:
        for c in m.get("checks", []):
            if c["status"] == "warn":
                print(f"  ⚠ {m['name']}: {c['a']}={c['va']} vs {c['b']}={c['vb']} 差 {c['diff']}{c.get('unit','')} (容忍 {c['tol']})")


def _next_month(d):
    y, m = int(d[:4]), int(d[5:7])
    y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return f"{y:04d}-{m:02d}-01"


if __name__ == "__main__":
    try:
        main()
    except Exception:  # noqa: BLE001
        traceback.print_exc()
        sys.exit(1)
