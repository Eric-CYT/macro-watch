import { useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, ReferenceLine, Cell } from 'recharts'
import { AX, GRID, TT } from './charts'
import { RADAR_ASSETS, RADAR_PERIODS, radarPeriod, radarMaxN, curPrev, volumeCheck, ratioSeries, alignDate, cryptoBasket, idxAtOrBefore, radarBacktest } from '../lib/flowRadar'
import { StatusDot } from './bits'

const KEY = 'mdj.radar.v1'
const MAX = 3
const BLUE = '#5b8def', PREV = '#8d8c84'
const load = () => { try { return { sel: 5, custom: 15, align: false, rel: false, ...(JSON.parse(localStorage.getItem(KEY)) || {}) } } catch { return { sel: 5, custom: 15, align: false, rel: false } } }
const dirCls = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'text-ink2')
const sg = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}`)

function Heptagon({ rows, size = 200, big, onHover, onPick, picked }) {
  const N = rows.length
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
      {rows.map((_, i) => { const [x, y] = pt(i, MAX); return <line key={i} x1={C} y1={C} x2={x} y2={y} stroke="#2a2a27" /> })}
      {prev.some((v) => v != null) && <polygon points={poly(prev)} fill="none" stroke={PREV} strokeWidth={1.3} strokeDasharray="4 3" />}
      {cur.some((v) => v != null)
        ? <polygon points={poly(cur)} fill={BLUE} fillOpacity={0.14} stroke={BLUE} strokeWidth={big ? 2 : 1.6} strokeLinejoin="round" />
        : <text x={C} y={C + 4} textAnchor="middle" fontSize={big ? 13 : 11} fill="#8d8c84">資料累積中</text>}
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
  const align = st.align ? alignDate(metrics) : null
  const all = useMemo(() => Object.fromEntries(periods.map((p) => [p, radarPeriod(metrics, weights, p === 'c' ? custom : p, align)])), [metrics, weights, custom, align]) // eslint-disable-line react-hooks/exhaustive-deps
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
              {hover.vol && <div className="text-muted">量能比 {hover.vol.ratio}×・{hover.vol.tag}</div>}
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
            {S.rows.some((r) => r.vol) && <p>量價：{S.rows.filter((r) => r.vol).map((r) => (
              <span key={r.k} className="mr-2">{r.label} <span className={r.vol.ok ? 'text-ink' : 'text-muted'}>{r.vol.ratio}×・{r.vol.tag}</span></span>))}</p>}
            <p className="text-[11px] text-muted num">資料日期：{S.rows.filter((r) => r.cur).map((r) => `${r.label} ${r.cur.to.slice(5)}`).join('｜')}</p>
            <label className="flex items-center gap-1.5 text-[11px] text-ink2">
              <input type="checkbox" checked={!!st.align} onChange={(e) => save({ align: e.target.checked })} />
              對齊同一天（全部截至美股最新交易日 {alignDate(metrics)?.slice(5)}）
            </label>
          </div>
        </div>
      </div>
      <Backtest metrics={metrics} weights={weights} />
      <div className="mt-3 pt-2 border-t border-line">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-[12px] text-ink2 mr-1">延伸板塊</span>
          {RADAR_ASSETS.map((a) => (
            <button key={a.k} onClick={() => save({ drill: st.drill === a.k ? null : a.k })}
              className={`text-[12px] px-2 py-0.5 rounded ${st.drill === a.k ? 'bg-s1 text-white' : 'bg-surface2 text-ink2'}`}>{a.label}</button>
          ))}
          <span className="text-[10px] text-muted ml-1">（也可點大七邊形上的市場名稱）</span>
        </div>
        {st.drill && <Drill g={drill?.[st.drill]} metrics={metrics} weights={weights} drillKey={st.drill} periods={periods} sel={sel} custom={custom}
          align={align} rel={!!st.rel} onRel={(v) => save({ rel: v })}
          onSel={(p) => save({ sel: p })} label={RADAR_ASSETS.find((a) => a.k === st.drill)?.label} />}
      </div>
      <p className="text-[10px] text-muted leading-relaxed mt-2">
        粗灰線＝0，往外＝流入、往內＝流出，最外圈 +3σ、中心 −3σ（超過的貼在邊界）。藍色實線＝本期（最近 N 個交易日），灰色虛線＝上一期（再往前 N 個交易日）。
        σ 算法與下方直立圖相同；美債以價格方向計算；加密＝{S.basketNote}。自訂最多 {maxN} 日。點任一小圖切換。
      </p>
    </div>
  )
}

const PARENT = { spx: 'spx', taiex: 'taiex', gold: 'gold', wti: 'wti', crypto: 'crypto' }

function drillRows(items, n, align, parent) {
  return items.map((it) => {
    const bond = it.mode === 'bond', supply = it.mode === 'supply'
    const { cur, prev } = curPrev(it.history, n, bond, align, { drift: supply })
    const rs = parent && !supply && !bond ? ratioSeries(it.history, parent) : null
    const rel = rs ? curPrev(rs, n, false, align) : null
    let qf = null
    if (it.qfii?.length && cur) {
      const e = idxAtOrBefore(it.qfii, cur.to)
      if (e - n >= 0) qf = { chg: it.qfii[e][1] - it.qfii[e - n][1], last: it.qfii[e][1], to: it.qfii[e][0] }
    }
    return { ...it, cur, prev, bond, supply, rel, qf, vol: volumeCheck(it.volume, cur, n) }
  })
}

function Drill({ g, metrics, weights, drillKey, periods, sel, custom, onSel, label, align, rel, onRel }) {
  const [hover, setHover] = useState(null)
  // 匯率加上「美元」本身（DXY 指數）作為第一個頂點
  const items = useMemo(() => {
    if (!g?.items) return []
    if (drillKey !== 'dxy' || !metrics?.dxy?.history) return g.items
    return [{ k: 'usd', label: '美元', history: metrics.dxy.history, source: metrics.dxy.source, status: metrics.dxy.status,
      checks: metrics.dxy.checks, mode: 'price', note: '以美元指數 DXY 代表美元本身的強弱' }, ...g.items]
  }, [g, drillKey, metrics])
  const parent = useMemo(() => {
    const pk = PARENT[drillKey]
    if (!pk) return null
    return pk === 'crypto' ? cryptoBasket(metrics, weights)?.history : metrics?.[pk]?.history
  }, [drillKey, metrics, weights])
  const canRel = !!parent
  const useRel = rel && canRel
  const all = useMemo(() => Object.fromEntries(periods.map((p) => {
    const rows = drillRows(items, p === 'c' ? custom : p, align, parent)
    return [p, useRel ? rows.map((r) => (r.rel ? { ...r, cur: r.rel.cur, prev: r.rel.prev, abs: r.cur } : { ...r, abs: r.cur, relNA: true })) : rows]
  })), [items, periods, custom, align, parent, useRel])
  if (!items.length) return <p className="text-[12px] text-muted mt-2">{label}的延伸資料尚未產生（下一次資料更新後出現）。</p>
  const n = sel === 'c' ? custom : sel
  const rows = all[sel] || drillRows(items, n, align, parent)
  const bars = rows.map((r) => ({ label: r.label, cur: r.cur?.z ?? null, prev: r.prev?.z ?? null }))
  const lim = Math.max(2, Math.ceil(Math.max(...bars.flatMap((b) => [Math.abs(b.cur ?? 0), Math.abs(b.prev ?? 0)]))))
  const ranked = rows.filter((r) => r.cur).sort((a, b) => b.cur.z - a.cur.z)
  const base = (r) => (useRel ? r.abs : r.cur)
  const fmtRaw = (r) => {
    const c = base(r)
    if (!c) return '—'
    if (r.bond) return `殖利率 ${sg(-c.raw)}bp`
    if (r.supply) return `${c.net >= 0 ? '+' : '−'}${(Math.abs(c.net) / 1e9).toFixed(1)}B 美元（${sg(c.raw, 2)}%）`
    return `${sg(c.raw, 2)}%`
  }
  const spreads = drillKey === 'us10y' ? treasurySpreads(items, n, align) : null
  const hasQ = items.some((i) => i.qfii?.length)
  const shape = `${rows.length} 邊形`
  const have = Math.min(...items.map((i) => i.history?.length || 0))
  const needCur = n + 62, needPrev = 2 * n + 62
  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span className="text-[13px] text-ink">{g.name}｜{shape}</span>
        {canRel && (
          <span className="flex gap-1 ml-auto">
            {[[false, '絕對強弱'], [true, `相對${label}`]].map(([v, l]) => (
              <button key={l} onClick={() => onRel(v)} className={`text-[11px] px-2 py-0.5 rounded ${useRel === v ? 'bg-s1 text-white' : 'bg-surface2 text-ink2'}`}>{l}</button>
            ))}
          </span>
        )}
      </div>
      {useRel && <p className="text-[11px] text-ink2 mb-1">相對強弱＝該項目 ÷ {label}整體的比值，再算 σ。正＝比{label}整體強（資金相對流入），負＝比整體弱；看的是板塊之間的輪動。</p>}
      {have < needPrev && (
        <p className="text-[12px] text-warning mb-2">
          歷史資料累積中：目前 {have} 個交易日。σ 需要前 60 日波動，所以 1 日比較需 63 天、{n} 日本期需 {needCur} 天、加上一期需 {needPrev} 天。
          {drillKey === 'taiex' && ' 證交所產業指數每次更新（平日每 30 分鐘）回補 30 個交易日，約 2–3 小時補齊。'}
        </p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2">
        {periods.map((p) => (
          <div key={p} role="button" tabIndex={0} onClick={() => onSel(p)} onKeyDown={(e) => e.key === 'Enter' && onSel(p)}
            className={`rounded-lg p-1.5 cursor-pointer border ${sel === p ? 'border-s1 bg-surface2' : 'border-line hover:border-ink2'}`}>
            <div className={`text-[12px] px-1 ${sel === p ? 'text-ink font-medium' : 'text-ink2'}`}>{p === 'c' ? `自訂 ${custom}` : p} 日</div>
            <Heptagon rows={all[p]} />
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)] mt-3 items-center">
        <div className="relative max-w-[380px] mx-auto w-full">
          <Heptagon rows={rows} size={300} big onHover={setHover} />
          {hover && (
            <div className="absolute left-2 top-2 rounded-lg bg-surface2 border border-line px-2 py-1 text-[12px] num pointer-events-none">
              <b className="text-ink font-medium">{hover.label}</b> 本期 {sg(hover.cur?.z)}σ・上一期 {sg(hover.prev?.z)}σ
              <div className="text-muted">{hover.cur && `${hover.cur.from} → ${hover.cur.to}｜${fmtRaw(hover)}`}</div>
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-3 text-[11px] text-ink2 mb-1 flex-wrap">
            <span className="text-ink text-[13px]">{n} 日：本期 vs 上一期</span>
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
        </div>
      </div>
      <div className="overflow-x-auto mt-2">
        <table className="w-full text-[12px]">
          <thead className="text-muted"><tr><th className="text-left font-normal py-1">依本期排序</th><th className="font-normal">本期</th><th className="font-normal">上一期</th><th className="font-normal">期間漲跌</th><th className="font-normal">量能比</th>{hasQ && <th className="font-normal">外資持股變化</th>}<th className="text-left font-normal pl-2">來源</th></tr></thead>
          <tbody>
            {ranked.map((r) => (
              <tr key={r.k} className="border-t border-line num">
                <td className="py-1 text-ink">{r.label}{r.relNA && <span className="text-[10px] text-muted">（不適用相對，顯示絕對）</span>}</td>
                <td className={`text-center ${r.cur.z >= 0 ? 'up' : 'down'}`}>{sg(r.cur.z)}σ</td>
                <td className="text-center text-ink2">{r.prev ? `${sg(r.prev.z)}σ` : '—'}</td>
                <td className="text-center text-ink2">{fmtRaw(r)}</td>
                <td className="text-center text-ink2" title={r.vol?.tag}>{r.vol ? <span className={r.vol.ok ? 'text-ink' : ''}>{r.vol.ratio}×</span> : '—'}</td>
                {hasQ && <td className={`text-center ${r.qf ? dirCls(r.qf.chg) : 'text-muted'}`} title={r.qf ? `外資持股 ${r.qf.last.toFixed(2)}%（${r.qf.to}）` : ''}>{r.qf ? `${r.qf.chg >= 0 ? '+' : ''}${r.qf.chg.toFixed(2)} 百分點` : '—'}</td>}
                <td className="pl-2 text-muted"><span className="inline-flex items-center gap-1">{r.source}<StatusDot status={r.status} checks={r.checks} /></span></td>
              </tr>
            ))}
            {rows.filter((r) => !r.cur).map((r) => (
              <tr key={r.k} className="border-t border-line"><td className="py-1 text-muted">{r.label}</td><td colSpan={hasQ ? 6 : 5} className="text-muted text-center">資料不足（{r.history?.length || 0} 天）</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-[10px] text-muted leading-relaxed mt-1 space-y-0.5">
        {spreads && (
          <div className="text-[12px] text-ink2 rounded bg-surface2 px-2 py-1 my-1 num">
            殖利率曲線：{spreads.map((x) => `${x.name} ${x.last.toFixed(2)}%（${n} 日 ${sg(x.chg, 0)}bp）${x.last < 0 ? '・倒掛' : ''}`).join('｜')}
            <span className="block text-[10px] text-muted">3M−10Y 倒掛是最常用的衰退前兆；2Y−10Y 變陡＝長端上升或短端下降（降息預期）</span>
          </div>
        )}
        {hasQ && <p>外資持股變化＝證交所公布的外資及陸資持股比率，{n} 個交易日的增減（百分點）。這是「股數」變化，不受股價漲跌影響，是真實的外資進出。</p>}
        <p>穩定幣的 σ 已扣除平常的成長速度（正＝比平常流入更快）。量能比＝期間平均成交量 ÷ 期間前 20 日平均（只有股票、ETF、加密有成交量；期貨換月與外匯、殖利率不適用）。≥1.1 且價格同向＝流入／流出確認。</p>
        {g.note && <p>{g.note}</p>}
        {items.filter((i) => i.note).map((i) => <p key={i.k}>{i.label}：{i.note}</p>)}
        <p>選週期會與上方七邊形同步。σ 算法相同；類股、貴金屬、能源以價格（ETF／期貨）推算資金方向，非實際申贖金額。</p>
      </div>
    </div>
  )
}

function treasurySpreads(items, n, align) {
  const get = (k) => items.find((i) => i.k === k)?.history
  const t3m = get('3 Mo'), t2 = get('2 Yr'), t10 = get('10 Yr')
  const sp = (a, b, name) => {
    if (!a?.length || !b?.length) return null
    const am = new Map(a)
    const s = b.filter(([d]) => am.has(d)).map(([d, v]) => [d, v - am.get(d)])
    const end = align ? s.findLastIndex(([d]) => d <= align) : s.length - 1
    if (end < n) return null
    return { name, last: s[end][1], chg: (s[end][1] - s[end - n][1]) * 100 }
  }
  return [sp(t3m, t10, '10Y−3M'), sp(t2, t10, '10Y−2Y')].filter(Boolean)
}

function Backtest({ metrics, weights }) {
  const [open, setOpen] = useState(false)
  const bt = useMemo(() => (open ? radarBacktest(metrics, weights) : null), [open, metrics, weights])
  const P = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`)
  const cell = (r, base) => {
    if (!r) return <span className="text-muted">—</span>
    const edge = r.rate - base
    const c = r.n < 15 ? 'var(--color-muted)' : edge >= 0.08 ? 'var(--color-good)' : edge <= -0.08 ? 'var(--color-critical)' : 'var(--color-ink2)'
    return <span style={{ color: c }}>{P(r.rate)}<span className="text-muted text-[10px]">/{r.n}</span></span>
  }
  return (
    <details className="mt-3" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="text-[12px] text-s1 cursor-pointer">雷達歷史驗證：σ 很強／很弱之後，接下來 5 日是延續還是反轉？</summary>
      {bt && (
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-[12px]">
            <thead className="text-muted">
              <tr><th className="text-left font-normal py-1">市場</th>
                <th className="font-normal">5 日 ≥+1σ 後續漲</th><th className="font-normal">5 日 ≤−1σ 後續跌</th>
                <th className="font-normal">20 日 ≥+1σ 後續漲</th><th className="font-normal">20 日 ≤−1σ 後續跌</th>
                <th className="font-normal">基準：任意 5 日漲／跌</th></tr>
            </thead>
            <tbody>
              {bt.map((r) => (
                <tr key={r.k} className="border-t border-line num text-center">
                  <td className="text-left py-1 text-ink">{r.label}</td>
                  <td>{cell(r[5]?.strong, r.baseUp)}</td><td>{cell(r[5]?.weak, r.baseDn)}</td>
                  <td>{cell(r[20]?.strong, r.baseUp)}</td><td>{cell(r[20]?.weak, r.baseDn)}</td>
                  <td className="text-ink2">{P(r.baseUp)}／{P(r.baseDn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[10px] text-muted leading-relaxed mt-1">
            期間 {bt[0]?.from} → {bt[0]?.to}。綠＝比基準高 8 個百分點以上（訊號傾向延續，可順勢參考）；紅＝比基準低 8 個百分點以上（傾向反轉，極端值反而要提防）；灰＝與基準差不多或樣本少於 15 次。
            斜線後為樣本次數；相鄰樣本期間重疊，實際不確定性比數字顯示的大。
          </p>
        </div>
      )}
    </details>
  )
}
