/**
 * 連動矩陣實證化：用真實歷史日資料檢驗矩陣每一格「說的方向」是否成立
 * ─────────────────────────────────────────────
 * 對齊規則（收盤時間不同）：
 *   美股、黃金、原油、美元、美債：同一個美國交易日
 *   加密（Binance UTC 日切，24:00 UTC 收）：同日（已涵蓋美股盤）
 *   台股（台北 13:30 收）：美國 D 日的變化 → 對應台股「D 日之後的第一個交易日」
 * 判定：驅動指標當日變化 |z| ≥ 0.5σ（60 日波動）才算「有明顯上漲／下跌」；
 *       目標資產同日（或台股次日）漲跌方向與矩陣分數相符即命中。
 */
import { DRIVERS, TARGETS, MATRIX } from './matrixConfig'

export const TARGET_METRIC = { us: 'spx', tw: 'taiex', crypto: 'btc', gold: 'gold', oil: 'wti' }
const NEXT_DAY = new Set(['tw'])
export const Z_MIN = 0.5
export const FLAT_Z = 0.25

/** 日變化：價格用 %、利率用 bp */
export function dailyChanges(h, rate) {
  const out = []
  for (let i = 1; i < (h?.length || 0); i++) {
    const a = h[i - 1][1], b = h[i][1]
    if (a == null || b == null || (!rate && !a)) continue
    out.push([h[i][0], rate ? (b - a) * 100 : (b / a - 1) * 100])
  }
  return out
}

/** 每日 z：該日變化 ÷ 之前 60 日變化的標準差 */
export function zSeries(ch, win = 60) {
  const out = []
  for (let i = win; i < ch.length; i++) {
    const w = ch.slice(i - win, i).map((x) => x[1])
    const mu = w.reduce((s, x) => s + x, 0) / win
    const sd = Math.sqrt(w.reduce((s, x) => s + (x - mu) ** 2, 0) / (win - 1))
    if (sd > 0) out.push([ch[i][0], ch[i][1], ch[i][1] / sd])
  }
  return out
}

/** 依對齊規則，把驅動日期對應到目標資產的變化 */
export function alignTarget(driverDates, targetCh, nextDay) {
  const m = new Map(targetCh)
  const dates = targetCh.map((x) => x[0])
  const res = new Map()
  let j = 0
  for (const d of driverDates) {
    if (!nextDay) { if (m.has(d)) res.set(d, m.get(d)); continue }
    while (j < dates.length && dates[j] <= d) j++
    if (j < dates.length) {
      // 下一個台股交易日必須在 D 之後 5 天內（避免長假把很久之後的變化對到）
      const gap = (Date.parse(dates[j]) - Date.parse(d)) / 864e5
      if (gap <= 5) res.set(d, targetCh[j][1])
    }
  }
  return res
}

export function pearson(xs, ys) {
  const n = xs.length
  if (n < 10) return null
  const mx = xs.reduce((s, x) => s + x, 0) / n, my = ys.reduce((s, y) => s + y, 0) / n
  let sxy = 0, sxx = 0, syy = 0
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; sxy += a * b; sxx += a * a; syy += b * b }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null
}

export function wilsonLo(k, n, z = 1.96) {
  if (!n) return null
  const p = k / n, d = 1 + z * z / n
  return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d
}

/**
 * 回傳 { [driver]: { [state]: { [target]: {n, hit, rate, lo, upShare, verdict} } }, corr: {[driver]:{[target]:{c60,c250}}}, span }
 * window：只看最近 N 個驅動交易日
 */
export function matrixEvidence(metrics, windows = [60, 250]) {
  const res = {}
  for (const W of windows) {
    const out = {}, corr = {}
    let span = null
    for (const d of DRIVERS) {
      const dm = metrics?.[d.metric]
      const zs = zSeries(dailyChanges(dm?.history, dm?.rate)).slice(-W)
      if (zs.length < 20) continue
      span = span || [zs[0][0], zs.at(-1)[0]]
      out[d.key] = { up: {}, down: {} }
      corr[d.key] = {}
      for (const t of TARGETS) {
        if (TARGET_METRIC[t.key] === d.metric) continue
        const tm = metrics?.[TARGET_METRIC[t.key]]
        const tch = dailyChanges(tm?.history, tm?.rate)
        const al = alignTarget(zs.map((x) => x[0]), tch, NEXT_DAY.has(t.key))
        const xs = [], ys = []
        for (const [dt, chg] of zs) if (al.has(dt)) { xs.push(chg); ys.push(al.get(dt)) }
        corr[d.key][t.key] = { c: pearson(xs, ys), n: xs.length }
        for (const st of ['up', 'down']) {
          const v = MATRIX[d.key]?.[st]?.scores?.[t.key]
          const days = zs.filter(([dt, , z]) => al.has(dt) && (st === 'up' ? z >= Z_MIN : z <= -Z_MIN))
          const moves = days.map(([dt]) => al.get(dt)).filter((x) => x !== 0)
          const n = moves.length
          const ups = moves.filter((x) => x > 0).length
          const cell = { n, upShare: n ? ups / n : null, expected: v }
          if (v === 1 || v === -1) {
            const hit = v === 1 ? ups : n - ups
            cell.hit = hit; cell.rate = n ? hit / n : null; cell.lo = wilsonLo(hit, n)
            cell.verdict = n < 8 ? 'few' : cell.lo > 0.5 ? 'confirmed' : cell.rate < 0.45 ? 'contradicted' : 'weak'
          } else if (v === 0) {
            // 中性：上漲比例落在 35%–65% 視為「確實沒有明顯方向」
            cell.verdict = n < 8 ? 'few' : cell.upShare >= 0.35 && cell.upShare <= 0.65 ? 'neutral-ok' : 'neutral-biased'
          } else cell.verdict = 'na'
          out[d.key][st][t.key] = cell
        }
      }
    }
    res[W] = { cells: out, corr, span }
  }
  return res
}

