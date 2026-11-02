/** 部位計算、交易結果（R 倍數）、績效統計 —— 純函式，方便測試 */

// 契約規格（期交所公告）：臺股期貨 TX 每點 200 元、小型臺指 MTX 每點 50 元、微型臺指 TMF 每點 10 元
export const INSTRUMENTS = {
  tx: { name: '台指期 大台（TX）', pv: 200, unit: '口', step: 1 },
  mtx: { name: '台指期 小台（MTX）', pv: 50, unit: '口', step: 1 },
  tmf: { name: '台指期 微台（TMF）', pv: 10, unit: '口', step: 1 },
  tw_lot: { name: '台股 整股（1 張＝1000 股）', pv: 1000, unit: '張', step: 1 },
  tw_odd: { name: '台股 零股', pv: 1, unit: '股', step: 1 },
  custom: { name: '自訂（每點價值自填）', pv: null, unit: '單位', step: 0 },
}

const num = (v) => {
  if (v === '' || v === null || v === undefined) return null
  const x = Number(v)
  return Number.isFinite(x) ? x : null
}

/** 方向：防守位低於進場價＝做多；高於＝做空 */
export function side(entry, stop) {
  const e = num(entry), s = num(stop)
  if (e == null || s == null || e === s) return null
  return s < e ? 'long' : 'short'
}

/**
 * 依「單筆最大虧損＝帳戶 × 風險%」反推部位
 * @returns {{dir, riskPts, riskPerUnit, budget, qty, riskAmt, rr1, rr2, notional, pv}|null}
 */
export function sizePosition({ equity, riskPct, entry, stop, t1, t2, inst = 'tx', pv: pvIn, step }) {
  const E = num(equity), r = num(riskPct), e = num(entry), s = num(stop)
  const I = INSTRUMENTS[inst] || INSTRUMENTS.custom
  const pv = I.pv ?? num(pvIn)
  const dir = side(e, s)
  if (!dir || !pv || pv <= 0) return null
  const riskPts = Math.abs(e - s)
  const riskPerUnit = riskPts * pv
  const budget = E != null && r != null ? (E * r) / 100 : null
  const st = num(step) || I.step || 0
  let qty = budget != null ? budget / riskPerUnit : null
  if (qty != null && st > 0) qty = Math.floor(qty / st + 1e-9) * st
  const rr = (t) => {
    const x = num(t)
    if (x == null) return null
    const gain = dir === 'long' ? x - e : e - x
    return gain / riskPts
  }
  return {
    dir, pv, riskPts, riskPerUnit, budget, qty,
    riskAmt: qty != null ? qty * riskPerUnit : null,
    notional: qty != null ? qty * e * pv : null,
    rr1: rr(t1), rr2: rr(t2),
  }
}

/**
 * 交易結果。R＝淨損益（扣成本）÷ 初始風險金額（|實際進場價 − 防守位| × 每點價值 × 數量）
 * 1R＝如果照防守位出場會虧的錢；+2R＝賺到風險的兩倍，−1R＝剛好停損
 */
export function tradeResult({ dir, entry, stop, exit, qty, pv, cost }) {
  const e = num(entry), s = num(stop), x = num(exit), q = num(qty), p = num(pv)
  const c = num(cost) || 0
  if (!dir || e == null || x == null || !q || !p) return null
  const pts = dir === 'long' ? x - e : e - x
  const gross = pts * p * q
  const net = gross - c
  const risk = s != null && s !== e ? Math.abs(e - s) * p * q : null
  return { pts, gross, net, cost: c, risk, R: risk ? net / risk : null }
}

/** 績效統計：只計「已出場」的交易 */
export function perfStats(results) {
  const rs = results.filter((r) => r && r.net != null)
  const n = rs.length
  if (!n) return { n: 0 }
  const wins = rs.filter((r) => r.net > 0), losses = rs.filter((r) => r.net < 0)
  const sum = (a, f) => a.reduce((s, r) => s + f(r), 0)
  const withR = rs.filter((r) => r.R != null)
  const winR = wins.filter((r) => r.R != null), lossR = losses.filter((r) => r.R != null)
  const grossWin = sum(wins, (r) => r.net), grossLoss = -sum(losses, (r) => r.net)
  const winRate = wins.length / n
  const avgWinR = winR.length ? sum(winR, (r) => r.R) / winR.length : null
  const avgLossR = lossR.length ? sum(lossR, (r) => r.R) / lossR.length : null // 負數
  // 期望值（每筆平均 R）；並用勝率×平均賺R + 敗率×平均賠R 交叉驗算（兩者應一致，平手筆數除外）
  const expR = withR.length ? sum(withR, (r) => r.R) / withR.length : null
  let maxDD = 0, peak = 0, cum = 0
  for (const r of rs) { cum += r.net; peak = Math.max(peak, cum); maxDD = Math.min(maxDD, cum - peak) }
  let streak = 0, worstStreak = 0
  for (const r of rs) { streak = r.net < 0 ? streak + 1 : 0; worstStreak = Math.max(worstStreak, streak) }
  return {
    n, wins: wins.length, losses: losses.length, flat: n - wins.length - losses.length,
    winRate, avgWinR, avgLossR, expR, nR: withR.length,
    net: sum(rs, (r) => r.net), grossWin, grossLoss,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    maxDD, worstStreak,
  }
}

/** 過程 vs 結果 2×2：有沒有照計畫 × 有沒有賺 */
export function processMatrix(rows) {
  const m = { goodWin: 0, goodLoss: 0, badWin: 0, badLoss: 0 }
  for (const { plan, net } of rows) {
    if (net == null || !plan || net === 0) continue
    const good = plan === '完全照計畫'
    if (good && net > 0) m.goodWin++
    else if (good) m.goodLoss++
    else if (net > 0) m.badWin++
    else m.badLoss++
  }
  return m
}

/** 下單當下的總經／籌碼快照（之後回頭看「當時環境」） */
export function macroSnapshot(metrics, flows) {
  const v = (k) => metrics?.[k]?.last ?? null
  const nl = flows?.netliq?.series?.at(-1)
  const tx = flows?.txf?.series?.at(-1)
  const inst = flows?.tw_inst?.series || []
  const f5 = inst.length >= 5 ? inst.slice(-5).reduce((a, r) => a + (r[1] ?? 0), 0) : null
  return {
    vix: v('vix'), dxy: v('dxy'), us10y: v('us10y'), hy: v('hy'), usdtwd: v('usdtwd'),
    netliq: nl ? nl[1] : null, txfForeign: tx ? tx[1] : null, instForeign5: f5 != null ? Math.round(f5 * 100) / 100 : null,
  }
}
