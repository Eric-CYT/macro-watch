"""
離線測試（不連網）：驗證公式、比對邏輯、提問生成，並以模擬來源跑完整管線。
python scripts/test_pipeline.py            → 執行測試
python scripts/test_pipeline.py --sample   → 另外產出「樣本資料」到 public/data（僅供本機預覽，會標示 SAMPLE）
"""
import json
import math
import random
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import validate as V  # noqa: E402


def test_dxy_formula():
    # 2024 年 4 月中附近的實際量級：EURUSD≈1.065, USDJPY≈154.5, GBPUSD≈1.245, USDCAD≈1.378, USDSEK≈10.93, USDCHF≈0.912
    # 當時 DXY 約 106.0~106.3。公式方向（正負指數）若寫錯，結果會偏離數十點。
    v = V.dxy_from_fx({"EURUSD": 1.065, "USDJPY": 154.5, "GBPUSD": 1.245,
                       "USDCAD": 1.378, "USDSEK": 10.93, "USDCHF": 0.912})
    assert 105.0 < v < 107.5, v
    # 權重總和 = 1（絕對值）
    assert abs(sum(abs(w) for w in V.DXY_WEIGHTS.values()) - 1.0) < 1e-9
    # 歐元升值 1% → DXY 約跌 0.576%
    base = {"EURUSD": 1.1, "USDJPY": 150, "GBPUSD": 1.3, "USDCAD": 1.35, "USDSEK": 10, "USDCHF": 0.85}
    up = dict(base, EURUSD=1.1 * 1.01)
    r = V.dxy_from_fx(up) / V.dxy_from_fx(base) - 1
    assert abs(r - (1.01 ** -0.576 - 1)) < 1e-12


def test_compare():
    a = [["2026-10-28", 4.10], ["2026-10-29", 4.12], ["2026-10-30", 4.15]]
    b = [["2026-10-28", 4.10], ["2026-10-29", 4.12]]  # 晚一天
    c = V.compare_series("A", a, "B", b, 0.011, "abs")
    assert c["status"] == "ok" and c["on"] == "2026-10-29", c
    c = V.compare_series("A", a, "B", [["2026-10-29", 4.20]], 0.011, "abs")
    assert c["status"] == "warn" and abs(c["diff"] + 0.08) < 1e-9, c
    c = V.compare_series("A", a, "B", [["2026-09-01", 4.12]], 0.011, "abs")
    assert c["status"] == "single", c  # 太舊不比
    c = V.compare("A", 100.0, "B", 100.5, 0.6)
    assert c["status"] == "ok" and c["diff"] < 0
    assert V.worst([{"status": "ok"}, {"status": "warn"}]) == "warn"


def test_ism_business_day():
    import sources as S
    assert S.first_business_day(2026, 11) == "2026-11-02"  # 11/1 週日
    assert S.first_business_day(2027, 1) == "2027-01-04"   # 1/1 週五元旦 → 週一
    assert S.first_business_day(2025, 9) == "2025-09-02"   # 9/1 勞動節
    assert S._roc_to_iso("1151030") == "2026-10-30"


BFI_SAMPLE = {"stat": "OK", "date": "20261030", "title": "115年10月30日 三大法人買賣金額統計表",
              "fields": ["單位名稱", "買進金額", "賣出金額", "買賣差額"],
              "data": [["自營商(自行買賣)", "3,000,000,000", "2,500,000,000", "500,000,000"],
                       ["自營商(避險)", "10,000,000,000", "11,200,000,000", "-1,200,000,000"],
                       ["投信", "6,000,000,000", "4,000,000,000", "2,000,000,000"],
                       ["外資及陸資(不含外資自營商)", "150,000,000,000", "162,345,678,900", "-12,345,678,900"],
                       ["外資自營商", "10,000,000", "4,000,000", "6,000,000"],  # 已含在自營商內
                       ["合計", "169,000,000,000", "180,045,678,900", "-11,045,678,900"]]}

