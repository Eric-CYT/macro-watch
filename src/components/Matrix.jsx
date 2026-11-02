import { useEffect, useMemo, useRef, useState } from 'react'
import { Panel } from './bits'
import {
  STATES, DRIVERS, TARGETS, MATRIX, computeScores, matchScenarios, NO_SCENARIO_NOTE, SCORE_RULE_NOTE,
} from '../lib/matrixConfig'
import { matrixEvidence, stockBondCorr, REGIME_TEXT, Z_MIN } from '../lib/matrixStats'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine } from 'recharts'
import { AX, GRID, TT } from './charts'

const VERDICT = {
  confirmed: { icon: '✓', c: 'var(--color-good)', t: '歷史成立（95% 信賴下限 > 50%）' },
  weak: { icon: '~', c: 'var(--color-warning)', t: '方向對但不顯著' },
  contradicted: { icon: '✗', c: 'var(--color-critical)', t: '歷史上多數時候相反（< 45%）' },
  few: { icon: '·', c: 'var(--color-muted)', t: '樣本不足 8 次' },
  'neutral-ok': { icon: '✓', c: 'var(--color-good)', t: '確實沒有明顯方向（上漲比例 35–65%）' },
  'neutral-biased': { icon: '✗', c: 'var(--color-critical)', t: '標為中性，但歷史上有明顯方向' },
}
function Ev({ c }) {
  if (!c || c.verdict === 'na') return null
  const v = VERDICT[c.verdict]
  const pct = c.rate != null ? `${Math.round(c.rate * 100)}%` : `漲${Math.round((c.upShare ?? 0) * 100)}%`
  return <span className="block text-[10px] font-normal num" style={{ color: v.c }} title={`${v.t}；樣本 ${c.n} 次`}>{v.icon} {pct}<span className="text-muted">/{c.n}</span></span>
}

const KEY = 'mdj.matrix.v1'
// 本頁燈號依需求：> 0 綠、< 0 紅、= 0 灰
const GREEN = '#2fb36a', RED = '#ef5f5f', GRAY = '#8d8c84'
const TONE = { good: GREEN, critical: RED, serious: '#ec835a', warning: '#fab219' }
const sc = (v) => (v > 0 ? GREEN : v < 0 ? RED : GRAY)
const sign = (v) => (v == null ? 'N/A' : v > 0 ? `+${v}` : `${v}`)

