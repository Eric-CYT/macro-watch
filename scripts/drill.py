"""
七邊形各頂點的「延伸板塊」資料（全部免費來源）：
  crypto   穩定幣（USDT+USDC 市值）／BTC／ETH／山寨幣籃子
  spx      美股 S&P 500 權重前 8 大類股 ETF
  taiex    台股權重前 8 大產業指數（證交所 MI_INDEX，增量快取）
  dxy      7 大貨幣對美元（含新台幣），一律換算成「該貨幣升值＝上漲」
  gold     貴金屬：黃金、白銀、鉑、鈀（僅 4 種有公開期貨）＋金礦股、銀礦股
  us10y    美債 3M／2Y／5Y／10Y／30Y（以價格方向：殖利率下跌＝流入）
  wti      能源：WTI、布蘭特、天然氣、汽油、熱燃油、能源股
"""
from __future__ import annotations

import json
import time
from datetime import date, timedelta
from pathlib import Path

import sources as S
import validate as V

KEEP = 260  # 足夠算 30 日本期＋30 日上期＋60 日波動

US_SECTORS = [("XLK", "科技"), ("XLF", "金融"), ("XLC", "通訊"), ("XLY", "非必需消費"),
              ("XLV", "醫療"), ("XLI", "工業"), ("XLP", "必需消費"), ("XLE", "能源")]
# 期交所公布之加權指數產業權重前 8 名（2026）
TW_SECTORS = [("半導體類指數", "半導體"), ("電子零組件類指數", "電子零組件"), ("金融保險類指數", "金融保險"),
              ("電腦及週邊設備類指數", "電腦週邊"), ("其他電子類指數", "其他電子"), ("通信網路類指數", "通信網路"),
              ("塑膠類指數", "塑膠"), ("光電類指數", "光電")]
# (Yahoo 代號, 名稱, 是否需倒數 → 讓「該貨幣升值」＝上漲, FRED 比對代號, FRED 是否同方向報價)
FX = [("EURUSD=X", "歐元", False, "DEXUSEU"), ("JPY=X", "日圓", True, "DEXJPUS"), ("GBPUSD=X", "英鎊", False, "DEXUSUK"),
      ("CNY=X", "人民幣", True, "DEXCHUS"), ("AUDUSD=X", "澳幣", False, "DEXUSAL"), ("CAD=X", "加幣", True, "DEXCAUS"),
      ("TWD=X", "新台幣", True, "DEXTAUS")]
METALS = [("GC=F", "黃金"), ("SI=F", "白銀"), ("PL=F", "鉑金"), ("PA=F", "鈀金"), ("GDX", "金礦股"), ("SIL", "銀礦股")]
ENERGY = [("CL=F", "WTI 原油", "DCOILWTICO"), ("BZ=F", "布蘭特", "DCOILBRENTEU"), ("NG=F", "天然氣", "DHHNGSP"),
          ("RB=F", "汽油", None), ("HO=F", "熱燃油", None), ("XLE", "能源股", None)]
TENORS = [("3 Mo", "3 個月", "DGS3MO"), ("2 Yr", "2 年", "DGS2"), ("5 Yr", "5 年", "DGS5"),
          ("10 Yr", "10 年", "DGS10"), ("30 Yr", "30 年", "DGS30")]
ALTS = [("SOLUSDT", "solana"), ("XRPUSDT", "ripple"), ("BNBUSDT", "binancecoin"),
        ("DOGEUSDT", "dogecoin"), ("ADAUSDT", "cardano"), ("TRXUSDT", "tron")]

YAHOO_EXTRA = sorted({s for s, _ in US_SECTORS} | {"CNY=X", "AUDUSD=X"} | {s for s, _ in METALS} | {s for s, *_ in ENERGY})
FRED_EXTRA = ["DEXCHUS", "DEXUSAL", "DCOILBRENTEU", "DHHNGSP", "DGS3MO", "DGS5", "DGS30"]


def _trim(h):
    return [[d, round(v, 6)] for d, v in (h or [])[-KEEP:] if v is not None]