/**
 * 股債相關性 regime：S&P 500 日報酬 與 美債 10Y「價格方向」（−Δ殖利率）的滾動相關
 *   < 0：股跌債漲，債券能避險（成長／通縮型環境，傳統 60/40 有效）
 *   > 0：股債同漲同跌，債券失去避險功能（通膨／利率主導環境）
 */
export function stockBondCorr(metrics, win = 60) {
  const s = new Map(dailyChanges(metrics?.spx?.history, false))
  const b = dailyChanges(metrics?.us10y?.history, true).map(([d, v]) => [d, -v])
  const pairs = b.filter(([d]) => s.has(d)).map(([d, v]) => [d, s.get(d), v])
  const series = []
  for (let i = win; i <= pairs.length; i++) {
    const w = pairs.slice(i - win, i)
    series.push([w.at(-1)[0], pearson(w.map((x) => x[1]), w.map((x) => x[2]))])
  }
  const last = series.at(-1)?.[1] ?? null
  const regime = last == null ? null : last > 0.2 ? 'inflation' : last < -0.2 ? 'hedge' : 'transition'
  return { series, last, regime, n: pairs.length }
}

export const REGIME_TEXT = {
  inflation: { name: '股債同向（通膨／利率主導）', tone: 'var(--color-serious)',
    text: '股票與債券價格同漲同跌，債券「失去避險功能」。主導力量是通膨與利率：殖利率上升時股債雙殺。此時分散風險要靠現金、美元或商品，而不是債券。' },
  hedge: { name: '股債反向（成長主導，債券可避險）', tone: 'var(--color-good)',
    text: '股票下跌時債券上漲，傳統股債配置有效。市場擔心的是成長與衰退，殖利率下跌被視為避險買盤。' },
  transition: { name: '過渡期（相關性不明顯）', tone: 'var(--color-warning)',
    text: '股債相關性接近 0，市場主導邏輯正在切換或混合。觀察方向：若相關性轉正並持續，代表通膨／利率重新主導。' },
}

/**
 * 自動判斷驅動指標狀態：最新收盤 vs N 個交易日前
 * 回傳 { states: {dxy:'up'|'down',...}, info: {dxy:{chg, unit, z, from, to}} }
 * z = N 日變化 ÷（近 60 日單日波動 × √N），|z| < 0.25 視為「幅度很小」
 */
export function autoDriverStates(metrics, n) {
  const states = {}, info = {}
  for (const d of DRIVERS) {
    const m = metrics?.[d.metric]
    const h = m?.history
    if (!h || h.length <= n + 61) continue
    const a = h[h.length - 1 - n][1], b = h[h.length - 1][1]
    if (a == null || b == null) continue
    const rate = !!m.rate
    const chg = rate ? (b - a) * 100 : (b / a - 1) * 100
    const ch = dailyChanges(h.slice(-62), rate).map((x) => x[1]).slice(-60)
    const mu = ch.reduce((s, x) => s + x, 0) / ch.length
    const sd = Math.sqrt(ch.reduce((s, x) => s + (x - mu) ** 2, 0) / (ch.length - 1))
    const z = sd ? chg / (sd * Math.sqrt(n)) : null
    // 三態：|z| < 0.25 視為持平（方向不明顯，不參與情境與計分）
    states[d.key] = chg === 0 || (z != null && Math.abs(z) < FLAT_Z) ? 'flat' : chg > 0 ? 'up' : 'down'
    info[d.key] = { chg, unit: rate ? 'bp' : '%', z, from: h[h.length - 1 - n][0], to: h.at(-1)[0] }
  }
  return { states, info }
}