TAIFEX_CSV = ("日期,商品名稱,身份別,多方交易口數,多方交易契約金額(千元),空方交易口數,空方交易契約金額(千元),"
              "多空交易口數淨額,多空交易契約金額淨額(千元),多方未平倉口數,多方未平倉契約金額(千元),"
              "空方未平倉口數,空方未平倉契約金額(千元),多空未平倉口數淨額,多空未平倉契約金額淨額(千元)\n"
              "2026/06/18,臺股期貨,自營商,5782,53658901,5728,53248379,54,410522,4252,39855646,4189,39276059,63,579587\n"
              "2026/06/18,臺股期貨,投信,1880,17543845,366,3415539,1514,14128307,63555,594264672,4958,46359283,58597,547905389\n"
              "2026/06/18,臺股期貨,外資,63627,590169033,63404,588143609,223,2025425,10085,94303824,78422,733360226,-68337,-639056402\n"
              "2026/06/18,小型臺指期貨,外資,1,1,1,1,0,0,1,1,1,1,-999,-999\n")


def test_flows_parsers():
    import flows as FLW
    p = FLW._bfi_parse(BFI_SAMPLE)
    assert p["foreign"] == -12_345_678_900 and p["foreign_dealer"] == 6_000_000
    assert p["dealer"] == -700_000_000 and p["trust"] == 2_000_000_000 and p["total"] == -11_045_678_900
    b = FLW.tw_inst_block({"2026-10-30": p})
    assert b["series"][-1] == ["2026-10-30", -123.46, 20.0, -7.0, -110.46], b["series"][-1]
    assert b["checks"][0]["status"] == "ok", b["checks"]
    assert FLW._bfi_parse({"stat": "很抱歉，沒有符合條件的資料!"}) is None
    t = FLW._taifex_parse(TAIFEX_CSV)
    # 期交所網頁 2026/06/18：外資 TX 未平倉淨額 -68,337 口、投信 58,597、自營商 63（小台不可混入）
    assert t == {"2026-06-18": {"dealer": 63, "trust": 58597, "foreign": -68337}}, t
    import drill as DRL
    old = {"stat": "OK", "fields1": ["指數", "收盤指數"], "data1": [["半導體類指數", "1,234.56"], ["半導體類報酬指數", "9,999"]]}
    new = {"stat": "OK", "tables": [{"fields": ["指數", "收盤指數", "漲跌(+/-)"], "data": [["光電類指數", "88.10", "-"]]}]}
    assert DRL._mi_parse(old) == {"半導體類指數": 1234.56} and DRL._mi_parse(new) == {"光電類指數": 88.1}
    b = DRL.basket({"A": [["d1", 10], ["d2", 11]] * 1, "B": [["d1", 100], ["d2", 90]]}, {"A": 3, "B": 1})
    assert b is None  # 共同日期 < 70 不建籃子
    hA = [[f"d{i:03d}", 10 + i] for i in range(80)]; hB = [[f"d{i:03d}", 100.0] for i in range(80)]
    b = DRL.basket({"A": hA, "B": hB}, {"A": 3, "B": 1})
    assert abs(b[1][1] - 100 * (0.75 * 11 / 10 + 0.25)) < 1e-9, b[1]
    # 淨流動性單位：WALCL/WDTGAL 百萬、RRP 十億
    # 以 H.4.1（2026/10/29 發布）實際數字：TGA 週三 1,015,632、週平均 999,727（百萬）
    nl = FLW.netliq_block([["2026-10-28", 6_745_600.0]], [["2026-10-28", 1_015_632.0]],
                          [["2026-10-27", 2.0], ["2026-10-29", 9.0]], [["2026-10-28", 999_727.0]],
                          [["2026-10-28", 1_015_632.0]])
    assert nl["series"][-1] == ["2026-10-28", 5.728, 6.7456, 1.0156, 0.002], nl["series"]
    assert [c["status"] for c in nl["checks"]] == ["ok", "ok"], nl["checks"]


