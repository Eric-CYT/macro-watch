import { ASSETS, DIRS, HORIZONS, CONF, outcome, fmtMove, afterMoves } from '../lib/review'

const chip = (on) => `text-[11px] px-1.5 py-0.5 rounded border ${on ? 'bg-s1 border-s1 text-white' : 'border-line text-ink2 hover:bg-surface2'}`

/** 每題下方的「我的判斷（選填）」 */
export function PredictionPicker({ value, onChange, suggest = [], defaultH = 5 }) {
  const v = value || {}
  const set = (patch) => onChange({ asset: v.asset || suggest[0] || 'spx', h: v.h || defaultH, conf: v.conf || 2, ...v, ...patch })
  const assetKeys = [...new Set([...suggest, ...Object.keys(ASSETS)])]
  return (
    <div className="flex flex-wrap items-center gap-1 mt-1">
      <span className="text-[11px] text-muted mr-0.5">我的判斷（選填）</span>
      <select value={v.asset || suggest[0] || 'spx'} onChange={(e) => set({ asset: e.target.value })}
        className="text-[11px] bg-bg border border-line rounded px-1 py-0.5 text-ink" aria-label="預判資產">
        {assetKeys.map((k) => <option key={k} value={k}>{ASSETS[k]?.name || k}</option>)}
      </select>
      {Object.entries(DIRS).map(([k, l]) => (
        <button key={k} type="button" className={chip(v.dir === k)} onClick={() => (v.dir === k ? onChange(null) : set({ dir: k }))}>{l}</button>
      ))}
      <span className="text-muted text-[11px] ml-1">期間</span>
      {HORIZONS.map((n) => <button key={n} type="button" className={chip(v.dir && (v.h || defaultH) === n)} onClick={() => set({ h: n })}>{n}日</button>)}
      <span className="text-muted text-[11px] ml-1">信心</span>
      {Object.entries(CONF).map(([k, l]) => <button key={k} type="button" className={chip(v.dir && String(v.conf || 2) === k)} onClick={() => set({ conf: Number(k) })}>{l}</button>)}
      {v.asset && ASSETS[v.asset]?.rate && <span className="text-[10px] text-muted">（利率類：↑ = 殖利率上升）</span>}
    </div>
  )
}

/** 驗證結果徽章 */
export function OutcomeBadge({ metrics, pred, date }) {
  if (!pred?.dir) return null
  const o = outcome(metrics, pred, date)
  const name = ASSETS[pred.asset]?.name || pred.asset
  const head = `${name} ${DIRS[pred.dir]}・${pred.h}日・信心${CONF[pred.conf || 2]}`
  if (!o) return <Tag c="var(--color-muted)">{head} → 無行情資料</Tag>
  if (o.pending) return <Tag c="var(--color-muted)">⏳ {head} → 還差 {o.left} 個交易日到期</Tag>
  if (o.hit === null) return <Tag c="var(--color-muted)">○ {head} → 實際 {fmtMove(o)}（{o.z.toFixed(1)}σ，波動太小不計）</Tag>
  return (
    <Tag c={o.hit ? 'var(--color-good)' : 'var(--color-critical)'}>
      {o.hit ? '✓ 命中' : '✗ 落空'}｜{head} → 實際 {fmtMove(o)}（{o.z > 0 ? '+' : ''}{o.z.toFixed(1)}σ，{o.from}→{o.to}）
    </Tag>
  )
}

function Tag({ c, children }) {
  return <div className="text-[11px] mt-1 px-2 py-1 rounded border num" style={{ borderColor: c, color: c }}>{children}</div>
}

/** 沒有預判時：顯示作答後相關資產的實際走勢，方便自我檢討 */
export function AfterMoves({ metrics, assets, date }) {
  const list = (assets || []).filter((a) => metrics?.[a]).slice(0, 2)
  if (!list.length) return null
  return (
    <div className="text-[10px] text-muted mt-1 num">
      之後實際走勢：{list.map((a) => (
        <span key={a} className="mr-3">{ASSETS[a]?.name || a} {afterMoves(metrics, a, date).map(({ n, o }) =>
          <span key={n} className="ml-1">{n}D {!o ? '—' : o.pending ? '…' : <span className={o.move > 0 ? 'up' : o.move < 0 ? 'down' : ''}>{fmtMove(o)}</span>}</span>)}</span>
      ))}
    </div>
  )
}
