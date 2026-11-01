import { useState } from 'react'
import { STATUS, fmt, fmtChg, dirClass } from '../lib/util'

export function Panel({ title, right, children, className = '', style, id }) {
  return (
    <section id={id} style={style} className={`bg-surface rounded-xl border border-line p-3 ${className}`}>
      {(title || right) && (
        <header className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <h2 className="text-[13px] font-semibold tracking-wide text-ink2">{title}</h2>
          {right}
        </header>
      )}
      {children}
    </section>
  )
}

export function StatusDot({ status, checks, compact }) {
  const s = STATUS[status] || STATUS.single
  const [open, setOpen] = useState(false)
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        onBlur={() => setOpen(false)}
        className="inline-flex items-center gap-1 text-[11px] leading-none px-1.5 py-1 rounded-md hover:bg-surface2 text-ink2"
        aria-label={`資料驗證：${s.label}`}
      >
        <span style={{ color: s.c }}>{s.icon}</span>
        {!compact && <span>{s.label}</span>}
      </button>
      {open && checks?.length > 0 && (
        <span className="absolute z-30 right-0 top-6 w-72 bg-surface2 border border-line rounded-lg p-2 text-[11px] text-ink2 shadow-xl text-left">
          {checks.map((c, i) => <CheckLine key={i} c={c} />)}
        </span>
      )}
    </span>
  )
}

export function CheckLine({ c }) {
  const s = STATUS[c.status] || STATUS.single
  return (
    <span className="block py-1 border-b border-line last:border-0">
      <span style={{ color: s.c }}>{s.icon} {s.label}</span>
      {c.on && <span className="text-muted">（比對日 {c.on}）</span>}
      {c.va != null && c.vb != null && (
        <span className="block num text-ink">
          {c.a}: {c.va} ｜ {c.b}: {c.vb}
          <span className="text-muted"> 差 {c.diff}{c.unit} / 容忍 {c.tol}{c.unit}</span>
        </span>
      )}
      {c.note && <span className="block text-muted">{c.note}</span>}
    </span>
  )
}

/** 迷你走勢圖：純 SVG（輕量），最後一點加圓點 */
export function Sparkline({ data, w = 96, h = 28, n = 90 }) {
  const pts = (data || []).slice(-n)
  if (pts.length < 2) return <svg width={w} height={h} />
  const vs = pts.map((p) => p[1])
  const lo = Math.min(...vs), hi = Math.max(...vs), rg = hi - lo || 1
  const x = (i) => 2 + (i / (pts.length - 1)) * (w - 6)
  const y = (v) => h - 3 - ((v - lo) / rg) * (h - 6)
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join('')
  const last = vs[vs.length - 1], first = vs[0]
  const col = last >= first ? 'var(--up)' : 'var(--down)'
  return (
    <svg width={w} height={h} aria-hidden="true">
      <path d={d} fill="none" stroke={col} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(pts.length - 1)} cy={y(last)} r="2.2" fill={col} />
    </svg>
  )
}

export function MetricRow({ m, alert, onPick }) {
  if (!m) return null
  return (
    <div
      onClick={() => onPick?.(m.key)}
      className={`grid grid-cols-[1fr_auto] gap-x-2 items-center px-2 py-2 rounded-lg hover:bg-surface2 cursor-pointer ${alert?.className || ''}`}
      style={alert?.style}
      title={alert?.alert ? `${alert.alert.label}：${alert.alert.desc}` : undefined}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-[13px] text-ink truncate">{m.name}</span>
          <StatusDot status={m.status} checks={m.checks} compact />
        </div>
        <div className="flex items-baseline gap-2">
          <span className="num text-lg text-ink">{fmt(m.last, m.decimals)}</span>
          <span className="text-[11px] text-muted">{m.unit}</span>
          <span className={`num text-[12px] ${dirClass(m.chg_1d)}`}>{fmtChg(m.chg_1d, m.rate)}</span>
        </div>
        <div className="text-[10px] text-muted num">5D {fmtChg(m.chg_5d, m.rate)} · 20D {fmtChg(m.chg_20d, m.rate)} · {m.date}</div>
      </div>
      <Sparkline data={m.history} />
    </div>
  )
}
