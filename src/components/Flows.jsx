import { useMemo, useState } from 'react'
import { ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, Legend } from 'recharts'
import { AX, GRID, TT } from './charts'
import { StatusDot } from './bits'
import { fmt, dirClass } from '../lib/util'

const C = { f: '#5b8def', t: '#e0a43a', d: '#a78bfa' }
const sgn = (v, d = 1) => (v == null ? '—' : `${v > 0 ? '+' : ''}${fmt(v, d)}`)
const sum = (rows, i, n) => rows.slice(-n).reduce((a, r) => a + (r[i] ?? 0), 0)

function Foot({ b }) {
  if (!b) return null
  return (
    <div className="flex items-center gap-1 text-[10px] text-muted mt-1 flex-wrap">
      {b.source}<StatusDot status={b.status} checks={b.checks} />
      {b.note && <span className="w-full leading-relaxed">{b.note}</span>}
    </div>
  )
}

/* ------------------------------------------------ 台股三大法人（現貨）＋ 台指期未平倉 */
export function TwChips({ inst, txf }) {
  const [n, setN] = useState(20)
  const rows = inst?.series || []
  const data = useMemo(() => rows.slice(-n).map(([d, f, t, dl, tot]) => ({ d: d.slice(5), f, t, dl, tot })), [rows, n])
  const oi = useMemo(() => (txf?.series || []).slice(-Math.max(n, 20)).map(([d, f, t]) => ({ d: d.slice(5), f, t })), [txf, n])
  if (!rows.length && !(txf?.series || []).length) return <p className="text-[12px] text-muted">籌碼資料尚未產生（首次更新後出現）</p>
  const last = rows.at(-1)
  const tx = txf?.series || []
  const txLast = tx.at(-1), tx5 = tx.length > 5 ? tx.at(-6) : null
  return (
    <div>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <span className="text-[11px] text-muted num">現貨最新 {last?.[0] || '—'}・單位：億元</span>
        <div className="flex gap-1">
          {[20, 60, 120].map((v) => (
            <button key={v} onClick={() => setN(v)} disabled={rows.length < Math.min(v, 21)}
              className={`text-[11px] px-2 py-0.5 rounded disabled:opacity-40 ${n === v ? 'bg-s1 text-white' : 'bg-surface2 text-ink2'}`}>{v}D</button>
          ))}
        </div>
      </div>
      {rows.length > 0 && (
        <table className="w-full text-[12px] mb-2">
          <thead className="text-muted"><tr><th className="text-left font-normal">現貨買賣超</th><th className="font-normal">當日</th><th className="font-normal">5 日累計</th><th className="font-normal">20 日累計</th></tr></thead>
          <tbody>
            {[['外資', 1, C.f], ['投信', 2, C.t], ['自營商', 3, C.d], ['合計', 4, null]].map(([l, i, c]) => (
              <tr key={l} className="border-t border-line">
                <td className="py-1"><span className="inline-block w-2 h-2 rounded-sm mr-1.5" style={{ background: c || 'transparent' }} />{l}</td>
                {[1, 5, 20].map((k) => {
                  const v = rows.length >= k ? sum(rows, i, k) : null
                  return <td key={k} className={`text-center num ${dirClass(v)}`}>{sgn(v)}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.length > 0 && (
        <div className="h-44">
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top: 4, right: 4, left: -14, bottom: 0 }} barGap={0} barCategoryGap="18%">
              {GRID}
              <XAxis dataKey="d" {...AX} minTickGap={18} />
              <YAxis {...AX} width={44} />
              <ReferenceLine y={0} stroke="#8d8c84" />
              <Tooltip {...TT} cursor={{ fill: '#2a2a27' }} formatter={(v, k) => [`${sgn(v, 2)} 億`, k]} />
              <Legend wrapperStyle={{ fontSize: 11 }} iconSize={8} />
              <Bar isAnimationActive={false} dataKey="f" name="外資" fill={C.f} />
              <Bar isAnimationActive={false} dataKey="t" name="投信" fill={C.t} />
              <Bar isAnimationActive={false} dataKey="dl" name="自營商" fill={C.d} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <Foot b={inst} />

      {tx.length > 0 && (
        <div className="mt-3 pt-2 border-t border-line">
          <div className="flex items-baseline justify-between flex-wrap gap-2 text-[12px]">
            <span className="text-ink2">台指期（大台）淨未平倉</span>
            <span className="num">
              外資 <b className={dirClass(txLast?.[1])}>{sgn(txLast?.[1], 0)}</b> 口
              {tx5 && <span className="text-muted">（5 日 {sgn(txLast[1] - tx5[1], 0)}）</span>}
              <span className="mx-1.5 text-muted">｜</span>投信 <span className={dirClass(txLast?.[2])}>{sgn(txLast?.[2], 0)}</span>
            </span>
          </div>
          <div className="h-32 mt-1">
            <ResponsiveContainer>
              <LineChart data={oi} margin={{ top: 4, right: 4, left: -6, bottom: 0 }}>
                {GRID}
                <XAxis dataKey="d" {...AX} minTickGap={18} />
                <YAxis {...AX} width={52} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                <ReferenceLine y={0} stroke="#8d8c84" />
                <Tooltip {...TT} formatter={(v, k) => [`${sgn(v, 0)} 口`, k]} />
                <Line isAnimationActive={false} dataKey="f" name="外資" stroke={C.f} dot={false} strokeWidth={1.8} />
                <Line isAnimationActive={false} dataKey="t" name="投信" stroke={C.t} dot={false} strokeWidth={1.4} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <Foot b={txf} />
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------ 聯準會淨流動性 */
export function NetLiq({ b }) {
  const s = b?.series || []
  const data = useMemo(() => s.slice(-104).map(([d, nl, w, t, r]) => ({ d, nl, w, t, r })), [s])
  if (!s.length) return <p className="text-[12px] text-muted">淨流動性資料尚未產生</p>
  const last = s.at(-1)
  const chgB = (k) => (s.length > k ? Math.round((last[1] - s.at(-1 - k)[1]) * 1000) : null) // 十億美元
  const lo = Math.min(...data.map((x) => x.nl)), hi = Math.max(...data.map((x) => x.nl))
  const pad = (hi - lo) * 0.1 || 0.1
  return (
    <div>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="text-[22px] font-semibold num text-ink">{fmt(last[1], 3)}<span className="text-[12px] text-muted ml-1">兆美元</span></span>
        <span className="text-[11px] text-muted num">{last[0]}（週三）</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[12px] my-2">
        {[['4 週', 4], ['13 週', 13], ['52 週', 52]].map(([l, k]) => {
          const v = chgB(k)
          return <div key={l} className="bg-surface2 rounded px-2 py-1"><div className="text-[10px] text-muted">{l}變化</div>
            <div className={`num ${dirClass(v)}`}>{v == null ? '—' : `${v > 0 ? '+' : ''}${v.toLocaleString()} B`}</div></div>
        })}
      </div>
      <div className="h-36">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
            {GRID}
            <XAxis dataKey="d" {...AX} minTickGap={28} tickFormatter={(d) => d.slice(2, 7)} />
            <YAxis {...AX} width={44} domain={[+(lo - pad).toFixed(2), +(hi + pad).toFixed(2)]} tickFormatter={(v) => v.toFixed(2)} />
            <Tooltip {...TT} formatter={(v, k) => [`${fmt(v, 3)} 兆`, k]} />
            <Line isAnimationActive={false} dataKey="nl" name="淨流動性" stroke="#5b8def" dot={false} strokeWidth={1.8} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="text-[11px] text-ink2 num mt-1">
        Fed 資產 {fmt(last[2], 3)} − TGA {fmt(last[3], 3)} − 逆回購 {fmt(last[4], 3)}（兆美元）
      </div>
      <Foot b={b} />
    </div>
  )
}
