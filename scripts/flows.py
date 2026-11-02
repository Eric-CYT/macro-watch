"""
資金籌碼與流動性（全部免費、官方來源）：
  1. 台股三大法人現貨買賣超  — 證交所 BFI82U（一天一次請求 → 增量快取、節流）
  2. 三大法人台指期淨未平倉  — 期交所 futContractsDateDown（Big5 CSV，按月區間下載）
  3. 聯準會淨流動性          — FRED WALCL − WDTGAL − RRPONTSYD（單位換算後）
     第二來源：財政部 Daily Treasury Statement（TGA 收盤餘額）、FRED WTREGEN（週平均）
"""
from __future__ import annotations

import csv
import io
import json
import time
from datetime import date, timedelta
from pathlib import Path

import sources as S
import validate as V

UNIT_YI = 1e8  # 億元


# ================================================================ 1. 證交所三大法人
def _bfi_parse(j):
    """BFI82U 回傳 → {'foreign','foreign_dealer','trust','dealer','total'}（元）。
    列名（2017 後）：自營商(自行買賣)、自營商(避險)、投信、外資及陸資(不含外資自營商)、外資自營商、合計"""
    if j.get("stat") != "OK" or not j.get("data"):
        return None
    fields = j.get("fields") or []
    ni = next((i for i, f in enumerate(fields) if "差額" in f), 3)
    out = {"foreign": 0.0, "foreign_dealer": 0.0, "trust": 0.0, "dealer": 0.0, "total": None}
    for row in j["data"]:
        name = str(row[0]).strip()
        v = S._num(row[ni])
        if v is None:
            continue
        if name.startswith("合計"):
            out["total"] = v
        elif name.startswith("外資自營商"):
            out["foreign_dealer"] += v
        elif name.startswith("外資"):
            out["foreign"] += v
        elif name.startswith("投信"):
            out["trust"] += v
        elif name.startswith("自營商"):
            out["dealer"] += v
    return out if out["total"] is not None else None


def twse_institutional(dates, cache_file: Path, max_new=20, pause=1.2):
    """dates：台股交易日（由 TAIEX 歷史取得，自動避開假日）。只抓快取沒有的日期，新到舊、每次最多 max_new 天。"""
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    want = [d for d in sorted(dates, reverse=True) if d not in cache][:max_new]
    fetched, errs = 0, []
    for i, d in enumerate(want):
        try:
            r = S._get("https://www.twse.com.tw/rwd/zh/fund/BFI82U",
                       params={"response": "json", "dayDate": d.replace("-", ""), "type": "day"}, retries=1)
            p = _bfi_parse(r.json())
            if p:
                cache[d] = p
                fetched += 1
            elif d < (date.today() - timedelta(days=4)).isoformat():
                cache[d] = None  # 確定無資料（非交易日）→ 記錄下來，避免每次重抓
            elif i == 0:
                errs.append(f"{d} 尚未公布")
        except Exception as e:  # noqa: BLE001
            errs.append(f"{d} {type(e).__name__}")
            if len(errs) >= 3:  # 連續出錯（可能被限流）→ 下次再補
                break
        time.sleep(pause)
    cache_file.write_text(json.dumps(cache, ensure_ascii=False, separators=(",", ":")))
    return cache, fetched, errs


def tw_inst_block(cache, keep=120):
    days = sorted(d for d, v in cache.items() if v)[-keep:]
    series = []
    for d in days:
        c = cache[d]
        f = c["foreign"]  # 外資自營商已計入自營商，證交所合計列也不重複計入
        series.append([d, round(f / UNIT_YI, 2), round(c["trust"] / UNIT_YI, 2),
                       round(c["dealer"] / UNIT_YI, 2), round(c["total"] / UNIT_YI, 2)])
    checks = []
    if days:
        c = cache[days[-1]]
        parts = c["foreign"] + c["trust"] + c["dealer"]
        checks.append(V.compare("各法人加總", parts / UNIT_YI, "證交所合計列", c["total"] / UNIT_YI, 0.05, "abs",
                                on=days[-1], note="同一張官方表內部勾稽（單位：億元）；外部對照請看證交所三大法人買賣金額統計表"))
    return {
        "key": "tw_inst", "name": "台股三大法人買賣超", "unit": "億元",
        "source": "證交所 BFI82U 三大法人買賣金額統計表",
        "fields": ["外資", "投信", "自營商", "合計"],
        "note": ("外資＝外資及陸資(不含外資自營商)；自營商＝自行買賣＋避險（外資自營商已含在內）。"
                 "證交所網頁版投信不含「綜合帳戶」，晚間媒體報導的投信數字可能多出數億元"),
        "series": series, "checks": checks,
        # 只有內部勾稽、沒有獨立第二來源 → 誠實標「單一來源」；勾稽不符才升為 warn
        "status": ("warn" if V.worst(checks) == "warn" else "single") if series else "missing",
    }


