"""
資料來源抓取器（全部免費、免 API key）。
每個函式回傳統一格式：
  daily:    [["YYYY-MM-DD", float], ...]  依日期遞增
  intraday: [[unix_seconds, float], ...]
抓取失敗一律丟出例外，由上層決定 fallback 並記錄在 quality 報告中。
"""
from __future__ import annotations

import csv
import io
import json
import math
import time
from datetime import datetime, timedelta, timezone

import requests

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
TIMEOUT = 15
import threading
_yf_lock = threading.Lock()
_yf_state = {"fails": 0, "tripped": False}
YAHOO_TRIP_AFTER = 5  # 連續失敗 N 次 → 本次執行不再打 Yahoo（避免整體超時）

_session = requests.Session()
_session.headers.update({"User-Agent": UA, "Accept": "*/*"})

# Yahoo 對雲端 IP 有反爬；curl_cffi 能模擬瀏覽器 TLS 指紋，失敗再退回 requests
try:  # pragma: no cover - 取決於執行環境
    from curl_cffi import requests as cffi_requests

    _yahoo = cffi_requests.Session(impersonate="chrome")
except Exception:  # noqa: BLE001
    _yahoo = _session


def _get(url, *, session=None, params=None, retries=2, **kw):
    s = session or _session
    last = None
    for i in range(retries):
        try:
            r = s.get(url, params=params, timeout=TIMEOUT, **kw)
            if r.status_code == 200:
                return r
            last = RuntimeError(f"HTTP {r.status_code} {url}")
            if r.status_code in (400, 401, 403, 404):
                break
        except Exception as e:  # noqa: BLE001
            last = e
        if i < retries - 1:
            time.sleep(1.5 * (i + 1))
    raise last or RuntimeError(f"failed {url}")


def _num(x):
    try:
        v = float(str(x).replace(",", "").strip())
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- FRED
def fred(series_id: str, start: str | None = None):
    """FRED。依序嘗試：公開 CSV（瀏覽器指紋）→ 公開 CSV（一般 UA）→ 官方 API（需免費 FRED_API_KEY）。
    '.' 代表缺值（例如假日、政府停擺）。"""
    import os
    params = {"id": series_id}
    if start:
        params["cosd"] = start
    errs = []
    attempts = [(_yahoo, {}), (_session, {"headers": {"User-Agent": "macro-watch/1.0 (+github actions)"}})]
    for sess, kw in attempts:
        try:
            r = _get("https://fred.stlouisfed.org/graph/fredgraph.csv", session=sess, params=params, retries=1, **kw)
            if not r.text.lstrip().lower().startswith(("observation_date", "date")):
                raise RuntimeError("回應不是 CSV（可能被阻擋）")
            rows = list(csv.reader(io.StringIO(r.text)))
            out = [[row[0][:10], _num(row[1])] for row in rows[1:] if len(row) >= 2 and _num(row[1]) is not None]
            if out:
                return out
            raise RuntimeError("empty")
        except Exception as e:  # noqa: BLE001
            errs.append(str(e)[:80])
    key = os.environ.get("FRED_API_KEY")
    if key:
        p = {"series_id": series_id, "api_key": key, "file_type": "json"}
        if start:
            p["observation_start"] = start
        r = _get("https://api.stlouisfed.org/fred/series/observations", params=p, retries=2)
        out = [[o["date"], _num(o["value"])] for o in r.json()["observations"] if _num(o["value"]) is not None]
        if out:
            return out
    raise RuntimeError(f"FRED {series_id} 全部方式失敗: {' | '.join(errs)}")


# ---------------------------------------------------------------- 美國財政部
def treasury_yields(years_back: int = 2):
    """美國財政部官方 Daily Par Yield Curve。回傳 {'2 Yr': daily, '10 Yr': daily}"""
    now = datetime.now(timezone.utc)
    res: dict[str, list] = {"2 Yr": [], "10 Yr": []}
    for y in range(now.year - years_back, now.year + 1):
        url = (
            "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
            f"daily-treasury-rates.csv/{y}/all"
        )
        r = _get(url, params={"type": "daily_treasury_yield_curve",
                              "field_tdr_date_value": str(y), "page": "", "_format": "csv"})
        for row in csv.DictReader(io.StringIO(r.text)):
            d = datetime.strptime(row["Date"], "%m/%d/%Y").strftime("%Y-%m-%d")
            for k in res:
                v = _num(row.get(k))
                if v is not None:
                    res[k].append([d, v])
    for k in res:
        res[k] = sorted({d: v for d, v in res[k]}.items())
        res[k] = [list(x) for x in res[k]]
        if not res[k]:
            raise RuntimeError(f"Treasury {k} empty")
    return res