def test_notify():
    import os
    import notify as N
    from datetime import datetime
    cfg = json.loads((Path(__file__).resolve().parent.parent / "shared" / "config.json").read_text(encoding="utf-8"))
    h = lambda vals: [[f"2026-10-{20 + i:02d}", v] for i, v in enumerate(vals)]  # noqa: E731
    M = {"spx": {"date": "2026-10-23", "history": h([100, 101, 102, 103])},
         "dxy": {"history": h([100, 100.5, 101, 101.5]), "chg_1d": 0.5, "chg_5d": 1.2},
         "us10y": {"history": h([4.0, 4.05, 4.1, 4.2]), "chg_1d": 10.0, "chg_5d": 25.0},
         "us02y": {"chg_1d": 6.0, "chg_5d": 13.0},
         "wti": {"history": h([60, 59, 58, 57])}, "usdjpy": {"chg_1d": -0.3, "chg_5d": -0.5}}
    FL = {"txf": {"series": [["2026-10-22", -80000, 0, 0], ["2026-10-23", -86000, 0, 0]]},
          "tw_inst": {"series": [["2026-10-23", -612.3, 50.0, -10.0, -572.3]]}}
    al = [a[0] for a in N.alerts(M, cfg)]
    assert al == ["liquidity", "valuation"], al  # DXY+0.5%&2Y+6bp；10Y+10bp；日圓未觸發
    names, st = N.scenarios(M)
    assert names == ["強勢美元吸金"] and st == {"dxy": "up", "us10y": "up", "wti": "down", "spx": "up"}, (names, st)
    keys = [e[0] for e in N.build_events(M, FL, cfg, None)]
    assert "txf:2026-10-23" in keys and "inst:2026-10-23" in keys and "alert:liquidity:2026-10-23" in keys, keys
    # 夜間延遲：台北 03:00 一般通知延到 07:30；緊急(5)立即；白天不延遲
    t3 = datetime(2026, 11, 3, 3, 0, tzinfo=N.TPE)
    assert N._delay_for(3, t3) == str(int(datetime(2026, 11, 3, 7, 30, tzinfo=N.TPE).timestamp()))
    assert N._delay_for(5, t3) is None and N._delay_for(3, datetime(2026, 11, 3, 9, 0, tzinfo=N.TPE)) is None
    # 去重：首次只送確認訊息；第二次相同狀態不送；新題目、情境改變才送
    got = []
    snd = lambda *a: got.append(a[1])  # noqa: E731
    with tempfile.TemporaryDirectory() as td:
        sf = Path(td) / "s.json"
        os.environ["NTFY_TOPIC"] = "test-topic"
        try:
            assert N.run(M, FL, cfg, None, sf, sender=snd)[0] == 1 and "啟用" in got[-1]
            assert N.run(M, FL, cfg, None, sf, sender=snd)[0] == 0
            assert N.run(M, FL, cfg, "2026-10-23", sf, sender=snd, qinfo={"focus_names": ["台股"]})[0] == 1 and "推敲" in got[-1]
            M2 = json.loads(json.dumps(M)); M2["dxy"]["history"][-1][1] = 99  # 美元 3 日轉跌 → 情境改變
            n = N.run(M2, FL, cfg, None, sf, sender=snd)[0]
            assert n == 1 and "情境" in got[-1], (n, got)
            assert N.run(M2, FL, cfg, None, sf, sender=snd)[0] == 0
            assert N.run(M, FL, cfg, None, sf, sender=snd)[0] == 1  # 換回原情境也要通知
        finally:
            del os.environ["NTFY_TOPIC"]


def _walk(start, n, drift=0.0, vol=0.01, seed=1, rate=False):
    rnd = random.Random(seed)
    d0 = date.fromisoformat("2026-11-02") - timedelta(days=int(n * 1.45))
    out, v, d = [], start, d0
    while len(out) < n:
        d += timedelta(days=1)
        if d.weekday() >= 5:
            continue
        v = v + rnd.gauss(drift, vol) if rate else v * math.exp(rnd.gauss(drift, vol))
        out.append([d.isoformat(), round(v, 4)])
    return out


