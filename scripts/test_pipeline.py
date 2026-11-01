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
        "^TWII": (27500, 0.012, False), "BTC-USD": (108000, 0.03, False), "^VIX": (17, 0.06, False),
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
        if sid in ("CPIAUCSL",):
            return _monthly(218, 200, 0.45, 0.2, 1)
        if sid == "CPILFESL":
            return _monthly(220, 200, 0.45, 0.15, 2)
        if sid == "PAYEMS":
            return _monthly(130000, 200, 130, 80, 3)
        if sid == "UNRATE":
            return [[d, round(4 + math.sin(i / 20), 1)] for i, (d, _) in enumerate(_monthly(0, 200, 0, 0, 4))]
        if sid == "PCOPPUSDM":
            return [["2026-09-01", 10900.0]]
        mp = {"DCOILWTICO": "CL=F", "DEXJPUS": "JPY=X", "DEXTAUS": "TWD=X", "VIXCLS": "^VIX", "SP500": "^GSPC",
              "DEXUSEU": "EURUSD=X", "DEXUSUK": "GBPUSD=X", "DEXCAUS": "CAD=X", "DEXSDUS": "SEK=X", "DEXSZUS": "CHF=X"}
        if sid in mp:
            return yahoo_chart(mp[sid])["points"][:-1]
        return _walk(3.0, 500, vol=0.03, seed=7, rate=True)

    S.yahoo_chart = yahoo_chart
    S.fred = fred
    S.treasury_yields = lambda years_back=2: {"10 Yr": tr10, "2 Yr": tr2}
    S.binance_klines = lambda sym="BTCUSDT", interval="1d", limit=730: (
        yahoo_chart("BTC-USD")["points"] if interval == "1d" else
        [[1_793_000_000 + i * 900, 108000 + 500 * math.sin(i / 9)] for i in range(96)])
    S.binance_price = lambda sym="BTCUSDT": yahoo_chart("BTC-USD")["price"]
    S.coingecko_prices = lambda ids=(): {"bitcoin": {"usd": yahoo_chart("BTC-USD")["price"] * 1.001},
                                         "pax-gold": {"usd": yahoo_chart("GC=F")["price"] * 0.99}}
    S.twse_taiex = lambda: yahoo_chart("^TWII")["points"][-20:]
    S.ism_pmi = lambda: [[d, round(49 + 2 * math.sin(i / 6), 1)] for i, (d, _) in enumerate(_monthly(0, 200, 0, 0, 5))][-90:]
    S.bls_latest = lambda: {"CPIAUCSL": fred("CPIAUCSL")[-24:], "CPILFESL": fred("CPILFESL")[-24:],
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
                  "taiex", "spx", "sox", "vix", "btc"):
            assert k in m["metrics"] and m["metrics"][k]["history"], k
        assert m["metrics"]["us10y"]["checks"][0]["status"] == "ok"
        assert m["metrics"]["spread"]["checks"][0]["status"] == "ok"
        assert m["metrics"]["dxy"]["checks"][0]["status"] in ("ok", "warn")
        for k in ("cpi", "core", "nfp", "unrate", "ism"):
            assert m["macro"][k]["series"], k
        qi = json.loads((out / "questions" / "index.json").read_text())
        q = json.loads((out / "questions" / f"{qi[-1]['d']}.json").read_text())
        assert len(q["questions"]) == 3 and all(x["text"] for x in q["questions"])
        if sample_out:
            m["SAMPLE"] = True
            (out / "market.json").write_text(json.dumps(m, ensure_ascii=False))
        print("問題範例：")
        for x in q["questions"]:
            print(" -", x["text"])


if __name__ == "__main__":
    test_dxy_formula()
    test_compare()
    test_ism_business_day()
    sample = None
    if "--sample" in sys.argv:
        sample = str(Path(__file__).resolve().parent.parent / "public" / "data")
    test_full_pipeline(sample)
    print("ALL TESTS PASSED")
