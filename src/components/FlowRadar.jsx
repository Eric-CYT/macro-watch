import { useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, Cell } from 'recharts'
import { AX, GRID, TT } from './charts'
import { RADAR_ASSETS, RADAR_PERIODS, radarPeriod, radarMaxN, windowScore } from '../lib/flowRadar'
import { StatusDot } from './bits'

const KEY = 'mdj.radar.v1'
const MAX = 3
const N = RADAR_ASSETS.length
const BLUE = '#5b8def', PREV = '#8d8c84'
const load = () => { try { return { sel: 5, custom: 15, ...(JSON.parse(localStorage.getItem(KEY)) || {}) } } catch { return { sel: 5, custom: 15 } } }
const sg = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}`)

function Heptagon({ rows, size = 200, big, onHover, onPick, picked }) {
  const C = size / 2, R = size * (big ? 0.31 : 0.33)
  const ang = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / N
  const rr = (v) => (R * (Math.max(-MAX, Math.min(MAX, v)) + MAX)) / (2 * MAX)
  const pt = (i, v) => [C + rr(v) * Math.cos(ang(i)), C + rr(v) * Math.sin(ang(i))]
  const poly = (vs) => vs.map((v, i) => pt(i, v ?? 0).map((x) => x.toFixed(1)).join(',')).join(' ')
  const cur = rows.map((r) => r.cur?.z ?? null), prev = rows.map((r) => r.prev?.z ?? null)
  const fs = big ? 13 : 11
  return (
    <svg viewBox={big ? `0 0 ${size} ${size}` : `0 ${size * 0.06} ${size} ${size * 0.9}`} width="100%" role="img" aria-label="七邊形資金流向">
      {[-2, -1, 1, 2, 3].map((l) => <polygon key={l} points={poly(Array(N).fill(l))} fill="none" stroke="#2a2a27" strokeWidth={1} />)}
      <polygon points={poly(Array(N).fill(0))} fill="none" stroke="#6b6a65" strokeWidth={1.6} />
      {RADAR_ASSETS.map((_, i) => { const [x, y] = pt(i, MAX); return <line key={i} x1={C} y1={C} x2={x} y2={y} stroke="#2a2a27" /> })}
      {prev.some((v) => v != null) && <polygon points={poly(prev)} fill="none" stroke={PREV} strokeWidth={1.3} strokeDasharray="4 3" />}
      <polygon points={poly(cur)} fill={BLUE} fillOpacity={0.14} stroke={BLUE} strokeWidth={big ? 2 : 1.6} strokeLinejoin="round" />
      {rows.map((r, i) => {
        const v = r.cur?.z
        if (v == null) return null
        const [x, y] = pt(i, v)
        return <circle key={r.k} cx={x} cy={y} r={big ? 5.5 : 3.5} onClick={onPick ? () => onPick(r.k) : undefined} fill={v >= 0 ? 'var(--up)' : 'var(--down)'} stroke="var(--color-surface)" strokeWidth={1.5}
          onMouseEnter={() => onHover?.(r)} onMouseLeave={() => onHover?.(null)} style={{ cursor: onHover ? 'pointer' : 'default' }} />
      })}
      {rows.map((r, i) => {
        const [x, y] = pt(i, MAX + (big ? 1.25 : 0.95))
        return (
          <text key={r.k} x={x} y={y + 4} textAnchor="middle" fontSize={fs} fill={picked === r.k ? BLUE : '#c3c2b7'}
            textDecoration={onPick ? 'underline' : undefined} style={{ cursor: onPick ? 'pointer' : 'default' }}
            onClick={onPick ? () => onPick(r.k) : undefined}>
            {r.label}{big && r.cur && <tspan fill={r.cur.z >= 0 ? 'var(--up)' : 'var(--down)'} fontSize={fs - 1}> {sg(r.cur.z)}</tspan>}
          </text>
        )
      })}
    </svg>
  )
}

export function FlowRadar({ metrics, weights, drill }) {
  const [st, setSt] = useState(load)
  const [hover, setHover] = useState(null)
  const save = (p) => setSt((o) => { const x = { ...o, ...p }; try { localStorage.setItem(KEY, JSON.stringify(x)) } catch { /* ignore */ } return x })
  const maxN = useMemo(() => radarMaxN(metrics, weights), [metrics, weights])
  const custom = Math.min(Math.max(1, st.custom), maxN)
  const [cInput, setCInput] = useState(String(custom))
  const periods = [...RADAR_PERIODS, 'c']
  const all = useMemo(() => Object.fromEntries(periods.map((p) => [p, radarPeriod(metrics, weights, p === 'c' ? custom : p)])), [metrics, weights, custom]) // eslint-disable-line react-hooks/exhaustive-deps
  const sel = all[st.sel] ? st.sel : 5
  const S = all[sel]
  const bars = S.rows.map((r) => ({ label: r.label, cur: r.cur?.z ?? null, prev: r.prev?.z ?? null }))
  const lim = Math.max(2, Math.ceil(Math.max(...bars.flatMap((b) => [Math.abs(b.cur ?? 0), Math.abs(b.prev ?? 0)]))))
  const ins = S.rows.filter((r) => r.cur?.z >= 0.5), outs = S.rows.filter((r) => r.cur?.z <= -0.5)
  const turns = S.rows.filter((r) => r.cur && r.prev && Math.sign(r.cur.z) !== Math.sign(r.prev.z) && Math.abs(r.cur.z - r.prev.z) >= 0.8)
  const applyC = (raw) => {
    const n = Math.round(Number(raw))
    if (!Number.isFinite(n) || n < 1) { setCInput(String(custom)); return }
    const c = Math.min(n, maxN); setCInput(String(c)); save({ custom: c, sel: 'c' })
  }
  const span = (r) => (r?.cur ? `${r.cur.from} → ${r.cur.to}` : '')

  return (
    <div>
      {/* 7 個小七邊形 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2">
        {periods.map((p) => {
          const on = sel === p
          return (
            <div key={p} role="button" tabIndex={0} onClick={() => save({ sel: p })} onKeyDown={(e) => e.key === 'Enter' && save({ sel: p })}
              className={`rounded-lg p-1.5 cursor-pointer border ${on ? 'border-s1 bg-surface2' : 'border-line hover:border-ink2'}`}>
              <div className="flex items-center justify-between text-[12px] px-1">
                {p === 'c' ? (
                  <label className="flex items-center gap-1 text-ink" onClick={(e) => e.stopPropagation()}>
                    自訂
                    <input type="number" inputMode="numeric" min="1" max={maxN} value={cInput} aria-label="自訂天數"
                      onChange={(e) => setCInput(e.target.value)} onBlur={(e) => applyC(e.target.value)}
                      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') applyC(e.currentTarget.value) }}
                      className="w-12 bg-bg border border-line rounded px-1 text-[12px] num" />日
                  </label>
                ) : <span className={on ? 'text-ink font-medium' : 'text-ink2'}>{p} 日</span>}
                {on && <span className="text-[10px] text-s1">已選</span>}
              </div>
              <Heptagon rows={all[p].rows} />
            </div>
          )
        })}
      </div>

      {/* 選定週期：大七邊形 + 直立圖對照 */}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] mt-3 items-center">
        <div className="relative max-w-[380px] mx-auto w-full">
          <Heptagon rows={S.rows} size={300} big onHover={setHover} onPick={(k) => save({ drill: st.drill === k ? null : k })} picked={st.drill} />
          {hover && (
            <div className="absolute left-2 top-2 rounded-lg bg-surface2 border border-line px-2 py-1 text-[12px] num pointer-events-none">
              <b className="text-ink font-medium">{hover.label}</b> 本期 {sg(hover.cur?.z)}σ・上一期 {sg(hover.prev?.z)}σ
              <div className="text-muted">{span(hover)}{hover.cur && `｜${hover.bond ? '殖利率 ' + sg(-hover.cur.raw) + 'bp' : sg(hover.cur.raw, 2) + '%'}`}</div>
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-3 text-[11px] text-ink2 mb-1 flex-wrap">
            <span className="text-ink text-[13px]">{sel === 'c' ? `自訂 ${custom}` : sel} 日：本期 vs 上一期</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: BLUE }} />本期</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: PREV }} />上一期（前 {sel === 'c' ? custom : sel} 日）</span>
          </div>
          <div className="h-52">
            <ResponsiveContainer>
              <BarChart data={bars} margin={{ top: 16, right: 6, left: -14, bottom: 0 }} barGap={2} barCategoryGap="22%">
                {GRID}
                <XAxis dataKey="label" {...AX} interval={0} tick={{ fill: '#c3c2b7', fontSize: 12 }} />
                <YAxis {...AX} width={40} domain={[-lim, lim]} tickFormatter={(v) => `${v}σ`} />
                <ReferenceLine y={0} stroke="#8d8c84" />
                <ReferenceLine y={2} stroke="#4a4a45" strokeDasharray="4 3" />
                <ReferenceLine y={-2} stroke="#4a4a45" strokeDasharray="4 3" />
                <Tooltip {...TT} cursor={{ fill: '#2a2a27' }} formatter={(v, k) => [`${sg(v, 2)}σ`, k === 'cur' ? '本期' : '上一期']} />
                <Bar isAnimationActive={false} dataKey="prev" fill={PREV} radius={[3, 3, 3, 3]} />
                <Bar isAnimationActive={false} dataKey="cur" radius={[3, 3, 3, 3]}
                  label={{ position: 'top', fill: '#c3c2b7', fontSize: 11, formatter: (v) => (v == null ? '' : sg(v)) }}>
                  {bars.map((b) => <Cell key={b.label} fill={(b.cur ?? 0) >= 0 ? 'var(--up)' : 'var(--down)'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[12px] text-ink2 space-y-0.5 mt-1">
            <p>流入：{ins.length ? <span className="up">{ins.map((r) => r.label).join('、')}</span> : '無明顯'}
              <span className="mx-2 text-muted">｜</span>流出：{outs.length ? <span className="down">{outs.map((r) => r.label).join('、')}</span> : '無明顯'}</p>
            {turns.length > 0 && <p>方向翻轉：{turns.map((r) => `${r.label}（${sg(r.prev.z)} → ${sg(r.cur.z)}σ）`).join('、')}</p>}
          </div>
        </div>
      </div>
      <div className="mt-3 pt-2 border-t border-line">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[12px] text-ink2 mr-1">延伸板塊</span>
          {RADAR_ASSETS.map((a) => (
            <button key={a.k} onClick={() => save({ drill: st.drill === a.k ? null : a.k })}
              className={`text-[12px] px-2 py-0.5 rounded ${st.drill === a.k ? 'bg-s1 text-white' : 'bg-surface2 text-ink2'}`}>{a.label}</button>
          ))}
          <span className="text-[10px] text-muted ml-1">（也可點大七邊形上的市場名稱）</span>
        </div>
        {st.drill && <Drill g={drill?.[st.drill]} n={sel === 'c' ? custom : sel} label={RADAR_ASSETS.find((a) => a.k === st.drill)?.label} />}
      </div>
      <p className="text-[10px] text-muted leading-relaxed mt-2">
        粗灰線＝0，往外＝流入、往內＝流出，最外圈 +3σ、中心 −3σ（超過的貼在邊界）。藍色實線＝本期（最近 N 個交易日），灰色虛線＝上一期（再往前 N 個交易日）。
        σ 算法與下方直立圖相同；美債以價格方向計算；加密＝{S.basketNote}。自訂最多 {maxN} 日。點任一小圖切換。
      </p>
    </div>
  )
}

function Drill({ g, n, label }) {
  if (!g?.items?.length) return <p className="text-[12px] text-muted mt-2">{label}的延伸資料尚未產生（下一次資料更新後出現）。</p>
  const rows = g.items.map((it) => {
    const bond = it.mode === 'bond'
    const h = it.history
    const cur = windowScore(h, n, bond)
    const prev = h?.length ? windowScore(h, n, bond, h.length - 1 - n) : null
    return { ...it, cur, prev, bond }
  })
  const bars = rows.map((r) => ({ label: r.label, cur: r.cur?.z ?? null, prev: r.prev?.z ?? null }))
  const lim = Math.max(2, Math.ceil(Math.max(...bars.flatMap((b) => [Math.abs(b.cur ?? 0), Math.abs(b.prev ?? 0)]))))
  const ranked = rows.filter((r) => r.cur).sort((a, b) => b.cur.z - a.cur.z)
  const fmtRaw = (r) => (r.cur ? (r.bond ? `殖利率 ${sg(-r.cur.raw)}bp` : `${sg(r.cur.raw, 2)}%`) : '—')
  return (
    <div className="mt-2">
      <div className="flex items-center gap-3 text-[11px] text-ink2 mb-1 flex-wrap">
        <span className="text-ink text-[13px]">{g.name}｜{n} 日：本期 vs 上一期</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: BLUE }} />本期（紅流入、綠流出）</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: PREV }} />上一期</span>
      </div>
      <div className="h-56">
        <ResponsiveContainer>
          <BarChart data={bars} margin={{ top: 16, right: 6, left: -14, bottom: 0 }} barGap={2} barCategoryGap="20%">
            {GRID}
            <XAxis dataKey="label" {...AX} interval={0} tick={{ fill: '#c3c2b7', fontSize: 11 }} />
            <YAxis {...AX} width={40} domain={[-lim, lim]} tickFormatter={(v) => `${v}σ`} />
            <ReferenceLine y={0} stroke="#8d8c84" />
            <ReferenceLine y={2} stroke="#4a4a45" strokeDasharray="4 3" />
            <ReferenceLine y={-2} stroke="#4a4a45" strokeDasharray="4 3" />
            <Tooltip {...TT} cursor={{ fill: '#2a2a27' }} formatter={(v, k) => [`${sg(v, 2)}σ`, k === 'cur' ? '本期' : '上一期']} />
            <Bar isAnimationActive={false} dataKey="prev" fill={PREV} radius={[3, 3, 3, 3]} />
            <Bar isAnimationActive={false} dataKey="cur" radius={[3, 3, 3, 3]}
              label={{ position: 'top', fill: '#c3c2b7', fontSize: 11, formatter: (v) => (v == null ? '' : sg(v)) }}>
              {bars.map((b) => <Cell key={b.label} fill={(b.cur ?? 0) >= 0 ? 'var(--up)' : 'var(--down)'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12px]">
          <thead className="text-muted"><tr><th className="text-left font-normal py-1">依本期排序</th><th className="font-normal">本期</th><th className="font-normal">上一期</th><th className="font-normal">期間漲跌</th><th className="text-left font-normal pl-2">來源</th></tr></thead>
          <tbody>
            {ranked.map((r) => (
              <tr key={r.k} className="border-t border-line num">
                <td className="py-1 text-ink">{r.label}</td>
                <td className={`text-center ${r.cur.z >= 0 ? 'up' : 'down'}`}>{sg(r.cur.z)}σ</td>
                <td className="text-center text-ink2">{r.prev ? `${sg(r.prev.z)}σ` : '—'}</td>
                <td className="text-center text-ink2">{fmtRaw(r)}</td>
                <td className="pl-2 text-muted"><span className="inline-flex items-center gap-1">{r.source}<StatusDot status={r.status} checks={r.checks} /></span></td>
              </tr>
            ))}
            {rows.filter((r) => !r.cur).map((r) => (
              <tr key={r.k} className="border-t border-line"><td className="py-1 text-muted">{r.label}</td><td colSpan={4} className="text-muted text-center">資料不足（{r.history?.length || 0} 天）</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] text-muted leading-relaxed mt-1 space-y-0.5">
        {g.note && <p>{g.note}</p>}
        {g.items.filter((i) => i.note).map((i) => <p key={i.k}>{i.label}：{i.note}</p>)}
        <p>σ 算法與七邊形相同；類股、貴金屬、能源以價格（ETF／期貨）推算資金方向，非實際申贖金額。</p>
      </div>
    </div>
  )
}
