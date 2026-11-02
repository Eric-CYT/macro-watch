import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar,
  ReferenceLine, Legend, Cell,
} from 'recharts'
import { fmt } from '../lib/util'

export const AX = { stroke: '#8d8c84', fontSize: 11, tickLine: false, axisLine: { stroke: '#33332f' } }
export const GRID = <CartesianGrid stroke="#2a2a27" strokeDasharray="0" vertical={false} />
export const TT = {
  contentStyle: { background: '#232321', border: '1px solid #33332f', borderRadius: 8, fontSize: 12, color: '#f0efec' },
  labelStyle: { color: '#c3c2b7' },
  cursor: { stroke: '#8d8c84', strokeWidth: 1 },
}

/* --------------------------------------------------------- 熱圖 */
export function Heatmap({ items, title, alertCls, alertStyle }) {
  const max = 3 // ±3% 為色階滿格
  const bg = (c) => {
    if (c == null) return '#232321'
    const t = Math.min(Math.abs(c) / max, 1)
    const col = c >= 0 ? 'var(--up)' : 'var(--down)'
    return `color-mix(in srgb, ${col} ${Math.round(12 + t * 68)}%, #232321)`
  }
  return (
    <div className={alertCls} style={alertStyle}>
      <div className="text-[11px] text-muted mb-1">{title}</div>
      <div className="grid grid-cols-3 sm:grid-cols-4 2xl:grid-cols-6 gap-[2px]">
        {(items || []).map((x) => (
          <div key={x.sym} className="rounded-md px-2 py-1.5 min-h-[52px]" style={{ background: bg(x.chg) }}
            title={`${x.name} (${x.sym}) ${x.last ?? '—'}｜1D ${x.chg ?? '—'}%｜5D ${x.chg5 ?? '—'}%｜${x.date ?? ''}`}>
            <div className="text-[11px] text-ink truncate">{x.name}</div>
            <div className="num text-[13px] text-ink font-semibold">{x.chg == null ? '—' : `${x.chg > 0 ? '+' : ''}${x.chg.toFixed(2)}%`}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* --------------------------------------------------------- BTC vs 反向 DXY
 * 依視覺化原則不用雙 Y 軸：兩者在視窗起點指數化為 100，DXY 取倒數（=反向座標）
 * 兩線同向 = 「美元弱、BTC 強」的經典反向關係仍成立；分岔 = 關係失效，值得推敲
 */
export function BtcDxyChart({ btc, dxy }) {
  const [win, setWin] = useState(120)
  const data = useMemo(() => {
    if (!btc?.length || !dxy?.length) return []
    const dm = new Map(dxy)
    // 以 DXY 交易日為準對齊（週末無 DXY）
    const rows = btc.filter(([d]) => dm.has(d)).slice(-win)
    if (!rows.length) return []
    const b0 = rows[0][1], x0 = dm.get(rows[0][0])
    return rows.map(([d, v]) => ({
      d, btc: +(v / b0 * 100).toFixed(2), dxyInv: +(x0 / dm.get(d) * 100).toFixed(2),
      btcRaw: v, dxyRaw: dm.get(d),
    }))
  }, [btc, dxy, win])
  const corr = useMemo(() => {
    if (data.length < 20) return null
    const r = (k) => data.slice(1).map((p, i) => Math.log(p[k] / data[i][k]))
    const a = r('btcRaw'), b = r('dxyRaw')
    const ma = a.reduce((s, x) => s + x, 0) / a.length, mb = b.reduce((s, x) => s + x, 0) / b.length
    let num = 0, da = 0, db = 0
    a.forEach((x, i) => { num += (x - ma) * (b[i] - mb); da += (x - ma) ** 2; db += (b[i] - mb) ** 2 })
    return num / Math.sqrt(da * db)
  }, [data])
  return (
    <div>
      <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
        <div className="text-[11px] text-muted">
          起點=100 指數化；DXY 取倒數（反向軸）。日報酬相關係數 ρ(BTC, DXY) =
          <span className="num text-ink"> {corr == null ? '—' : corr.toFixed(2)}</span>
        </div>
        <div className="flex gap-1">
          {[60, 120, 250].map((n) => (
            <button key={n} onClick={() => setWin(n)}
              className={`text-[11px] px-2 py-0.5 rounded ${win === n ? 'bg-s1 text-white' : 'bg-surface2 text-ink2'}`}>{n}D</button>
          ))}
        </div>
      </div>
      <div className="h-56">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
            {GRID}
            <XAxis dataKey="d" {...AX} minTickGap={40} tickFormatter={(d) => d.slice(5)} />
            <YAxis {...AX} domain={['auto', 'auto']} width={44} />
            <ReferenceLine y={100} stroke="#4a4a45" />
            <Tooltip {...TT} formatter={(v, n, p) => n === 'BTC'
              ? [`${v}（${fmt(p.payload.btcRaw, 0)}）`, n] : [`${v}（DXY ${fmt(p.payload.dxyRaw, 2)}）`, n]} />
            <Legend wrapperStyle={{ fontSize: 12, color: '#c3c2b7' }} />
            <Line isAnimationActive={false} type="monotone" dataKey="btc" name="BTC" stroke="var(--color-s2)" strokeWidth={2} dot={false} />
            <Line isAnimationActive={false} type="monotone" dataKey="dxyInv" name="DXY（反向）" stroke="var(--color-s1)" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* --------------------------------------------------------- VIX 盤中 */
export function IntradayChart({ points, name, decimals = 2, color = 'var(--color-s1)', refLine }) {
  const data = (points || []).map(([t, v]) => ({
    t, v, label: new Date(t * 1000).toLocaleTimeString('zh-TW', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false }),
  }))
  return (
    <div className="h-36">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
          {GRID}
          <XAxis dataKey="label" {...AX} minTickGap={36} />
          <YAxis {...AX} domain={['auto', 'auto']} width={44} tickFormatter={(v) => v.toFixed(decimals > 0 ? 1 : 0)} />
          {refLine != null && <ReferenceLine y={refLine} stroke="#6a6a64" strokeDasharray="4 3" label={{ value: '前收', fill: '#8d8c84', fontSize: 10, position: 'insideTopLeft' }} />}
          <Tooltip {...TT} formatter={(v) => [fmt(v, decimals), name]} labelFormatter={(l) => `美東 ${l}`} />
          <Line isAnimationActive={false} type="monotone" dataKey="v" stroke={color} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/* --------------------------------------------------------- 單一指標大圖（點選列表展開） */
export function HistoryChart({ m, n = 250 }) {
  const data = (m?.history || []).slice(-n).map(([d, v]) => ({ d, v }))
  return (
    <div className="h-72">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          {GRID}
          <XAxis dataKey="d" {...AX} minTickGap={50} />
          <YAxis {...AX} domain={['auto', 'auto']} width={56} />
          <Tooltip {...TT} formatter={(v) => [fmt(v, m.decimals), m.name]} />
          <Line isAnimationActive={false} type="monotone" dataKey="v" stroke="var(--color-s1)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/* --------------------------------------------------------- 總經 */
export function MacroChart({ m, kind = 'line', years = 8, ref50, extra }) {
  const cut = `${new Date().getFullYear() - years}`
  const map2 = new Map(extra?.series || [])
  const data = (m?.series || []).filter(([d]) => d >= cut).map(([d, v]) => ({ d: d.slice(0, 7), v, v2: map2.get(d) }))
  const last = m?.series?.at(-1)
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <div className="text-[13px] text-ink">{m?.name}{extra && <span className="text-muted"> / {extra.name}</span>}</div>
        <div className="num text-ink">{last ? `${fmt(last[1], m.key === 'nfp' ? 0 : 1)}${m.unit === '%' ? '%' : ''}` : '—'}
          <span className="text-[10px] text-muted ml-1">{last?.[0]?.slice(0, 7)}</span></div>
      </div>
      <div className="h-36">
        <ResponsiveContainer>
          {kind === 'bar' ? (
            <BarChart data={data} margin={{ top: 6, right: 4, left: -8, bottom: 0 }}>
              {GRID}
              <XAxis dataKey="d" {...AX} minTickGap={40} />
              <YAxis {...AX} width={44} domain={[(min) => Math.max(min, -400), (max) => Math.min(max, 800)]} allowDataOverflow />
              <ReferenceLine y={0} stroke="#6a6a64" />
              <Tooltip {...TT} cursor={{ fill: '#2a2a27' }} formatter={(v) => [`${fmt(v, 0)} 千人`, m.name]} />
              <Bar isAnimationActive={false} dataKey="v" radius={[3, 3, 0, 0]}>
                {data.map((p) => <Cell key={p.d} fill={p.v >= 0 ? 'var(--color-s1)' : 'var(--color-s2)'} />)}
              </Bar>
            </BarChart>
          ) : (
            <LineChart data={data} margin={{ top: 6, right: 4, left: -8, bottom: 0 }}>
              {GRID}
              <XAxis dataKey="d" {...AX} minTickGap={40} />
              <YAxis {...AX} width={44} domain={['auto', 'auto']} />
              {ref50 != null && <ReferenceLine y={ref50} stroke="#6a6a64" strokeDasharray="4 3" />}
              <Tooltip {...TT} formatter={(v, n) => [fmt(v, 1), n]} />
              <Line isAnimationActive={false} type="monotone" dataKey="v" name={m?.name} stroke="var(--color-s1)" strokeWidth={2} dot={false} connectNulls={false} />
              {extra && <Line isAnimationActive={false} type="monotone" dataKey="v2" name={extra.name} stroke="var(--color-s2)" strokeWidth={2} dot={false} />}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/* --------------------------------------------------------- 跨資產資金流向（代理指標）
 * 免費管道沒有可靠的每日「實際申贖資金」數據，因此用「波動調整後報酬」當代理：
 *   σ 值 = N 日報酬 ÷ (近 60 日日報酬標準差 × √N)
 * 不同資產的波動差很多（BTC 一天 3% 很普通，美元 1% 就很大），換算成 σ 後才能放在同一把尺上比較。
 * 美債以「價格方向」呈現：殖利率下跌 = 債券價格上漲 = 資金流入，故取 −Δ殖利率。
 */
const FLOW_ASSETS = [
  { k: 'gold', label: '黃金', grp: '金屬' },
  { k: 'copper', label: '銅', grp: '金屬' },
  { k: 'wti', label: '原油', grp: '能源' },
  { k: 'spx', label: '美股', grp: '股市' },
  { k: 'sox', label: '費半', grp: '股市' },
  { k: 'taiex', label: '台股', grp: '股市' },
  { k: 'btc', label: '加密', grp: '加密' },
  { k: 'dxy', label: '美元', grp: '匯率' },
  { k: 'us10y', label: '美債', grp: '債券', bond: true },
]

function flowScore(m, sel, bond) {
  const h = m?.history
  if (!h || h.length < 70) return null
  const v = h.map((p) => p[1])
  // 起點：自訂日期 → 該日（或之前最近一個交易日）的收盤；否則往回 N 根
  let base
  if (sel.type === 'date') {
    base = -1
    for (let i = h.length - 1; i >= 0; i--) if (h[i][0] <= sel.d) { base = i; break }
    if (base < 0 || base >= h.length - 1) return null
  } else {
    base = h.length - 1 - sel.n
    if (base < 0) return null
  }
  const n = h.length - 1 - base
  const daily = []
  for (let i = v.length - 61; i < v.length; i++) {
    if (i < 1) continue
    daily.push(bond ? -(v[i] - v[i - 1]) * 100 : Math.log(v[i] / v[i - 1]) * 100)
  }
  const hist = daily.slice(0, -1)
  const mu = hist.reduce((s, x) => s + x, 0) / hist.length
  const sd = Math.sqrt(hist.reduce((s, x) => s + (x - mu) ** 2, 0) / hist.length)
  const a = v[base], b = v[v.length - 1]
  const raw = bond ? -(b - a) * 100 : (b / a - 1) * 100
  const z = sd ? raw / (sd * Math.sqrt(n)) : 0
  return { z: +z.toFixed(2), raw, n, from: h[base][0], to: h[h.length - 1][0] }
}

const FLOW_KEY = 'mdj.flow.v1'
const loadFlowSel = () => { try { return JSON.parse(localStorage.getItem(FLOW_KEY)) || { type: 'n', n: 1 } } catch { return { type: 'n', n: 1 } } }

export function FlowChart({ metrics }) {
  const [sel, setSelRaw] = useState(loadFlowSel)
  const [sorted, setSorted] = useState(false)
  const [nInput, setNInput] = useState(sel.type === 'n' ? String(sel.n) : '')
  const setSel = (x) => { setSelRaw(x); try { localStorage.setItem(FLOW_KEY, JSON.stringify(x)) } catch { /* 無痕模式 */ } }
  const maxN = useMemo(() => Math.max(1, Math.min(...FLOW_ASSETS.map((a) => (metrics?.[a.k]?.history?.length || 400) - 1))), [metrics])
  const data = useMemo(() => {
    const rows = FLOW_ASSETS.map((a) => {
      const s = flowScore(metrics?.[a.k], sel, a.bond)
      return s && { ...a, ...s }
    }).filter(Boolean)
    return sorted ? [...rows].sort((x, y) => y.z - x.z) : rows
  }, [metrics, sel, sorted])
  const applyN = (raw) => {
    const n = Math.round(Number(raw))
    if (!Number.isFinite(n) || n < 1) return
    const c = Math.min(n, maxN)
    setNInput(String(c))
    setSel({ type: 'n', n: c })
  }
  const today = new Date().toISOString().slice(0, 10)
  const span = data.length ? `${data[0].from === data.at(-1).from ? data[0].from : '各市場起點略異'} → 最新` : ''
  const lim = Math.max(2, Math.ceil(Math.max(...data.map((d) => Math.abs(d.z)), 0)))
  const inflow = data.filter((d) => d.z >= 0.5).map((d) => d.label)
  const outflow = data.filter((d) => d.z <= -0.5).map((d) => d.label)
  return (
    <div>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
        <div className="text-[11px] text-muted">
          {inflow.length ? <>流入：<span className="up">{inflow.join('、')}</span></> : '無明顯流入'}
          <span className="mx-2">｜</span>
          {outflow.length ? <>流出：<span className="down">{outflow.join('、')}</span></> : '無明顯流出'}
        </div>
        <div className="flex gap-1 flex-wrap items-center">
          {[[1, '1D'], [5, '5D'], [20, '20D'], [60, '60D']].map(([v, l]) => (
            <button key={v} onClick={() => { setNInput(String(v)); setSel({ type: 'n', n: v }) }}
              className={`text-[11px] px-2 py-0.5 rounded ${sel.type === 'n' && sel.n === v ? 'bg-s1 text-white' : 'bg-surface2 text-ink2'}`}>{l}</button>
          ))}
          <label className={`flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded ${sel.type === 'n' && ![1, 5, 20, 60].includes(sel.n) ? 'bg-s1 text-white' : 'bg-surface2 text-ink2'}`}>
            自訂
            <input type="number" inputMode="numeric" min="1" max={maxN} value={nInput}
              onChange={(e) => setNInput(e.target.value)}
              onBlur={(e) => applyN(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyN(e.currentTarget.value)}
              className="w-12 bg-bg text-ink border border-line rounded px-1 py-0 text-[11px] num" aria-label="自訂交易日數" />
            日
          </label>
          <label className={`flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded ${sel.type === 'date' ? 'bg-s1 text-white' : 'bg-surface2 text-ink2'}`}>
            起始日
            <input type="date" max={today} value={sel.type === 'date' ? sel.d : ''}
              onChange={(e) => e.target.value && setSel({ type: 'date', d: e.target.value })}
              className="bg-bg text-ink border border-line rounded px-1 py-0 text-[11px] num [color-scheme:dark]" aria-label="起始日期" />
          </label>
          <button onClick={() => setSorted((s) => !s)}
            className={`text-[11px] px-2 py-0.5 rounded ${sorted ? 'bg-s1 text-white' : 'bg-surface2 text-ink2'}`}>排序</button>
        </div>
      </div>
      <div className="text-[10px] text-muted num mb-1">
        區間：{sel.type === 'date' ? `${sel.d} 起（${span}）` : `最近 ${sel.n} 個交易日（${span}）`}
        {sel.type === 'n' && <span>　可輸入 1–{maxN}</span>}
      </div>
      <div className="h-56">
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 18, right: 8, left: -14, bottom: 0 }} barCategoryGap="22%">
            {GRID}
            <XAxis dataKey="label" {...AX} interval={0} tick={{ fill: '#c3c2b7', fontSize: 12 }} />
            <YAxis {...AX} width={40} domain={[-lim, lim]} tickFormatter={(v) => `${v}σ`} />
            <ReferenceLine y={0} stroke="#8d8c84" />
            <ReferenceLine y={2} stroke="#4a4a45" strokeDasharray="4 3" />
            <ReferenceLine y={-2} stroke="#4a4a45" strokeDasharray="4 3" />
            <Tooltip {...TT} cursor={{ fill: '#2a2a27' }}
              formatter={(v, _n, p) => [`${v > 0 ? '+' : ''}${v}σ（${p.payload.bond ? '殖利率 ' + (p.payload.raw > 0 ? '−' : '+') + Math.abs(p.payload.raw).toFixed(1) + 'bp' : (p.payload.raw > 0 ? '+' : '') + p.payload.raw.toFixed(2) + '%'}）`, `${p.payload.label}・${p.payload.from} → ${p.payload.to}`]}
              labelFormatter={() => ''} />
            <Bar isAnimationActive={false} dataKey="z" radius={[4, 4, 4, 4]}
              label={{ position: 'top', fill: '#c3c2b7', fontSize: 11, formatter: (v) => `${v > 0 ? '+' : ''}${v}` }}>
              {data.map((d) => <Cell key={d.k} fill={d.z >= 0 ? 'var(--up)' : 'var(--down)'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[10px] text-muted leading-relaxed">
        代理指標，非實際申贖資金：σ = N 日報酬 ÷ 該資產近 60 日波動，讓波動不同的資產可直接比較；|σ| ≥ 2（虛線）為異常強烈移動。
        美債以價格方向呈現（殖利率下跌 = 流入）。各市場收盤日不同（加密含週末）。
      </p>
    </div>
  )
}
