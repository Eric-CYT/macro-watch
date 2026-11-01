import { useMemo, useState } from 'react'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar,
  ReferenceLine, Legend, Cell,
} from 'recharts'
import { fmt } from '../lib/util'

const AX = { stroke: '#8d8c84', fontSize: 11, tickLine: false, axisLine: { stroke: '#33332f' } }
const GRID = <CartesianGrid stroke="#2a2a27" strokeDasharray="0" vertical={false} />
const TT = {
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