# ================================================================ 2. 期交所台指期法人未平倉
def _taifex_parse(text):
    """futContractsDateDown CSV（Big5 已解碼）→ {date: {'foreign','trust','dealer'}}（口，多空未平倉淨額）"""
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return {}
    head = [h.strip() for h in rows[0]]

    def col(*keys, exclude=()):
        for i, h in enumerate(head):
            if all(k in h for k in keys) and not any(x in h for x in exclude):
                return i
        raise KeyError(keys)

    di = col("日期")
    pi = col("商品")
    ii = col("身份")
    oi = col("未平倉", "口數", "淨額", exclude=("金額",))
    out = {}
    for r in rows[1:]:
        if len(r) <= max(di, pi, ii, oi):
            continue
        prod = r[pi].strip()
        if prod not in ("臺股期貨", "台股期貨", "TX"):
            continue
        who = r[ii].strip()
        k = "foreign" if "外資" in who else "trust" if "投信" in who else "dealer" if "自營" in who else None
        v = S._num(r[oi])
        if not k or v is None:
            continue
        d = r[di].strip().replace("/", "-")
        out.setdefault(d, {})[k] = int(v)
    return {d: v for d, v in out.items() if "foreign" in v}


def taifex_txf(start: date, end: date):
    sess = getattr(S, "_yahoo", S._session)
    r = sess.post("https://www.taifex.com.tw/cht/3/futContractsDateDown",
                  data={"queryStartDate": start.strftime("%Y/%m/%d"), "queryEndDate": end.strftime("%Y/%m/%d"),
                        "commodityId": "TXF"},
                  headers={"User-Agent": S.UA, "Referer": "https://www.taifex.com.tw/cht/3/futContractsDate"},
                  timeout=S.TIMEOUT)
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}")
    raw = r.content
    for enc in ("big5", "cp950", "utf-8-sig"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = raw.decode("cp950", errors="replace")
    res = _taifex_parse(text)
    if not res and "日期" not in text[:200]:
        raise RuntimeError("非 CSV 回應（可能查無資料或被擋）")
    return res


def taifex_update(cache_file: Path, backfill_days=200, refresh_days=10):
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    today = date.today()
    start = today - timedelta(days=backfill_days if len(cache) < 60 else refresh_days)
    errs = []
    s = start
    while s <= today:  # 按月切段，避免單次區間過長被拒
        e = min(s + timedelta(days=30), today)
        try:
            cache.update(taifex_txf(s, e))
        except Exception as ex:  # noqa: BLE001
            errs.append(f"{s}~{e} {type(ex).__name__}: {str(ex)[:60]}")
        s = e + timedelta(days=1)
        time.sleep(0.8)
    cache_file.write_text(json.dumps(cache, separators=(",", ":")))
    return cache, errs


def taifex_openapi_check():
    """第二來源：期交所 OpenAPI（同日資料）。欄位名稱以關鍵字辨識，辨識不到即回傳 None（顯示單一來源）。"""
    r = S._get("https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate",
               retries=1)
    rows = r.json()
    for row in rows:
        vals = {str(k): str(v) for k, v in row.items()}
        joined = " ".join(vals.values())
        if not (("臺股期貨" in joined or "TX " in joined + " ") and "外資" in joined):
            continue
        dk = next((k for k in vals if "Date" in k or "日期" in k), None)
        ok = next((k for k in vals if ("OpenInterest" in k or "未平倉" in k) and ("Net" in k or "淨額" in k)
                   and "Amount" not in k and "Value" not in k and "金額" not in k), None)
        if dk and ok:
            d = vals[dk].strip().replace("/", "-")
            if len(d) == 8 and d.isdigit():
                d = f"{d[:4]}-{d[4:6]}-{d[6:]}"
            return d, S._num(vals[ok])
    return None


def txf_block(cache, second=None, keep=120):
    days = sorted(cache)[-keep:]
    series = [[d, cache[d].get("foreign"), cache[d].get("trust"), cache[d].get("dealer")] for d in days]
    checks = []
    if second and second[0] in cache:
        checks.append(V.compare("期交所下載 CSV", cache[second[0]]["foreign"], "期交所 OpenAPI", second[1], 0, "abs",
                                on=second[0], note="外資台指期多空未平倉淨口數，兩個官方出口須完全一致"))
    else:
        checks.append(V.compare("期交所下載 CSV", None, "期交所 OpenAPI", None, 0, "abs",
                                note="第二來源本次無同日資料；請對照期交所「三大法人-區分各期貨契約」"))
    return {
        "key": "txf", "name": "台指期三大法人淨未平倉", "unit": "口",
        "source": "期交所 三大法人-區分各期貨契約（臺股期貨 TX）",
        "fields": ["外資", "投信", "自營商"],
        "note": "多空未平倉口數淨額；正＝淨多單、負＝淨空單（僅大台 TX，不含小台）",
        "series": series, "checks": checks,
        "status": V.worst(checks) if series else "missing",
    }


# ================================================================ 3. 聯準會淨流動性
def tga_dts(start: str):
    """財政部 Daily Treasury Statement：TGA 收盤餘額（百萬美元）。
    2021/10 後的格式：account_type='Treasury General Account (TGA) Closing Balance'，數值放在 open_today_bal。"""
    r = S._get("https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/dts/operating_cash_balance",
               params={"filter": f"record_date:gte:{start}", "sort": "record_date", "page[size]": 1000,
                       "fields": "record_date,account_type,open_today_bal,close_today_bal"})
    out = {}
    for row in r.json().get("data", []):
        at = row.get("account_type", "")
        if "Treasury General Account" in at and "Closing Balance" in at:
            v = S._num(row.get("close_today_bal")) or S._num(row.get("open_today_bal"))
            if v:
                out[row["record_date"]] = v
    if not out:
        raise RuntimeError("DTS 無 TGA 收盤列")
    return sorted([d, v] for d, v in out.items())


def _asof(series_map_sorted, d):
    """取 <= d 的最後一筆（序列已排序的 list）"""
    best = None
    for x, v in series_map_sorted:
        if x <= d:
            best = v
        else:
            break
    return best


def netliq_block(walcl, tga, rrp, wtregen=None, dts=None):
    """WALCL、WDTGAL、WTREGEN：百萬美元（H.4.1）；RRPONTSYD：十億美元（紐約聯準會）→ 統一成「兆美元」"""
    if not walcl or not tga:
        return {"key": "netliq", "name": "聯準會淨流動性", "series": [], "checks": [], "status": "missing",
                "source": "FRED WALCL − WDTGAL − RRPONTSYD", "unit": "兆美元"}
    tmap = V.to_map(tga)
    rrp = rrp or []
    series = []
    for d, w in walcl:
        t = tmap.get(d)
        r = _asof(rrp, d)
        if t is None or r is None:
            continue
        nl = w - t - r * 1000
        series.append([d, round(nl / 1e6, 4), round(w / 1e6, 4), round(t / 1e6, 4), round(r / 1e3, 4)])
    checks = []
    if dts:
        checks.append(V.compare_series("FRED WDTGAL（週三）", tga, "財政部 DTS TGA 收盤", dts, 1.0, "pct",
                                       note="同一個週三的 TGA 餘額，Fed H.4.1 與財政部日報應幾乎相同", max_lag_days=10))
    else:
        checks.append(V.compare("FRED WDTGAL", None, "財政部 DTS", None, 1.0, note="財政部 API 本次抓取失敗"))
    if wtregen:
        checks.append(V.compare_series("FRED WDTGAL（週三）", tga, "FRED WTREGEN（週平均）", wtregen, 12.0, "pct",
                                       max_lag_days=10,
                                       note="週平均 vs 週三水位，報稅/發債週會有落差，僅作量級檢查（容忍 12%）"))
    return {
        "key": "netliq", "name": "聯準會淨流動性", "unit": "兆美元",
        "source": "FRED WALCL − WDTGAL − RRPONTSYD（H.4.1 週三水位）",
        "fields": ["淨流動性", "Fed 總資產", "TGA", "隔夜逆回購"],
        "note": "淨流動性＝Fed 資產負債表 − 財政部 TGA 存款 − 隔夜逆回購；上升代表市場可用美元變多",
        "series": series[-160:], "checks": checks,
        "status": V.worst(checks) if series else "missing",
    }