/** (i) 資訊圖示：滑鼠懸浮、鍵盤聚焦或手機點擊時顯示說明 */
export function InfoTip({ title, children, align = 'left' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <span ref={ref} className="relative inline-flex align-middle"
      onPointerEnter={(e) => e.pointerType === 'mouse' && setOpen(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setOpen(false)}>
      <button type="button" aria-label={`說明：${title || ''}`} aria-expanded={open}
        onClick={() => setOpen(true)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        className="w-4 h-4 rounded-full border border-ink2 text-ink2 text-[10px] leading-none inline-flex items-center justify-center hover:border-s1 hover:text-s1 italic font-serif">i</button>
      {open && (
        <span role="tooltip"
          className={`absolute z-50 top-6 ${align === 'right' ? 'right-0' : 'left-0'} w-72 max-w-[80vw] p-2.5 rounded-lg bg-surface2 border border-line shadow-2xl text-left`}>
          {title && <span className="block text-[12px] font-semibold text-ink mb-1">{title}</span>}
          <span className="block text-[12px] leading-relaxed text-ink2">{children}</span>
        </span>
      )}
    </span>
  )
}

export default function Matrix({ metrics }) {
  const [states, setStatesRaw] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEY)) || { dxy: 'up', us10y: 'up', oil: 'up', spx: 'up' } } catch { return { dxy: 'up', us10y: 'up', oil: 'up', spx: 'up' } }
  })
  const setStates = (x) => { setStatesRaw(x); try { localStorage.setItem(KEY, JSON.stringify(x)) } catch { /* ignore */ } }
  const [period, setPeriod] = useState(1)
  const [filled, setFilled] = useState('')

  const scores = useMemo(() => computeScores(states), [states])
  const scen = useMemo(() => matchScenarios(states), [states])
  const [win, setWin] = useState(250)
  const evid = useMemo(() => matrixEvidence(metrics), [metrics])
  const ev = evid[win]?.cells || {}
  const sb = useMemo(() => stockBondCorr(metrics), [metrics])

  // 選填：依最新收盤帶入（各指標 N 日漲跌的正負）
  const autofill = () => {
    const next = { ...states }, info = []
    for (const d of DRIVERS) {
      const h = metrics?.[d.metric]?.history
      if (!h || h.length <= period) continue
      const a = h[h.length - 1 - period][1], b = h[h.length - 1][1]
      if (b === a) continue
      next[d.key] = b > a ? 'up' : 'down'
      const rate = metrics[d.metric].rate
      info.push(`${d.name} ${rate ? `${((b - a) * 100).toFixed(1)}bp` : `${((b / a - 1) * 100).toFixed(2)}%`}`)
    }
    setStates(next)
    setFilled(`已依最新收盤（${period} 日變化）帶入：${info.join('、')}`)
  }

  return (
    <div className="space-y-3">
      {/* ── 情境判定區 ── */}
      <section className="rounded-xl border p-3" style={{ borderColor: scen[0] ? TONE[scen[0].tone] : 'var(--color-line)', background: scen[0] ? `color-mix(in srgb, ${TONE[scen[0].tone]} 10%, var(--color-surface))` : 'var(--color-surface)' }}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[12px] text-ink2">當前總經情境</span>
          <span className="text-[10px] text-muted">（依附錄 2 的觸發條件，AND 判定）</span>
        </div>
        {scen.length ? (
          <div className="flex flex-wrap gap-3">
            {scen.map((s) => (
              <div key={s.key} className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: TONE[s.tone] }} />
                <span className="text-xl font-semibold" style={{ color: TONE[s.tone] }}>{s.name}</span>
                <span className="text-[11px] text-muted">{Object.entries(s.when).map(([k, v]) => `${DRIVERS.find((d) => d.key === k).name.split(' ')[0]}${STATES[v]}`).join(' + ')}</span>
                <InfoTip title={s.name}>{s.note}</InfoTip>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: GRAY }} />
            <span className="text-xl font-semibold text-ink2">混合訊號：無明確情境</span>
            <InfoTip title="無觸發情境">{NO_SCENARIO_NOTE}</InfoTip>
          </div>
        )}
        {scen.length > 1 && (scen.some((x) => x.key === 'party')
          ? <p className="text-[11px] text-warning mt-1">⚠ 同時觸發 {scen.length} 個方向相反的情境（寬鬆的流動性 vs 避險或緊縮），訊號互相矛盾：請判斷哪一個是主導力量，再看下方計分。</p>
          : <p className="text-[11px] text-ink2 mt-1">同時觸發 {scen.length} 個情境，方向一致（都指向高利率／緊縮），彼此互相強化。</p>)}
      </section>

      <div className="grid gap-3 xl:grid-cols-[340px_1fr]">
        {/* ── 手動輸入區 ── */}
        <Panel title="驅動指標（手動輸入）">
          <div className="space-y-2">
            {DRIVERS.map((d) => (
              <div key={d.key} className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-ink flex items-center gap-1.5">{d.name}
                  <InfoTip title={`${d.name} ${STATES[states[d.key]]}`}>{MATRIX[d.key][states[d.key]]?.note}</InfoTip></span>
                <select value={states[d.key]} onChange={(e) => { setStates({ ...states, [d.key]: e.target.value }); setFilled('') }}
                  aria-label={d.name}
                  className="bg-bg border border-line rounded-lg px-2 py-1 text-[13px] font-semibold"
                  style={{ color: states[d.key] === 'up' ? GREEN : RED }}>
                  {Object.entries(STATES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-2 border-t border-line">
            <div className="flex items-center gap-1 flex-wrap">
              <button onClick={autofill} className="text-[12px] px-2 py-1 rounded bg-surface2 text-s1">依最新收盤帶入</button>
              {[1, 3, 5].map((n) => (
                <button key={n} onClick={() => setPeriod(n)}
                  className={`text-[11px] px-1.5 py-0.5 rounded ${period === n ? 'bg-s1 text-white' : 'bg-surface2 text-ink2'}`}>{n}日</button>
              ))}
            </div>
            <p className="text-[10px] text-muted mt-1">{filled || '選填：用系統的最新收盤自動設定，再依你的判斷手動調整。'}</p>
          </div>
        </Panel>

        {/* ── 計分模組 ── */}
        <div className="grid gap-3 sm:grid-cols-3">
          {TARGETS.filter((t) => t.score).map((t) => {
            const s = scores[t.key]
            const c = sc(s.total)
            return (
              <Panel key={t.key} title={<span className="flex items-center gap-1.5">{t.name}<InfoTip title="計分規則">{SCORE_RULE_NOTE}</InfoTip></span>}
                right={<span className="text-[11px] text-muted">{s.total > 0 ? '偏多' : s.total < 0 ? '偏空' : '中性'}</span>}>
                <div className="flex items-center gap-3 mb-2">
                  <span className="w-9 h-9 rounded-full shrink-0" style={{ background: c, boxShadow: `0 0 16px ${c}` }} aria-hidden />
                  <span className="num text-3xl font-semibold" style={{ color: c }}>{s.total > 0 ? `+${s.total}` : s.total}</span>
                </div>
                <ul className="text-[12px] space-y-1">
                  {s.parts.map((p) => (
                    <li key={p.driver.key} className="flex items-center justify-between gap-2">
                      <span className="text-ink2 flex items-center gap-1">{p.driver.name.split(' ')[0]} {STATES[p.state]}
                        <InfoTip title={`${p.driver.name} ${STATES[p.state]} → ${t.name} ${sign(p.value)}`}>{p.note}</InfoTip></span>
                      <span className="num font-semibold text-right" style={{ color: p.value == null ? GRAY : sc(p.value) }}>{sign(p.value)}
                        <Ev c={ev[p.driver.key]?.[p.state]?.[t.key]} /></span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )
          })}
        </div>
      </div>

      {/* ── 完整連動矩陣 ── */}
      <Panel title={<span className="flex items-center gap-1.5">資產連動矩陣<InfoTip title="怎麼看這張表">亮起的列是目前選定的狀態；每格為該驅動指標對資產的影響分數（+1 偏多、-1 偏空、0 中性、N/A 不計）。點右側 (i) 可看每一列的總經邏輯。</InfoTip></span>}
        right={<div className="flex items-center gap-1"><span className="text-[11px] text-muted">歷史驗證</span>
          {[[60, '近 60 日'], [250, '近 1 年']].map(([w, l]) => <button key={w} onClick={() => setWin(w)}
            className={`text-[11px] px-2 py-0.5 rounded ${win === w ? 'bg-s1 text-white' : 'bg-surface2 text-ink2'}`}>{l}</button>)}
          <InfoTip title="格子下方的小字是什麼" align="right">用真實日收盤檢驗這一格：驅動指標單日變化達 {Z_MIN}σ（以近 60 日波動衡量）的日子裡，目標資產同日（台股用隔一個交易日，因收盤時間較早）往矩陣說的方向走的比例，斜線後是樣本次數。✓ 歷史成立、~ 方向對但不顯著、✗ 歷史上多數相反、· 樣本不足。中性（0）格顯示上漲比例。</InfoTip></div>}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px] border-separate border-spacing-y-0.5">
            <thead className="text-muted">
              <tr>
                <th className="text-left font-normal py-1 pr-2">驅動指標</th><th className="text-left font-normal pr-2">狀態</th>
                {TARGETS.map((t) => <th key={t.key} className={`font-normal px-2 ${t.score ? 'text-ink' : ''}`}>{t.name}{t.score ? ' ●' : ''}</th>)}
                <th className="font-normal px-2">說明</th>
              </tr>
            </thead>
            <tbody>
              {DRIVERS.flatMap((d) => Object.keys(STATES).map((st) => {
                const row = MATRIX[d.key][st]
                const on = states[d.key] === st
                return (
                  <tr key={`${d.key}-${st}`} className={on ? 'bg-surface2' : 'opacity-45'}>
                    <td className={`py-1.5 pr-2 rounded-l ${on ? 'text-ink' : 'text-muted'}`}>{d.name}</td>
                    <td className="pr-2" style={{ color: st === 'up' ? GREEN : RED }}>{STATES[st]}</td>
                    {TARGETS.map((t) => {
                      const v = row.scores[t.key]
                      return <td key={t.key} className="px-2 text-center num font-semibold align-top" style={{ color: v == null ? GRAY : sc(v) }}>{sign(v)}<Ev c={ev[d.key]?.[st]?.[t.key]} /></td>
                    })}
                    <td className="px-2 text-center rounded-r"><InfoTip title={`${d.name} ${STATES[st]}`} align="right">{row.note}</InfoTip></td>
                  </tr>
                )
              }))}
              <tr>
                <td colSpan={2} className="pt-2 text-muted">目前總分</td>
                {TARGETS.map((t) => (
                  <td key={t.key} className="pt-2 text-center num font-semibold" style={{ color: sc(scores[t.key].total) }}>
                    {scores[t.key].total > 0 ? `+${scores[t.key].total}` : scores[t.key].total}</td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <EvidenceSummary ev={ev} span={evid[win]?.span} />
        <p className="text-[10px] text-muted mt-2">● 為計分燈號資產。矩陣內容與說明文字集中於 src/lib/matrixConfig.js，修改該檔即可更新。本頁燈號依你指定的規則：綠 = 偏多、紅 = 偏空（與儀表板其他頁面的漲跌配色不同）。</p>
      </Panel>

      <StockBond sb={sb} />
    </div>
  )
}

function EvidenceSummary({ ev, span }) {
  const bad = [], good = []
  for (const d of DRIVERS) for (const st of Object.keys(STATES)) for (const t of TARGETS) {
    const c = ev[d.key]?.[st]?.[t.key]
    if (!c) continue
    const label = `${d.name.split(' ')[0]}${STATES[st]} → ${t.name}`
    if (c.verdict === 'contradicted' || c.verdict === 'neutral-biased')
      bad.push(`${label}（矩陣 ${sign(c.expected)}，歷史${c.rate != null ? `只有 ${Math.round(c.rate * 100)}% 相符` : `上漲比例 ${Math.round(c.upShare * 100)}%`}，${c.n} 次）`)
    else if (c.verdict === 'confirmed') good.push(label)
  }
  if (!span) return null
  return (
    <div className="mt-3 text-[12px] space-y-1">
      <p className="text-muted num">驗證期間 {span[0]} → {span[1]}</p>
      {good.length > 0 && <p><span className="text-good">✓ 歷史成立：</span><span className="text-ink2">{good.join('、')}</span></p>}
      {bad.length > 0 && <p><span className="text-critical">✗ 與歷史不符：</span><span className="text-ink2">{bad.join('；')}</span></p>}
      <p className="text-[10px] text-muted">「不符」不代表矩陣邏輯錯，而是這段期間有其他力量主導（例如黃金在股市上漲時也上漲＝流動性同時推升所有資產）。用它來判斷「現在這條傳導鏈還有沒有效」。</p>
    </div>
  )
}

function StockBond({ sb }) {
  if (!sb?.series?.length) return null
  const R = REGIME_TEXT[sb.regime]
  const data = sb.series.slice(-250).map(([d, c]) => ({ d, c: c == null ? null : +c.toFixed(3) }))
  return (
    <Panel title={<span className="flex items-center gap-1.5">股債相關性（判斷現在是誰在主導）<InfoTip title="怎麼算">S&amp;P 500 日報酬 與 美債 10Y 價格方向（殖利率下跌＝債券上漲）的 60 日滾動相關係數。&gt; +0.2 股債同向、&lt; −0.2 股債反向，中間為過渡期。</InfoTip></span>}>
      <div className="flex items-baseline gap-3 flex-wrap">
        <span className="num text-2xl font-semibold" style={{ color: R?.tone }}>{sb.last == null ? '—' : `${sb.last > 0 ? '+' : ''}${sb.last.toFixed(2)}`}</span>
        <span className="text-[14px] font-medium" style={{ color: R?.tone }}>{R?.name}</span>
      </div>
      <p className="text-[12px] text-ink2 mt-1">{R?.text}</p>
      <div className="h-40 mt-2">
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 4, right: 6, left: -4, bottom: 0 }}>
            {GRID}
            <XAxis dataKey="d" {...AX} minTickGap={30} tickFormatter={(d) => d.slice(2, 7)} />
            <YAxis {...AX} domain={[-1, 1]} ticks={[-1, -0.5, -0.2, 0, 0.2, 0.5, 1]} width={40} />
            <ReferenceLine y={0} stroke="#8d8c84" />
            <ReferenceLine y={0.2} stroke="#4a4a45" strokeDasharray="4 3" />
            <ReferenceLine y={-0.2} stroke="#4a4a45" strokeDasharray="4 3" />
            <Tooltip {...TT} formatter={(v) => [v, '60 日相關']} />
            <Line isAnimationActive={false} dataKey="c" stroke="#5b8def" dot={false} strokeWidth={1.8} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[10px] text-muted">只用同一天都有收盤的日子計算（共 {sb.n} 組）。相關係數是事後統計，轉折常落後 1–2 週。</p>
    </Panel>
  )
}