def item(k, label, hist, source, checks=None, mode="price", note=None):
    checks = checks or []
    return {"k": k, "label": label, "history": _trim(hist), "source": source, "mode": mode, "note": note,
            "checks": checks, "status": (V.worst(checks) if hist else "missing")}


# ---------------------------------------------------------------- 台股產業指數（證交所）
def _mi_parse(j):
    """MI_INDEX type=IND → {指數名稱: 收盤}；同時支援新版 tables[] 與舊版 data1/fields1"""
    if j.get("stat") not in (None, "OK"):
        return None
    out = {}
    blocks = [(t.get("fields") or [], t.get("data") or []) for t in j.get("tables") or []]
    for k, v in j.items():
        if k.startswith("data") and isinstance(v, list):
            blocks.append((j.get("fields" + k[4:]) or [], v))
    for fields, rows in blocks:
        ci = next((i for i, f in enumerate(fields) if "收盤" in str(f)), 1)
        for r in rows:
            if not r or len(r) <= ci:
                continue
            name = str(r[0]).strip()
            v = S._num(r[ci])
            if v is not None and "報酬" not in name:
                out.setdefault(name, v)
    return out or None


def twse_sectors(dates, cache_file: Path, max_new=15, pause=2.0):
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    want = [d for d in sorted(dates, reverse=True) if d not in cache][:max_new]
    errs, n = [], 0
    names = {k for k, _ in TW_SECTORS}
    for d in want:
        try:
            r = S._get("https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX",
                       params={"response": "json", "date": d.replace("-", ""), "type": "IND"}, retries=1)
            p = _mi_parse(r.json())
            if p and names & set(p):
                cache[d] = {k: p[k] for k in names if k in p}
                n += 1
            elif d < (date.today() - timedelta(days=4)).isoformat():
                cache[d] = None
        except Exception as e:  # noqa: BLE001
            errs.append(f"{d} {type(e).__name__}")
            if len(errs) >= 3:
                break
        time.sleep(pause)
    cache_file.write_text(json.dumps(cache, ensure_ascii=False, separators=(",", ":")))
    return cache, n, errs


# ---------------------------------------------------------------- 加密
def basket(series_by_key, weights):
    """市值加權買進持有籃子（共同日期），起點＝100"""
    keys = [k for k in weights if series_by_key.get(k)]
    if not keys:
        return None
    maps = {k: dict(series_by_key[k]) for k in keys}
    common = sorted(set.intersection(*(set(m) for m in maps.values())))
    if len(common) < 70:
        return None
    tot = sum(weights[k] for k in keys)
    base = {k: maps[k][common[0]] for k in keys}
    return [[d, round(100 * sum(weights[k] / tot * maps[k][d] / base[k] for k in keys), 6)] for d in common]