def _monthly(start, n, step, vol, seed):
    rnd = random.Random(seed)
    out, v = [], start
    y, m = 2010, 1
    for _ in range(n):
        v += step + rnd.gauss(0, vol)
        out.append([f"{y:04d}-{m:02d}-01", round(v, 3)])
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def install_mocks():
    """把 sources 裡所有連網函式換成合成資料（量級接近 2026 年底）。"""
    import news
    import sources as S

    base = {
        "^TNX": (4.1, 0.04, True), "CL=F": (62, 0.02, False), "GC=F": (3900, 0.01, False), "HG=F": (5.0, 0.015, False),
        "DX-Y.NYB": (99.5, 0.004, False), "JPY=X": (152, 0.005, False), "TWD=X": (30.6, 0.003, False),
        "^TWII": (27500, 0.012, False), "BTC-USD": (108000, 0.03, False), "ETH-USD": (3900, 0.04, False), "^VIX": (17, 0.06, False),
        "^GSPC": (6800, 0.008, False), "^SOX": (7000, 0.02, False), "EURUSD=X": (1.155, 0.004, False),
        "GBPUSD=X": (1.32, 0.004, False), "CAD=X": (1.40, 0.003, False), "SEK=X": (9.45, 0.005, False),
        "CHF=X": (0.80, 0.004, False),
    }

    def yahoo_chart(sym, rng="2y", interval="1d"):
        if interval != "1d":
            pts = [[1_793_000_000 + i * 300, 17 + math.sin(i / 8)] for i in range(78)]
            return {"points": pts, "price": pts[-1][1]}
        s, vol, rate = base.get(sym, (100, 0.015, False))
        pts = _walk(s, 500, vol=vol, seed=hash(sym) % 999, rate=rate)
        return {"points": pts, "price": pts[-1][1], "prev_close": pts[-2][1]}

    tr10 = _walk(4.1, 500, vol=0.04, seed=11, rate=True)
    tr2 = _walk(3.55, 500, vol=0.04, seed=12, rate=True)

    def fred(sid, start=None):
        if sid == "DGS10":
            return tr10[:-1]
        if sid == "DGS2":
            return tr2[:-1]
        if sid == "T10Y2Y":
            return [[a[0], round(a[1] - b[1], 2)] for a, b in zip(tr10, tr2)][:-1]
        if sid in ("CPIAUCNS",):
            return _monthly(218, 200, 0.45, 0.2, 1)
        if sid == "CPILFENS":
            return _monthly(220, 200, 0.45, 0.15, 2)
        if sid == "PAYEMS":
            return _monthly(130000, 200, 130, 80, 3)
        if sid == "UNRATE":
            return [[d, round(4 + math.sin(i / 20), 1)] for i, (d, _) in enumerate(_monthly(0, 200, 0, 0, 4))]
        if sid in ("WALCL", "WDTGAL", "WTREGEN"):
            wk = [d for d, _ in _walk(1, 900) if date.fromisoformat(d).weekday() == 2]
            lv = {"WALCL": 6_700_000.0, "WDTGAL": 880_000.0, "WTREGEN": 880_000.0}[sid]
            return [[d, round(lv * (1 + 0.02 * math.sin(i / 7)), 1)] for i, d in enumerate(wk)]
        if sid == "RRPONTSYD":
            return [[d, round(abs(5 * math.sin(i / 30)), 3)] for i, (d, _) in enumerate(_walk(1, 900))]
        if sid == "PCOPPUSDM":
            return [["2026-09-01", 10900.0]]
        mp = {"DCOILWTICO": "CL=F", "DEXJPUS": "JPY=X", "DEXTAUS": "TWD=X", "VIXCLS": "^VIX", "SP500": "^GSPC",
              "DEXUSEU": "EURUSD=X", "DEXUSUK": "GBPUSD=X", "DEXCAUS": "CAD=X", "DEXSDUS": "SEK=X", "DEXSZUS": "CHF=X"}
        if sid in mp:
            return yahoo_chart(mp[sid])["points"][:-1]
        return _walk(3.0, 500, vol=0.03, seed=7, rate=True)

    S.yahoo_chart = yahoo_chart
    S.fred = fred

    # ---- 資金籌碼與流動性
    import flows as FLW

    class _R:
        def __init__(self, j):
            self._j = j

        def json(self):
            return self._j

    real_get = S._get

    def fake_get(url, **kw):
        if "BFI82U" in url:
            d = kw["params"]["dayDate"]
            rnd = random.Random(int(d))
            f, t_, dl = rnd.gauss(0, 8e9), rnd.gauss(0, 2e9), rnd.gauss(0, 1e9)
            return _R({"stat": "OK", "fields": ["單位名稱", "買進金額", "賣出金額", "買賣差額"], "data": [
                ["自營商(自行買賣)", "0", "0", f"{dl:.0f}"], ["投信", "0", "0", f"{t_:.0f}"],
                ["外資及陸資(不含外資自營商)", "0", "0", f"{f:.0f}"], ["合計", "0", "0", f"{f + t_ + dl:.0f}"]]})
        if "fiscaldata" in url:
            return _R({"data": [{"record_date": d, "account_type": "Treasury General Account (TGA) Closing Balance",
                                 "open_today_bal": str(v), "close_today_bal": "null"} for d, v in fred("WDTGAL")[-20:]]})
        if "MI_INDEX" in url:
            d = kw["params"]["date"]
            rnd = random.Random(int(d))
            names = ["半導體類指數", "電子零組件類指數", "金融保險類指數", "電腦及週邊設備類指數", "其他電子類指數",
                     "通信網路類指數", "塑膠類指數", "光電類指數"]
            base = (date.fromisoformat(f"{d[:4]}-{d[4:6]}-{d[6:]}") - date(2026, 1, 1)).days
            return _R({"stat": "OK", "tables": [{"title": "價格指數", "fields": ["指數", "收盤指數", "漲跌(+/-)"],
                       "data": [[n, f"{1000 * (1 + 0.001 * base + 0.01 * rnd.gauss(0, 1)) * (i + 1):,.2f}", "+"] for i, n in enumerate(names)]
                       + [["半導體類報酬指數", "99999", "+"]]}]})
        if "openapi.taifex" in url:
            raise RuntimeError("mock: 404")
        return real_get(url, **kw)

    S._get = fake_get
    FLW.time.sleep = lambda s: None

    def taifex_txf(start, end):
        out, d = {}, start
        while d <= end:
            if d.weekday() < 5:
                rnd = random.Random(d.toordinal())
                out[d.isoformat()] = {"foreign": int(rnd.gauss(-30000, 8000)), "trust": int(rnd.gauss(40000, 5000)),
                                      "dealer": int(rnd.gauss(0, 3000))}
            d += timedelta(days=1)
        return out
    FLW.taifex_txf = taifex_txf
    S.treasury_yields = lambda years_back=2: {"10 Yr": tr10, "2 Yr": tr2}
    S.binance_klines = lambda sym="BTCUSDT", interval="1d", limit=730: (
        yahoo_chart("ETH-USD" if sym == "ETHUSDT" else "BTC-USD")["points"] if interval == "1d" else
        [[1_793_000_000 + i * 900, 108000 + 500 * math.sin(i / 9)] for i in range(96)])
    S.binance_price = lambda sym="BTCUSDT": yahoo_chart("ETH-USD" if sym == "ETHUSDT" else "BTC-USD")["price"]
    _cg0 = lambda: {"bitcoin": {"usd": yahoo_chart("BTC-USD")["price"] * 1.001, "cap": 2.15e12},
                                         "ethereum": {"usd": yahoo_chart("ETH-USD")["price"] * 0.999, "cap": 4.7e11},
                                         "pax-gold": {"usd": yahoo_chart("GC=F")["price"] * 0.99}}
    S.coingecko_prices = lambda ids=(): ({cid: {"usd": yahoo_chart("BTC-USD")["price"] * 1.001, "cap": 1e11 / (i + 1)}
                                          for i, cid in enumerate(ids)} if "solana" in ids else _cg0())
    S.coingecko_caps_history = lambda cid, days=365: [[d, (1.8e11 if cid == "tether" else 7.5e10) * v / 108000]
                                                      for d, v in yahoo_chart("BTC-USD")["points"][-366:]]
    S.twse_taiex = lambda: yahoo_chart("^TWII")["points"][-20:]
    S.ism_latest = lambda: {"2026-09-01": 54.5}
    S.ism_from_news = lambda: {"2026-10-01": {53.9: ["PR Newswire", "Textile World"]}, "2026-08-01": {54.6: ["A"]}}
    S.bls_latest = lambda: {"CPIAUCNS": fred("CPIAUCNS")[-24:], "CPILFENS": fred("CPILFENS")[-24:],
                            "PAYEMS": fred("PAYEMS")[-24:], "UNRATE": fred("UNRATE")[-24:]}
    S.bls_release_calendar = lambda: {"2026-11-13": ["CPI"], "2026-11-06": ["NFP"]}
    news.fetch_news = lambda limit=80: {"updated": 0, "errors": [], "items": [
        {"title": t, "url": "https://example.com", "source": src, "t": 1793000000 - i * 600, "tags": news.tag(t)}
        for i, (t, src) in enumerate([
            ("Fed's Warsh signals patience on further rate cuts as inflation stays sticky", "CNBC"),
            ("Treasury yields climb after strong jobs data", "MarketWatch"),
            ("TSMC October revenue jumps on AI chip demand", "Google News"),
            ("台積電法說後外資連三買 台股挑戰新高", "鉅亨網"),
            ("Oil falls as OPEC+ weighs output increase", "CNBC"),
            ("Bitcoin slips as dollar strengthens; ETF outflows continue", "CoinDesk"),
            ("日銀總裁暗示12月升息 日圓急升", "鉅亨網"),
            ("Tariff tensions between US and China resurface", "Google News"),
        ])]}