# ---------------------------------------------------------------- Yahoo Finance
def yahoo_chart(symbol: str, rng: str = "2y", interval: str = "1d"):
    """回傳 dict(meta, points)。日期以交易所當地時區計算。含熔斷：Yahoo 被擋時快速失敗。"""
    if _yf_state["tripped"]:
        raise RuntimeError("Yahoo 已熔斷（本次執行連續失敗過多，改用備援來源）")
    last = None
    res = None
    for host in ("query1", "query2"):
        try:
            r = _get(
                f"https://{host}.finance.yahoo.com/v8/finance/chart/{symbol}",
                session=_yahoo,
                params={"range": rng, "interval": interval, "includePrePost": "false"},
                retries=1,
            )
            res = r.json()["chart"]["result"][0]
            break
        except Exception as e:  # noqa: BLE001
            last = e
    with _yf_lock:
        if res is None:
            _yf_state["fails"] += 1
            if _yf_state["fails"] >= YAHOO_TRIP_AFTER:
                _yf_state["tripped"] = True
        else:
            _yf_state["fails"] = 0
    if res is None:
        raise RuntimeError(f"Yahoo {symbol}: {last}")

    meta = res.get("meta", {})
    ts = res.get("timestamp") or []
    closes = res["indicators"]["quote"][0].get("close") or []
    off = int(meta.get("gmtoffset") or 0)
    pts = []
    for t, c in zip(ts, closes):
        v = _num(c)
        if v is None:
            continue
        if interval.endswith("d") or interval.endswith("wk") or interval.endswith("mo"):
            lt = datetime.fromtimestamp(t + off, tz=timezone.utc)
            # CME 期貨（CL=F、GC=F、HG=F…）的日 K 時間戳記是「前一晚 18:00 開盤」，
            # 當地時間 16 點以後的戳記代表隔天的交易日
            if lt.hour >= 16:
                lt += timedelta(days=1)
            pts.append([lt.strftime("%Y-%m-%d"), v])
        else:
            pts.append([int(t), v])
    if interval.endswith("d"):  # 同日去重（保留最後一筆）
        pts = [list(x) for x in dict((d, v) for d, v in pts).items()]
    if not pts:
        raise RuntimeError(f"Yahoo {symbol} empty")
    return {
        "points": pts,
        "price": _num(meta.get("regularMarketPrice")),
        "time": meta.get("regularMarketTime"),
        "prev_close": _num(meta.get("chartPreviousClose") or meta.get("previousClose")),
        "currency": meta.get("currency"),
    }