def build(M, Y, F, TR, CG, BIN_ALTS, STABLE, tw_cache, safe_fn=None):
    """Y: {yahoo symbol: {'points','price'}}；F: FRED；TR: 財政部；CG: CoinGecko simple price（含 cap）"""
    yp = lambda s: (Y.get(s) or {}).get("points")  # noqa: E731
    G = {}

    # 加密
    st = {k: v for k, v in (STABLE or {}).items() if v}
    sup = None
    if len(st) == 2:
        mu, mc = dict(st["tether"]), dict(st["usd-coin"])
        sup = [[d, mu[d] + mc[d]] for d in sorted(set(mu) & set(mc))]
    alt_w = {sym: (CG.get(cid) or {}).get("cap") for sym, cid in ALTS}
    alt_w = {k: v for k, v in alt_w.items() if v and BIN_ALTS.get(k)}
    alt = basket(BIN_ALTS, alt_w) if alt_w else None
    alt_checks = []
    for sym, cid in ALTS:
        h, px = BIN_ALTS.get(sym), (CG.get(cid) or {}).get("usd")
        if h and px:
            alt_checks.append(V.compare(f"Binance {sym}", h[-1][1], f"CoinGecko {cid}", px, 1.5,
                                        note="即時價比對（取樣時間不同，容許 1.5%）"))
    tw = sum(alt_w.values()) or 1
    G["crypto"] = {"name": "加密市場", "items": [
        item("stable", "穩定幣 USDT+USDC", sup, "CoinGecko 市值（≈流通量）", mode="supply",
             note="穩定幣流通量增加＝新資金進入加密市場（場外資金入場）",
             checks=[V.compare(None, None, None, None, 0, note="只有 CoinGecko 提供免費每日歷史")]),
        item("btc", "BTC", (M.get("btc") or {}).get("history"), (M.get("btc") or {}).get("source", ""), (M.get("btc") or {}).get("checks")),
        item("eth", "ETH", (M.get("eth") or {}).get("history"), (M.get("eth") or {}).get("source", ""), (M.get("eth") or {}).get("checks")),
        item("alt", "山寨幣籃子", alt, "Binance（SOL/XRP/BNB/DOGE/ADA/TRX 市值加權）", alt_checks,
             note="權重：" + "、".join(f"{k.replace('USDT', '')} {v / tw * 100:.0f}%" for k, v in sorted(alt_w.items(), key=lambda x: -x[1]))),
    ]}

    # 美股類股
    G["spx"] = {"name": "美股類股（S&P 500 權重前 8 大）", "items": [
        item(s, f"{nm}", yp(s), f"Yahoo {s}（類股 ETF）",
             [V.compare(None, None, None, None, 0, note="無第二個免費來源")]) for s, nm in US_SECTORS]}

    # 台股產業指數
    days = sorted(d for d, v in (tw_cache or {}).items() if v)
    G["taiex"] = {"name": "台股產業（加權指數權重前 8 大）", "items": [
        item(k, nm, [[d, tw_cache[d][k]] for d in days if k in tw_cache[d]], "證交所 產業類指數（MI_INDEX）",
             [V.compare(None, None, None, None, 0, note="證交所官方指數，無第二個免費來源")]) for k, nm in TW_SECTORS]}

    # 外匯：一律「該貨幣升值＝上漲」
    fx_items = []
    for sym, nm, inv, fid in FX:
        h = yp(sym)
        hs = [[d, 1 / v] for d, v in h if v] if (h and inv) else h
        chk = [V.compare_series(f"Yahoo {sym}", h, f"FRED {fid}", F.get(fid), 0.8, max_lag_days=14,
                                note="聯準會紐約中午報價（H.10 每週一更新）")]
        fx_items.append(item(sym, nm, hs, f"Yahoo {sym}" + ("（已取倒數）" if inv else ""), chk))
    G["dxy"] = {"name": "7 大貨幣（對美元，升值＝資金流入該貨幣）", "items": fx_items}

    # 貴金屬
    G["gold"] = {"name": "貴金屬", "items": [
        item(s, nm, yp(s), f"Yahoo {s}", (M.get("gold") or {}).get("checks") if s == "GC=F" else
             [V.compare(None, None, None, None, 0, note="無第二個免費每日來源")]) for s, nm in METALS],
        "note": "公開期貨的貴金屬只有金、銀、鉑、鈀 4 種（銠、銥等無免費每日報價），另以金礦股、銀礦股補足 6 項"}

    # 美債
    tn = []
    for key, nm, fid in TENORS:
        h = (TR or {}).get(key) or F.get(fid)
        chk = [V.compare_series("財政部", (TR or {}).get(key), f"FRED {fid}", F.get(fid), 0.011, "abs")]
        tn.append(item(key, nm, h, "美國財政部 Daily Par Yield Curve" if (TR or {}).get(key) else f"FRED {fid}（備援）",
                       chk, mode="bond"))
    G["us10y"] = {"name": "美債短中長期（價格方向：殖利率下跌＝流入）", "items": tn}

    # 能源
    en = []
    for s, nm, fid in ENERGY:
        chk = [V.compare_series(f"Yahoo {s}", yp(s), f"FRED {fid}", F.get(fid), 8.0 if s != "NG=F" else 15.0,
                                max_lag_days=10, note="期貨近月 vs 現貨，量級檢查")] if fid else \
              [V.compare(None, None, None, None, 0, note="無第二個免費每日來源")]
        en.append(item(s, nm, yp(s), f"Yahoo {s}", chk))
    G["wti"] = {"name": "能源", "items": en}
    return G