def test_full_pipeline(sample_out=None):
    install_mocks()
    import build_data as B
    with tempfile.TemporaryDirectory() as td:
        out = Path(sample_out) if sample_out else Path(td) / "out"
        arch = Path(td) / "arch"
        sys.argv = ["x", "--out", str(out), "--archive", str(arch)]
        import os
        os.environ["FORCE_QUESTIONS"] = "1"
        B.main()
        m = json.loads((out / "market.json").read_text())
        for k in ("us10y", "us02y", "spread", "hy", "wti", "gold", "copper", "dxy", "usdjpy", "usdtwd",
                  "taiex", "spx", "sox", "vix", "btc", "eth"):
            assert k in m["metrics"] and m["metrics"][k]["history"], k
        assert m["metrics"]["us10y"]["checks"][0]["status"] == "ok"
        assert m["metrics"]["eth"]["history"] and m["metrics"]["eth"]["status"] == "ok", m["metrics"]["eth"]["checks"]
        w = m["crypto_weights"]
        assert abs(w["btc"] + w["eth"] - 1) < 1e-3 and abs(w["btc"] - 2.15 / 2.62) < 1e-3, w
        assert m["metrics"]["spread"]["checks"][0]["status"] == "ok"
        assert m["metrics"]["dxy"]["checks"][0]["status"] in ("ok", "warn")
        for k in ("cpi", "core", "nfp", "unrate", "ism"):
            assert m["macro"][k]["series"], k
        DR = m["drill"]
        assert set(DR) == {"crypto", "spx", "taiex", "dxy", "gold", "us10y", "wti"}, DR.keys()
        n_items = {g: len(b["items"]) for g, b in DR.items()}
        assert n_items == {"crypto": 4, "spx": 8, "taiex": 8, "dxy": 7, "gold": 6, "us10y": 5, "wti": 6}, n_items
        for g, b in DR.items():
            for it in b["items"]:
                assert it["history"], (g, it["k"], it["status"])
        twd = next(i for i in DR["dxy"]["items"] if i["k"] == "TWD=X")
        # 新台幣：Yahoo TWD=X 約 30.6（台幣/美元）→ 倒數後約 0.0327（升值＝上漲）
        assert 0.02 < twd["history"][-1][1] < 0.05, twd["history"][-1]
        assert DR["us10y"]["items"][0]["mode"] == "bond" and len(DR["taiex"]["items"][0]["history"]) == 30
        FLx = m["flows"]
        assert len(FLx["tw_inst"]["series"]) == 15 and FLx["tw_inst"]["checks"][0]["status"] == "ok" \
            and FLx["tw_inst"]["status"] == "single", FLx["tw_inst"]
        assert len(FLx["txf"]["series"]) > 100 and FLx["txf"]["checks"][0]["status"] == "single"
        nl = FLx["netliq"]
        assert nl["series"] and 5 < nl["series"][-1][1] < 7 and nl["checks"][0]["status"] == "ok", nl["checks"]
        print("淨流動性最新：", nl["series"][-1], "｜法人：", FLx["tw_inst"]["series"][-1])
        qi = json.loads((out / "questions" / "index.json").read_text())
        q = json.loads((out / "questions" / f"{qi[-1]['d']}.json").read_text())
        assert q["version"] == 2 and len(q["questions"]) == 6, (q.get("version"), len(q["questions"]))
        assert len(q["focus"]) == 2 and set(q["markets"]) <= set(["dxy", "gold", "btc", "spx", "taiex", "us10y", "wti"])
        assert all(len(m["questions"]) == 3 for m in q["markets"].values())
        A = q["assessment"]
        assert A["regime"] and A["liquidity"] and A["text"] and len(A["rows"]) == 7
        if sample_out:
            m["SAMPLE"] = True
            (out / "market.json").write_text(json.dumps(m, ensure_ascii=False))
        print("資金動向評估：")
        for l in A["text"]:
            print("  ", l)
        print("焦點市場：", q["focus"])
        for x in q["questions"]:
            print(" -", x["text"][:160])


if __name__ == "__main__":
    test_dxy_formula()
    test_compare()
    test_ism_business_day()
    test_flows_parsers()
    test_notify()
    sample = None
    if "--sample" in sys.argv:
        sample = str(Path(__file__).resolve().parent.parent / "public" / "data")
    test_full_pipeline(sample)
    print("ALL TESTS PASSED")