# ---------------------------------------------------------------- 加密貨幣
def binance_klines(symbol="BTCUSDT", interval="1d", limit=730):
    """Binance 公開行情鏡像 data-api.binance.vision（不受地區限制、免 key）。日 K 以 UTC 日切。"""
    r = _get("https://data-api.binance.vision/api/v3/klines",
             params={"symbol": symbol, "interval": interval, "limit": min(limit, 1000)})
    out = []
    for k in r.json():
        t = int(k[0]) // 1000
        c = _num(k[4])
        if interval.endswith("d"):
            out.append([datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y-%m-%d"), c])
        else:
            out.append([t, c])
    return out


def binance_price(symbol="BTCUSDT"):
    r = _get("https://data-api.binance.vision/api/v3/ticker/price", params={"symbol": symbol})
    return _num(r.json()["price"])


def coingecko_history(coin_id: str, days: int = 365):
    """CoinGecko 日線（UTC）。用於黃金備援：PAXG 為 1 枚 = 1 金衡盎司實體黃金的代幣。"""
    r = _get(f"https://api.coingecko.com/api/v3/coins/{coin_id}/market_chart",
             params={"vs_currency": "usd", "days": str(days), "interval": "daily"})
    out = {}
    for t, v in r.json()["prices"]:
        out[datetime.fromtimestamp(t / 1000, tz=timezone.utc).strftime("%Y-%m-%d")] = _num(v)
    return [[d, v] for d, v in sorted(out.items()) if v]


def coingecko_prices(ids=("bitcoin", "pax-gold")):
    r = _get("https://api.coingecko.com/api/v3/simple/price",
             params={"ids": ",".join(ids), "vs_currencies": "usd", "include_last_updated_at": "true"})
    j = r.json()
    return {k: {"usd": _num(v.get("usd")), "t": v.get("last_updated_at")} for k, v in j.items()}


# ---------------------------------------------------------------- 台灣證交所
def _roc_to_iso(s: str):
    s = str(s).strip().replace("/", "")
    if len(s) == 7:  # 1151030
        return f"{int(s[:3]) + 1911:04d}-{s[3:5]}-{s[5:7]}"
    if len(s) == 8:  # 20261030
        return f"{s[:4]}-{s[4:6]}-{s[6:8]}"
    raise ValueError(s)


def twse_taiex():
    """證交所官方：本月每日加權指數收盤（FMTQIK）。回傳 daily list。"""
    out = []
    try:
        r = _get("https://openapi.twse.com.tw/v1/exchangeReport/FMTQIK")
        for row in r.json():
            d = row.get("Date") or row.get("日期")
            v = _num(row.get("TAIEX") or row.get("發行量加權股價指數"))
            if d and v:
                out.append([_roc_to_iso(d), v])
    except Exception:  # noqa: BLE001
        pass
    if not out:  # 後備：官網 rwd JSON
        r = _get("https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK",
                 params={"response": "json", "date": datetime.now().strftime("%Y%m%d")})
        j = r.json()
        fields = j.get("fields", [])
        di = 0
        vi = next(i for i, f in enumerate(fields) if "加權" in f)
        for row in j.get("data", []):
            out.append([_roc_to_iso(row[di]), _num(row[vi])])
    out = [x for x in out if x[1]]
    if not out:
        raise RuntimeError("TWSE empty")
    return sorted(out)


# ---------------------------------------------------------------- BLS（官方原始發布）
BLS_SERIES = {
    "CUSR0000SA0": "CPIAUCSL",   # CPI-U 全項目 季調
    "CUSR0000SA0L1E": "CPILFESL",  # 核心 CPI 季調
    "CES0000000001": "PAYEMS",   # 非農就業 千人 季調
    "LNS14000000": "UNRATE",     # 失業率 季調
}


def bls_latest():
    """BLS Public API v1（免 key，每日 25 次額度 → 上層有節流）。回傳 {FRED_ID: [[YYYY-MM-01, v], ...]}"""
    r = requests.post(
        "https://api.bls.gov/publicAPI/v1/timeseries/data/",
        json={"seriesid": list(BLS_SERIES)},
        headers={"User-Agent": UA, "Content-Type": "application/json"},
        timeout=TIMEOUT,
    )
    j = r.json()
    if j.get("status") != "REQUEST_SUCCEEDED":
        raise RuntimeError(f"BLS {j.get('status')} {j.get('message')}")
    out = {}
    for s in j["Results"]["series"]:
        pts = []
        for d in s["data"]:
            if not d["period"].startswith("M") or d["period"] == "M13":
                continue
            v = _num(d["value"])
            if v is not None:
                pts.append([f"{d['year']}-{d['period'][1:]}-01", v])
        out[BLS_SERIES[s["seriesID"]]] = sorted(pts)
    return out


# ---------------------------------------------------------------- ISM PMI（DBnomics 鏡像）
def ism_pmi():
    """ISM 製造業 PMI。ISM 自 2016 起不再授權 FRED；DBnomics 提供免費鏡像（2019 起）。"""
    r = _get("https://api.db.nomics.world/v22/series/ISM/pmi/pm",
             params={"observations": "1", "format": "json"})
    doc = r.json()["series"]["docs"][0]
    out = []
    for p, v in zip(doc["period"], doc["value"]):
        v = _num(v)
        if v is not None:
            out.append([f"{p[:7]}-01", v])
    if not out:
        raise RuntimeError("ISM empty")
    return out


# ---------------------------------------------------------------- 經濟日曆（BLS 官方 ICS）
def bls_release_calendar():
    """回傳 {'YYYY-MM-DD': ['CPI', 'NFP', ...]}。失敗回傳空 dict。"""
    try:
        r = _get("https://www.bls.gov/schedule/news_release/bls.ics", retries=1)
    except Exception:  # noqa: BLE001
        return {}
    cal: dict[str, list] = {}
    cur = {}
    for line in r.text.splitlines():
        if line.startswith("BEGIN:VEVENT"):
            cur = {}
        elif line.startswith("DTSTART"):
            cur["d"] = line.split(":")[-1][:8]
        elif line.startswith("SUMMARY"):
            cur["s"] = line.split(":", 1)[-1]
        elif line.startswith("END:VEVENT") and "d" in cur:
            s = cur.get("s", "")
            tag = None
            if "Consumer Price Index" in s:
                tag = "CPI"
            elif "Employment Situation" in s:
                tag = "NFP"
            elif "Producer Price Index" in s:
                tag = "PPI"
            if tag:
                d = f"{cur['d'][:4]}-{cur['d'][4:6]}-{cur['d'][6:8]}"
                cal.setdefault(d, []).append(tag)
    return cal


def first_business_day(year: int, month: int) -> str:
    """ISM 於每月第一個「美國營業日」發布：跳過週末、元旦與勞動節(九月第一個週一)。"""
    d = datetime(year, month, 1)
    while (d.weekday() >= 5 or (d.month == 1 and d.day == 1)
           or (d.month == 9 and d.weekday() == 0 and d.day <= 7)):
        d += timedelta(days=1)
    return d.strftime("%Y-%m-%d")


def dumps(o):
    return json.dumps(o, ensure_ascii=False, separators=(",", ":"))
