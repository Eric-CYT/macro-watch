"""
真實部位／資金數據（全部免費、官方來源）：
  1. 外資各產業持股比率   證交所 MI_QFIIS_cat（每日，增量快取）
  2. 台指選擇權 Put/Call  期交所 pcRatioDown（每日，CSV）
     外資台指選擇權部位   期交所 callsAndPutsDateDown（TXO，買權／賣權未平倉淨金額）
  3. CFTC 持倉報告        美國商品期貨交易委員會 Legacy Futures Only（每週五公布、週二資料）
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

# ================================================================ 1. 外資產業持股
QFII_KEYS = {  # drill.TW_SECTORS 的指數名稱 → MI_QFIIS_cat 產業別關鍵字
    "半導體類指數": "半導體", "電子零組件類指數": "電子零組件", "金融保險類指數": "金融保險",
    "電腦及週邊設備類指數": "電腦及週邊", "其他電子類指數": "其他電子", "通信網路類指數": "通信網路",
    "塑膠類指數": "塑膠", "光電類指數": "光電",
}


def _qfii_parse(j):
    """→ {指數名稱: 外資持股比率(%)}"""
    if j.get("stat") not in (None, "OK") or not j.get("data"):
        return None
    f = j.get("fields") or []
    ri = next((i for i, x in enumerate(f) if "比率" in str(x)), len(f) - 1)
    out = {}
    for row in j["data"]:
        name = str(row[0]).strip()
        v = S._num(row[ri])
        if v is None:
            continue
        for idx, kw in QFII_KEYS.items():
            if kw in name and idx not in out:
                out[idx] = v
    return out or None


def twse_qfii(dates, cache_file: Path, max_new=30, pause=2.0):
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {}
    want = [d for d in sorted(dates, reverse=True) if d not in cache][:max_new]
    errs, n = [], 0
    for d in want:
        try:
            r = S._get("https://www.twse.com.tw/rwd/zh/fund/MI_QFIIS_cat",
                       params={"response": "json", "date": d.replace("-", "")}, retries=1)
            p = _qfii_parse(r.json())
            if p:
                cache[d] = p
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


# ================================================================ 2. 台指選擇權
def _csv_rows(raw: bytes):
    for enc in ("big5", "cp950", "utf-8-sig"):
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        text = raw.decode("cp950", errors="replace")
    rows = [r for r in csv.reader(io.StringIO(text)) if r]
    return rows


def _col(head, *keys, exclude=()):
    for i, h in enumerate(head):
        if all(k in h for k in keys) and not any(x in h for x in exclude):
            return i
    raise KeyError(keys)


def _post(url, data):
    sess = getattr(S, "_yahoo", S._session)
    r = sess.post(url, data=data, headers={"User-Agent": S.UA, "Referer": url.replace("Down", "")}, timeout=S.TIMEOUT)
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}")
    return r.content


def _pc_parse(rows):
    """pcRatioDown → {date: {'pc_oi': %, 'pc_vol': %, 'put_oi', 'call_oi'}}"""
    head = [h.strip() for h in rows[0]]
    di = _col(head, "日期")
    poi, coi = _col(head, "賣權未平倉"), _col(head, "買權未平倉")
    pv, cv = _col(head, "賣權成交量"), _col(head, "買權成交量")
    roi = _col(head, "未平倉", "比率")
    rvol = _col(head, "成交量", "比率")
    out = {}
    for r in rows[1:]:
        try:
            d = r[di].strip().replace("/", "-")
            out[d] = {"pc_oi": S._num(r[roi]), "pc_vol": S._num(r[rvol]), "put_oi": S._num(r[poi]), "call_oi": S._num(r[coi]),
                      "put_vol": S._num(r[pv]), "call_vol": S._num(r[cv])}
        except (IndexError, AttributeError):
            continue
    return out


def _txo_parse(rows):
    """callsAndPutsDateDown（TXO）→ {date: {'call': 外資買權未平倉淨金額(千元), 'put': ..., 'call_lots', 'put_lots'}}"""
    head = [h.strip() for h in rows[0]]
    di, ki, wi = _col(head, "日期"), _col(head, "買賣權"), _col(head, "身份")
    amt = _col(head, "未平倉", "金額", "淨額")
    lots = _col(head, "未平倉", "口數", "淨額")
    out = {}
    for r in rows[1:]:
        if len(r) <= max(di, ki, wi, amt, lots) or "外資" not in r[wi]:
            continue
        d = r[di].strip().replace("/", "-")
        side = "call" if "買權" in r[ki] or r[ki].strip().upper() == "CALL" else "put"
        o = out.setdefault(d, {})
        o[side] = S._num(r[amt])
        o[side + "_lots"] = S._num(r[lots])
    return {d: v for d, v in out.items() if "call" in v and "put" in v}


def taifex_options(cache_file: Path, backfill_days=200, refresh_days=12):
    cache = json.loads(cache_file.read_text()) if cache_file.exists() else {"pc": {}, "txo": {}}
    today = date.today()
    start = today - timedelta(days=backfill_days if len(cache["pc"]) < 60 else refresh_days)
    errs = []
    s = start
    while s <= today:
        e = min(s + timedelta(days=29), today)
        q = {"queryStartDate": s.strftime("%Y/%m/%d"), "queryEndDate": e.strftime("%Y/%m/%d")}
        try:
            cache["pc"].update(_pc_parse(_csv_rows(_post("https://www.taifex.com.tw/cht/3/pcRatioDown", q))))
        except Exception as ex:  # noqa: BLE001
            errs.append(f"P/C {s}~{e} {type(ex).__name__}: {str(ex)[:50]}")
        time.sleep(0.8)
        try:
            cache["txo"].update(_txo_parse(_csv_rows(_post("https://www.taifex.com.tw/cht/3/callsAndPutsDateDown",
                                                           {**q, "commodityId": "TXO"}))))
        except Exception as ex:  # noqa: BLE001
            errs.append(f"TXO {s}~{e} {type(ex).__name__}: {str(ex)[:50]}")
        time.sleep(0.8)
        s = e + timedelta(days=1)
    cache_file.write_text(json.dumps(cache, separators=(",", ":")))
    return cache, errs


def options_block(cache, keep=160):
    pc, txo = cache.get("pc", {}), cache.get("txo", {})
    days = sorted(pc)[-keep:]
    series = []
    for d in days:
        p, t = pc[d], txo.get(d) or {}
        series.append([d, p.get("pc_oi"), p.get("pc_vol"),
                       round(t["call"] / 1e5, 2) if t.get("call") is not None else None,   # 千元 → 億元
                       round(t["put"] / 1e5, 2) if t.get("put") is not None else None])
    checks = []
    if days:
        p = pc[days[-1]]
        if p.get("put_oi") and p.get("call_oi"):
            checks.append(V.compare("期交所公布 P/C 未平倉比", p.get("pc_oi"), "賣權÷買權未平倉 自行計算",
                                    p["put_oi"] / p["call_oi"] * 100, 0.02, "abs", on=days[-1],
                                    note="同一張官方表內部勾稽（%）"))
    return {
        "key": "options", "name": "台指選擇權 Put/Call 與外資部位", "unit": "%／億元",
        "source": "期交所 臺指選擇權 Put/Call Ratios、三大法人-選擇權買賣權分計（TXO）",
        "fields": ["P/C 未平倉比(%)", "P/C 成交量比(%)", "外資買權淨金額(億)", "外資賣權淨金額(億)"],
        "note": "P/C 未平倉比 >100％＝賣權留倉較多（常被視為支撐、偏多）；外資買權淨金額為正＝偏多布局，賣權淨金額為正＝避險／偏空",
        "series": series, "checks": checks,
        "status": ("warn" if V.worst(checks) == "warn" else "single") if series else "missing",
    }


# ================================================================ 3. CFTC 持倉
CFTC = [("088691", "gold", "黃金"), ("067651", "wti", "WTI 原油"), ("097741", "jpy", "日圓"),
        ("043602", "ust10", "美債 10Y 期貨"), ("13874A", "es", "S&P 500 E-mini"), ("133741", "btc", "比特幣（CME）")]


def cftc_cot(years=3):
    codes = ",".join(f"'{c}'" for c, *_ in CFTC)
    since = (date.today() - timedelta(days=365 * years + 14)).isoformat()
    r = S._get("https://publicreporting.cftc.gov/resource/6dca-aqww.json",
               params={"$where": f"cftc_contract_market_code in({codes}) AND report_date_as_yyyy_mm_dd >= '{since}'",
                       "$limit": 5000, "$order": "report_date_as_yyyy_mm_dd"}, retries=2)
    rows = r.json()
    if not isinstance(rows, list) or not rows:
        raise RuntimeError("CFTC 無資料")
    k0 = rows[0].keys()
    fk = lambda *ks: next(k for k in k0 if all(x in k for x in ks))  # noqa: E731
    kl, ks, koi = fk("noncomm_positions_long_all"), fk("noncomm_positions_short_all"), fk("open_interest_all")
    out = {}
    for row in rows:
        c = row.get("cftc_contract_market_code")
        d = str(row.get("report_date_as_yyyy_mm_dd", ""))[:10]
        lo, sh, oi = S._num(row.get(kl)), S._num(row.get(ks)), S._num(row.get(koi))
        if c and d and lo is not None and sh is not None and oi:
            out.setdefault(c, {})[d] = [lo - sh, oi]
    return {c: sorted([d, *v] for d, v in m.items()) for c, m in out.items()}


def cftc_block(raw):
    items = []
    for code, k, nm in CFTC:
        s = (raw or {}).get(code) or []
        if not s:
            items.append({"k": k, "label": nm, "series": [], "status": "missing"})
            continue
        nets = [x[1] for x in s]
        last = s[-1]
        pct = sum(1 for x in nets if x <= last[1]) / len(nets) * 100  # 3 年百分位
        items.append({"k": k, "label": nm, "code": code, "series": [[d, net, round(net / oi * 100, 2)] for d, net, oi in s][-160:],
                      "date": last[0], "net": last[1], "net_oi": round(last[1] / last[2] * 100, 2),
                      "chg_1w": last[1] - s[-2][1] if len(s) > 1 else None, "pctile": round(pct, 1), "status": "single"})
    return {"key": "cftc", "name": "CFTC 投機部位（非商業淨部位）", "items": items,
            "source": "美國 CFTC Commitments of Traders（Legacy，期貨）",
            "note": "非商業（大型投機者）多單 − 空單。3 年百分位 >90％＝極度擁擠做多、<10％＝極度擁擠做空，兩端都是反轉風險；每週五公布、資料截至週二",
            "checks": [V.compare(None, None, None, None, 0, note="CFTC 官方唯一來源")],
            "status": "single" if any(i["series"] for i in items) else "missing"}
