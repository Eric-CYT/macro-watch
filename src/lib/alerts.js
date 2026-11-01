/** 跨資產推敲矩陣：門檻值來自 shared/config.json（建置時複製為 data/config.json） */
export function computeAlerts(metrics, cfg) {
  const a = cfg?.alerts
  if (!a || !metrics) return []
  const g = (k, f) => metrics[k]?.[f]
  const out = []

  const L = a.liquidity
  const d1 = g('dxy', 'chg_1d'), d5 = g('dxy', 'chg_5d'), y1 = g('us02y', 'chg_1d'), y5 = g('us02y', 'chg_5d')
  if ((d1 >= L.dxy_pct_1d && y1 >= L.us02y_bp_1d) || (d5 >= L.dxy_pct_5d && y5 >= L.us02y_bp_5d)) {
    out.push({ id: 'liquidity', level: 'serious', label: L.label, desc: L.desc,
      detail: `DXY 1D ${fmtp(d1)} / 5D ${fmtp(d5)}；US02Y 1D ${fmtb(y1)} / 5D ${fmtb(y5)}`,
      targets: ['dxy', 'us02y', 'btc', 'taiex'] })
  }
  const C = a.carry
  const j1 = g('usdjpy', 'chg_1d'), j5 = g('usdjpy', 'chg_5d')
  if (j1 <= C.usdjpy_pct_1d || j5 <= C.usdjpy_pct_5d) {
    out.push({ id: 'carry', level: 'critical', label: C.label, desc: C.desc,
      detail: `USD/JPY 1D ${fmtp(j1)} / 5D ${fmtp(j5)}（負值 = 日圓升值）`,
      targets: ['usdjpy', 'taiex', 'spx'] })
  }
  const V = a.valuation
  const t1 = g('us10y', 'chg_1d'), t5 = g('us10y', 'chg_5d')
  if (t1 >= V.us10y_bp_1d || t5 >= V.us10y_bp_5d) {
    out.push({ id: 'valuation', level: 'warning', label: V.label, desc: V.desc,
      detail: `US10Y 1D ${fmtb(t1)} / 5D ${fmtb(t5)}`,
      targets: ['us10y', 'sox', 'taiex', 'heat-sox'] })
  }
  return out
}

const fmtp = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`)
const fmtb = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}bp`)

export const LEVEL_C = { warning: 'var(--color-warning)', serious: 'var(--color-serious)', critical: 'var(--color-critical)' }

/** 回傳某區塊是否被警報點名，以及顏色 */
export function alertFor(alerts, key) {
  const hit = alerts.find((x) => x.targets.includes(key))
  return hit ? { className: 'alerting', style: { '--alert-c': LEVEL_C[hit.level] }, alert: hit } : { className: '', style: {} }
}
