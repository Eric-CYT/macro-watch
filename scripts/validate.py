"""
交叉比對邏輯：把同一指標的兩個獨立來源，在「同一個日期」上比較。
狀態：
  ok      兩源差異在容忍度內
  warn    差異超出容忍度（前端顯示黃色 ⚠，並列出兩邊數值）
  single  只有單一可用來源（前端顯示灰色「單一來源」）
  fail    主來源抓不到，已改用備援來源
"""
from __future__ import annotations

import math
from datetime import date

# ICE 美元指數官方公式（權重自 1999 歐元取代後未變）
DXY_CONST = 50.14348112
DXY_WEIGHTS = {  # 匯率報價方式: 指數
    "EURUSD": -0.576,
    "USDJPY": 0.136,
    "GBPUSD": -0.119,
    "USDCAD": 0.091,
    "USDSEK": 0.042,
    "USDCHF": 0.036,
}


def dxy_from_fx(fx: dict) -> float:
    """fx 需含六個貨幣對（報價方式需與 DXY_WEIGHTS 的 key 一致）"""
    v = DXY_CONST
    for k, w in DXY_WEIGHTS.items():
        x = fx[k]
        if not x or x <= 0:
            raise ValueError(f"bad fx {k}={x}")
        v *= x ** w
    return v


def to_map(series):
    return {d: v for d, v in series}


def common_latest(a, b, max_lag_days: int = 7):
    """找兩序列共同最新日期。回傳 (date, va, vb) 或 None"""
    ma, mb = to_map(a), to_map(b)
    common = sorted(set(ma) & set(mb))
    if not common:
        return None
    d = common[-1]
    # 避免拿很舊的日期來比（例如某源停更）
    latest = max(a[-1][0], b[-1][0])
    lag = (date.fromisoformat(latest) - date.fromisoformat(d)).days
    if lag > max_lag_days:
        return None
    return d, ma[d], mb[d]


def compare(name_a, val_a, name_b, val_b, tol, mode="pct", on=None, note=None):
    if val_a is None or val_b is None or not all(map(math.isfinite, (val_a, val_b))):
        return {"status": "single", "a": name_a, "b": name_b, "va": val_a, "vb": val_b,
                "on": on, "note": note or "比對來源無資料"}
    if mode == "pct":
        diff = (val_a - val_b) / val_b * 100 if val_b else float("inf")
        unit = "%"
    else:
        diff = val_a - val_b
        unit = ""
    status = "ok" if abs(diff) <= tol else "warn"
    return {
        "status": status, "a": name_a, "b": name_b,
        "va": round(val_a, 6), "vb": round(val_b, 6),
        "diff": round(diff, 4), "tol": tol, "unit": unit, "mode": mode,
        "on": on, "note": note,
    }


def compare_series(name_a, a, name_b, b, tol, mode="pct", scale_b=1.0, note=None, max_lag_days=7):
    if not a or not b:
        return compare(name_a, None, name_b, None, tol, mode, note="其中一個來源抓取失敗")
    hit = common_latest(a, b, max_lag_days)
    if not hit:
        return compare(name_a, None, name_b, None, tol, mode, note="兩來源沒有近期共同日期")
    d, va, vb = hit
    return compare(name_a, va, name_b, vb * scale_b, tol, mode, on=d, note=note)


def worst(checks):
    order = {"warn": 3, "fail": 2, "single": 1, "ok": 0}
    if not checks:
        return "single"
    return max((c["status"] for c in checks), key=lambda s: order.get(s, 0))
