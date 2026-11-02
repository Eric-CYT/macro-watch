import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Panel } from './bits'
import { fmt } from '../lib/util'
import {
  MARKETS, STATES, TRENDS, LEVELS, BIASES, DECISIONS, CYCLES, FUND_STATES, FUND_DEST, TA_SIGNALS, TA_VERDICT,
  emptyTrade, normalize, marketName, flowZ, flowRanking,
  loadTrades, addTrade, deleteTrade, loadTradeDraft, saveTradeDraft, clearTradeDraft, reference, checks, followUp,
  QMETA, loadOrder, saveOrder, DEFAULT_ORDER, updateTrade,
} from '../lib/trades'
import { Sizing, ResultEditor, SnapLine, Performance, resultOf, loadAcct } from './TradeExtras'
import { macroSnapshot } from '../lib/position'

const freshTrade = (keep = {}) => {
  const e = emptyTrade()
  const a = loadAcct() || {}
  return { ...e, ...keep, pos: { ...e.pos, ...(a.equity ? { equity: a.equity } : {}), ...(a.riskPct ? { riskPct: a.riskPct } : {}), ...(keep.pos || {}) } }
}

const inp = 'bg-bg border border-line rounded-lg px-2 py-1.5 text-[13px] text-ink placeholder:text-muted focus:outline-none focus:border-s1'
const sel = `${inp} pr-6`

export default function TradeCheck({ metrics, flows }) {
  const [t, setT] = useState(() => {
    const d = loadTradeDraft()
    return d ? normalize(d) : freshTrade()
  })
  const [list, setList] = useState(loadTrades)
  const [msg, setMsg] = useState('')
  const [filter, setFilter] = useState('all')
  const [order, setOrderRaw] = useState(loadOrder)
  const [editOrder, setEditOrder] = useState(false)
  const setOrder = (o) => { setOrderRaw(o); saveOrder(o) }
  const move = (i, d) => {
    const j = i + d
    if (j < 0 || j >= order.length) return
    const o = [...order]; [o[i], o[j]] = [o[j], o[i]]; setOrder(o)
  }
  const dirty = useRef(false)

  useEffect(() => {
    if (!dirty.current) return
    const x = setTimeout(() => saveTradeDraft(t), 500)
    return () => clearTimeout(x)
  }, [t])

  const set = (q, patch) => { dirty.current = true; setT((o) => ({ ...o, [q]: typeof patch === 'object' ? { ...o[q], ...patch } : patch })) }
  const m = t.market !== 'other' ? metrics?.[t.market] : null
  const ref = useMemo(() => reference(m), [m])
  const cks = useMemo(() => checks(t, ref), [t, ref])
  const errors = cks.filter((c) => c.level === 'error').length
  const ranking = useMemo(() => flowRanking(metrics, 5), [metrics])
  const myFlow = m ? [1, 5, 20].map((n) => ({ n, z: flowZ(m, n) })) : null
  const memo = (q) => <Memo value={t[q].memo} onChange={(v) => set(q, { memo: v })} />
  const toggleArr = (q, key, v) => set(q, { [key]: t[q][key].includes(v) ? t[q][key].filter((x) => x !== v) : [...t[q][key], v] })

  const submit = () => {
    if (errors && !confirm(`還有 ${errors} 個邏輯錯誤，仍要記錄嗎？`)) return
    setList(addTrade({ ...t, ref: ref ? { last: ref.last, date: ref.date, trend: ref.trend } : null, snap: macroSnapshot(metrics, flows) }))
    clearTradeDraft(); dirty.current = false
    setT(freshTrade({ market: t.market, custom: t.custom, product: t.product, pos: { inst: t.pos.inst, pv: t.pos.pv } }))
    setMsg('已記錄 ✓（下方歷史紀錄可追蹤後續走勢）')
    setTimeout(() => setMsg(''), 4000)
  }

  const shown = list.filter((x) => !x.deleted && (filter === 'all' || x.market === filter))
  const usedMarkets = [...new Set(list.filter((x) => !x.deleted).map((x) => x.market))]

  const blocks = {
    q1: (n) => (
            <Q n={n} title="當前市場正在幹甚麼？">
              <Chips options={STATES} value={t.q1.state} onChange={(v) => set('q1', { state: v })} />
              <input value={t.q1.note} onChange={(e) => set('q1', { note: e.target.value })} placeholder="補充：量價、消息、資金流向…" className={`${inp} w-full mt-2`} />
              {memo('q1')}
            </Q>
    ),
    q2: (n) => (
            <Q n={n} title="趨勢的起點在哪裡？">
              <div className="flex flex-wrap gap-2">
                <label className="text-[12px] text-muted flex items-center gap-1">日期
                  <input type="date" value={t.q2.date} onChange={(e) => set('q2', { date: e.target.value })} className={`${inp} [color-scheme:dark]`} /></label>
                <label className="text-[12px] text-muted flex items-center gap-1">價位
                  <input type="number" inputMode="decimal" value={t.q2.price} onChange={(e) => set('q2', { price: e.target.value })} className={`${inp} w-32 num`} /></label>
              </div>
              <input value={t.q2.note} onChange={(e) => set('q2', { note: e.target.value })} placeholder="起點的依據：前低／前高、突破點、事件日…" className={`${inp} w-full mt-2`} />
              {ref && (
                <div className="text-[11px] text-muted mt-1 num flex flex-wrap gap-x-3">
                  <span>參考｜近 60 日低點 {fmt(ref.e60.lo[1], ref.decimals)}（{ref.e60.lo[0]}）
                    <button className="text-s1 ml-1" onClick={() => set('q2', { date: ref.e60.lo[0], price: String(+ref.e60.lo[1].toFixed(ref.decimals)) })}>帶入</button></span>
                  <span>高點 {fmt(ref.e60.hi[1], ref.decimals)}（{ref.e60.hi[0]}）
                    <button className="text-s1 ml-1" onClick={() => set('q2', { date: ref.e60.hi[0], price: String(+ref.e60.hi[1].toFixed(ref.decimals)) })}>帶入</button></span>
                </div>
              )}
              {memo('q2')}
            </Q>
    ),
    q3: (n) => (
            <Q n={n} title="當前趨勢是甚麼？">
              <Chips options={TRENDS} value={t.q3.trend} onChange={(v) => set('q3', { trend: v })} />
              {ref && <Ref>參考｜日線：{ref.trend}（現價 {fmt(ref.last, ref.decimals)}、MA20 {fmt(ref.ma20, ref.decimals)}、MA60 {fmt(ref.ma60, ref.decimals)}）</Ref>}
              {memo('q3')}
            </Q>
    ),
    q4: (n) => (
            <Q n={n} title="當前趨勢的級別是甚麼？">
              <Chips options={LEVELS} value={t.q4.level} onChange={(v) => set('q4', { level: v })} />
              {memo('q4')}
            </Q>
    ),
    q5: (n) => (
            <Q n={n} title="你的偏見是甚麼？">
              <Chips options={BIASES} value={t.q5.bias} onChange={(v) => set('q5', { bias: v })} colors={{ 偏多: 'var(--up)', 偏空: 'var(--down)' }} />
              <input value={t.q5.note} onChange={(e) => set('q5', { note: e.target.value })} placeholder="偏見的理由，以及它可能錯在哪" className={`${inp} w-full mt-2`} />
              {memo('q5')}
            </Q>
    ),
    q6: (n) => (
            <Q n={n} title="你是順哪個大、逆哪個小？">
              <div className="grid sm:grid-cols-2 gap-2">
                <div className="rounded-lg bg-bg p-2">
                  <div className="text-[12px] text-ink2 mb-1">順大（跟隨的大級別）</div>
                  <div className="flex gap-2">
                    <select value={t.q6.bigLevel} onChange={(e) => set('q6', { bigLevel: e.target.value })} className={sel} aria-label="大級別">
                      <option value="">級別</option>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
                    <select value={t.q6.bigDir} onChange={(e) => set('q6', { bigDir: e.target.value })} className={sel} aria-label="大級別方向">
                      <option value="">方向</option>{TRENDS.map((l) => <option key={l}>{l}</option>)}</select>
                  </div>
                </div>
                <div className="rounded-lg bg-bg p-2">
                  <div className="text-[12px] text-ink2 mb-1">逆小（利用的小級別回檔／反彈）</div>
                  <div className="flex gap-2">
                    <select value={t.q6.smallLevel} onChange={(e) => set('q6', { smallLevel: e.target.value })} className={sel} aria-label="小級別">
                      <option value="">級別</option>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
                    <select value={t.q6.smallDir} onChange={(e) => set('q6', { smallDir: e.target.value })} className={sel} aria-label="小級別方向">
                      <option value="">方向</option>{TRENDS.map((l) => <option key={l}>{l}</option>)}</select>
                  </div>
                </div>
              </div>
              {t.q6.bigLevel && t.q6.smallLevel && t.q6.bigDir && t.q6.smallDir && (
                <Ref>你的句子：順「{t.q6.bigLevel}{t.q6.bigDir}」、逆「{t.q6.smallLevel}{t.q6.smallDir}」</Ref>
              )}
              {memo('q6')}
            </Q>
    ),
    q7: (n) => (
            <Q n={n} title="你的防守位在哪？">
              <div className="flex flex-wrap gap-2">
                {[['entry', '預計進場價'], ['stop', '防守位（停損）']].map(([k, l]) => (
                  <label key={k} className="text-[12px] text-muted flex items-center gap-1">{l}
                    <input type="number" inputMode="decimal" value={t.q7[k]} onChange={(e) => set('q7', { [k]: e.target.value })} className={`${inp} w-32 num`} /></label>
                ))}
                {ref && !t.q7.entry && <button className="text-[12px] text-s1" onClick={() => set('q7', { entry: String(+ref.last.toFixed(ref.decimals)) })}>以現價帶入進場價</button>}
              </div>
              <input value={t.q7.note} onChange={(e) => set('q7', { note: e.target.value })} placeholder="防守位的依據：前低、均線、結構破壞點…" className={`${inp} w-full mt-2`} />
              {ref && <Ref>參考｜近 20 日低點 {fmt(ref.e20.lo[1], ref.decimals)}、高點 {fmt(ref.e20.hi[1], ref.decimals)}</Ref>}
              {memo('q7')}
            </Q>
    ),
    q8: (n) => (
            <Q n={n} title="要不要到交易週期裡面去？">
              <Chips options={DECISIONS} value={t.q8.decision} onChange={(v) => set('q8', { decision: v })}
                colors={{ 進場: 'var(--color-s1)', 放棄: 'var(--color-muted)' }} />
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <span className="text-[12px] text-muted">交易週期</span>
                <Chips options={CYCLES} value={t.q8.cycle} onChange={(v) => set('q8', { cycle: v })} />
              </div>
              <input value={t.q8.note} onChange={(e) => set('q8', { note: e.target.value })}
                placeholder={t.q8.decision === '等待（設條件觀察）' ? '等待什麼條件出現才進場？' : '決策理由'} className={`${inp} w-full mt-2`} />
              {memo('q8')}
            </Q>
    ),
    q9: (n) => (
            <Q n={n} title="資金在幹嘛？">
              <Chips options={FUND_STATES} value={t.q9.state} onChange={(v) => set('q9', { state: v })} />
              {myFlow && (
                <Ref>參考｜此市場資金流向（與儀表板同算法）：{myFlow.map(({ n, z }) => (
                  <span key={n} className="mr-2">{n}D <span className={z > 0 ? 'up' : z < 0 ? 'down' : ''}>{z == null ? '—' : `${z > 0 ? '+' : ''}${z.toFixed(1)}σ`}</span></span>))}
                  <span className="text-muted">（|σ| ≥ 1 為明顯，≥ 2 為異常）</span></Ref>
              )}
              {memo('q9')}
            </Q>
    ),
    q10: (n) => (
            <Q n={n} title="資金會去哪？（可複選）">
              <div className="flex flex-wrap gap-1">
                {FUND_DEST.map((d) => {
                  const on = t.q10.dest.includes(d)
                  return <button key={d} type="button" onClick={() => toggleArr('q10', 'dest', d)}
                    className={`text-[12px] px-2.5 py-1 rounded-lg border ${on ? 'bg-s2 border-s2 text-white' : 'border-line text-ink2 hover:bg-surface2'}`}>{d}</button>
                })}
              </div>
              {ranking.length > 0 && (
                <Ref>參考｜近 5 日資金最強流入：{ranking.slice(0, 3).map((x) => `${x.name} ${x.z > 0 ? '+' : ''}${x.z.toFixed(1)}σ`).join('、')}
                  ；最強流出：{ranking.slice(-3).reverse().map((x) => `${x.name} ${x.z > 0 ? '+' : ''}${x.z.toFixed(1)}σ`).join('、')}</Ref>
              )}
              {memo('q10')}
            </Q>
    ),
    q11: (n) => (
            <Q n={n} title="目前技術分析的情況？是否適合進場？">
              <div className="text-[12px] text-muted mb-1">看到的訊號（可複選）</div>
              <div className="flex flex-wrap gap-1">
                {TA_SIGNALS.map((d) => {
                  const on = t.q11.signals.includes(d)
                  return <button key={d} type="button" onClick={() => toggleArr('q11', 'signals', d)}
                    className={`text-[12px] px-2.5 py-1 rounded-lg border ${on ? 'bg-s1 border-s1 text-white' : 'border-line text-ink2 hover:bg-surface2'}`}>{d}</button>
                })}
              </div>
              {ref && (
                <Ref>參考｜日線 RSI(14) {ref.rsi.toFixed(1)}、距 MA20 {ref.distMa20 > 0 ? '+' : ''}{ref.distMa20.toFixed(2)}%
                  ；系統偵測：{ref.signals.length ? ref.signals.join('、') : '無明顯訊號'}
                  {ref.signals.length > 0 && <button className="text-s1 ml-1" onClick={() => set('q11', { signals: [...new Set([...t.q11.signals, ...ref.signals])] })}>帶入</button>}</Ref>
              )}
              <div className="text-[12px] text-muted mt-2 mb-1">結論</div>
              <Chips options={TA_VERDICT} value={t.q11.verdict} onChange={(v) => set('q11', { verdict: v })}
                colors={{ 適合進場: 'var(--color-good)', 不適合進場: 'var(--color-critical)', 等待確認訊號: 'var(--color-warning)' }} />
              {memo('q11')}
            </Q>
    ),
    q12: (n) => (
            <Q n={n} title="獲利價？">
              <div className="flex flex-wrap gap-2">
                {[['t1', '第一獲利價'], ['t2', '第二獲利價（選填）']].map(([k, l]) => (
                  <label key={k} className="text-[12px] text-muted flex items-center gap-1">{l}
                    <input type="number" inputMode="decimal" value={t.q12[k]} onChange={(e) => set('q12', { [k]: e.target.value })} className={`${inp} w-32 num`} aria-label={l} /></label>
                ))}
              </div>
              {ref && <Ref>參考｜近 60 日高點 {fmt(ref.e60.hi[1], ref.decimals)}、低點 {fmt(ref.e60.lo[1], ref.decimals)}（前高／前低常是第一獲利區）</Ref>}
              {memo('q12')}
            </Q>
    ),
  }

  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_380px]">
      <div className="space-y-3 min-w-0">
        <Panel title="交易前檢查：每次進場前回答 12 個問題" right={
          <button onClick={() => setEditOrder((x) => !x)}
            className={`text-[12px] px-2.5 py-1 rounded-lg ${editOrder ? 'bg-s1 text-white' : 'bg-surface2 text-ink2'}`}>
            {editOrder ? '完成排序' : '⇅ 調整題目順序'}</button>}>
          {editOrder && (
            <div className="mb-3 p-2 rounded-lg bg-bg border border-line">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[12px] text-ink2">用 ↑ ↓ 調整順序（自動儲存在這台裝置）</span>
                <button onClick={() => setOrder([...DEFAULT_ORDER])} className="text-[11px] text-s1">恢復預設順序</button>
              </div>
              <ol className="space-y-1">
                {order.map((k, i) => (
                  <li key={k} draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { const from = Number(e.dataTransfer.getData('text/plain')); const o = [...order]; const [x] = o.splice(from, 1); o.splice(i, 0, x); setOrder(o) }}
                    className="flex items-center gap-2 px-2 py-1 rounded bg-surface2 text-[13px] cursor-grab">
                    <span className="text-muted w-5 text-right num">{i + 1}.</span>
                    <span className="flex-1 text-ink">{QMETA[k].title}</span>
                    <button onClick={() => move(i, -1)} disabled={i === 0} className="px-2 py-0.5 rounded bg-bg text-ink2 disabled:opacity-30" aria-label="上移">↑</button>
                    <button onClick={() => move(i, 1)} disabled={i === order.length - 1} className="px-2 py-0.5 rounded bg-bg text-ink2 disabled:opacity-30" aria-label="下移">↓</button>
                  </li>
                ))}
              </ol>
              <p className="text-[10px] text-muted mt-1">電腦上也可以直接拖曳排序。</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-[13px] text-ink2">交易市場</span>
            <select value={t.market} onChange={(e) => set('market', e.target.value)} className={sel} aria-label="交易市場">
              {MARKETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {t.market === 'other' && (
              <input value={t.custom} onChange={(e) => set('custom', e.target.value)} placeholder="例如：2330 台積電、NVDA、ETH" className={`${inp} w-56`} />
            )}
            <span className="text-[13px] text-ink2 ml-1">交易商品</span>
            <input value={t.product} onChange={(e) => set('product', e.target.value)}
              placeholder="例如：台指期 TX、0050、2330、MNQ、BTCUSDT 永續" className={`${inp} w-64`} aria-label="交易商品名稱" />
            {ref && <span className="text-[12px] text-muted num">參考指數現價 {fmt(ref.last, ref.decimals)}（{ref.date}）</span>}
          </div>

          {order.map((k, i) => <Fragment key={k}>{blocks[k]?.(i + 1)}</Fragment>)}
          <Sizing t={t} set={set} />

          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <button onClick={submit} className="px-4 py-2 rounded-lg bg-s1 text-white text-sm font-medium">記錄這次檢查</button>
            <button onClick={() => { clearTradeDraft(); dirty.current = false; setT(freshTrade({ market: t.market })) }}
              className="px-3 py-2 rounded-lg bg-surface2 text-sm text-ink2">清空重填</button>
            <span className="text-[12px] text-good">{msg}</span>
            <span className="text-[11px] text-muted ml-auto">填寫中會自動暫存</span>
          </div>
        </Panel>
      </div>

      <div className="space-y-3 xl:sticky xl:top-16 self-start">
        <Panel title="邏輯一致性檢查">
          <ul className="space-y-1.5">
            {cks.map((c, i) => (
              <li key={i} className="text-[12px] flex gap-1.5" style={{ color: c.level === 'error' ? 'var(--color-critical)' : c.level === 'warn' ? 'var(--color-warning)' : 'var(--color-good)' }}>
                <span>{c.level === 'error' ? '✕' : c.level === 'warn' ? '⚠' : '✓'}</span><span>{c.msg}</span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-muted mt-2">系統參考只用日收盤價計算（均線：MA20、MA60），4 小時以下級別請以你的看盤軟體為準。</p>
        </Panel>
        <Summary t={t} order={order} />
      </div>

      <div className="xl:col-span-2"><Performance list={list} /></div>

      <div className="xl:col-span-2">
        <Panel title={`歷史交易檢查紀錄（${shown.length}）`} right={
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className={sel} aria-label="篩選市場">
            <option value="all">全部市場</option>
            {usedMarkets.map((k) => <option key={k} value={k}>{MARKETS.find(([x]) => x === k)?.[1] || k}</option>)}
          </select>}>
          {shown.length ? (
            <div className="space-y-2">
              {shown.map((x) => <TradeRow key={x.id} t={x} order={order} m={x.market !== 'other' ? metrics?.[x.market] : null}
                onDelete={() => confirm('刪除這筆紀錄？') && setList(deleteTrade(x.id))}
                onResult={(r) => setList(updateTrade(x.id, { result: r }))} />)}
            </div>
          ) : <p className="text-[12px] text-muted">還沒有紀錄。每次交易前填一次，累積下來就能回頭檢討自己的判斷。</p>}
        </Panel>
      </div>
    </div>
  )
}

function Q({ n, title, children }) {
  return (
    <section className="py-3 border-t border-line first-of-type:border-0">
      <h3 className="text-[14px] text-ink mb-2"><span className="text-s1 font-semibold mr-1">{n}.</span>{title}</h3>
      {children}
    </section>
  )
}

function Chips({ options, value, onChange, colors = {} }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = value === o
        const c = colors[o] || 'var(--color-s1)'
        return (
          <button key={o} type="button" onClick={() => onChange(on ? '' : o)}
            className={`text-[12px] px-2.5 py-1 rounded-lg border ${on ? 'text-white' : 'border-line text-ink2 hover:bg-surface2'}`}
            style={on ? { background: c, borderColor: c } : undefined}>{o}</button>
        )
      })}
    </div>
  )
}

function Memo({ value, onChange }) {
  return (
    <textarea value={value || ''} onChange={(e) => onChange(e.target.value)} rows={1}
      placeholder="備註" onInput={(e) => { e.target.style.height = 'auto'; e.target.style.height = `${e.target.scrollHeight}px` }}
      className={`${inp} w-full mt-2 resize-y min-h-[34px] text-[12px]`} aria-label="備註" />
  )
}

/** 一句話總覽用的精簡答案 */
function briefs(t) {
  return {
    q1: t.q1.state, q2: [t.q2.date, t.q2.price].filter(Boolean).join(' @ '), q3: t.q3.trend, q4: t.q4.level, q5: t.q5.bias,
    q6: t.q6.bigLevel && t.q6.smallLevel ? `順${t.q6.bigLevel}${t.q6.bigDir} 逆${t.q6.smallLevel}${t.q6.smallDir}` : '',
    q7: [t.q7.entry && `進 ${t.q7.entry}`, t.q7.stop && `守 ${t.q7.stop}`].filter(Boolean).join('・'),
    q8: [t.q8.decision, t.q8.cycle].filter(Boolean).join('・'), q9: t.q9.state, q10: t.q10.dest.join('、'),
    q11: [t.q11.verdict, t.q11.signals.join('、')].filter(Boolean).join('｜'), q12: [t.q12.t1, t.q12.t2].filter(Boolean).join(' / '),
  }
}
/** 歷史紀錄展開用：[答案, 備註] */
function details(t) {
  return {
    q1: [[t.q1.state, t.q1.note].filter(Boolean).join('｜'), t.q1.memo],
    q2: [[[t.q2.date, t.q2.price].filter(Boolean).join(' @ '), t.q2.note].filter(Boolean).join('｜'), t.q2.memo],
    q3: [t.q3.trend + (t.ref ? `（當時系統日線判斷：${t.ref.trend}）` : ''), t.q3.memo],
    q4: [t.q4.level, t.q4.memo],
    q5: [[t.q5.bias, t.q5.note].filter(Boolean).join('｜'), t.q5.memo],
    q6: [t.q6.bigLevel ? `順「${t.q6.bigLevel}${t.q6.bigDir}」逆「${t.q6.smallLevel}${t.q6.smallDir}」` : '', t.q6.memo],
    q7: [[`進場 ${t.q7.entry || '—'}・防守 ${t.q7.stop || '—'}`, t.q7.note].filter(Boolean).join('｜'), t.q7.memo],
    q8: [[t.q8.decision, t.q8.cycle, t.q8.note].filter(Boolean).join('・'), t.q8.memo],
    q9: [t.q9.state, t.q9.memo], q10: [t.q10.dest.join('、'), t.q10.memo],
    q11: [[t.q11.verdict, t.q11.signals.join('、')].filter(Boolean).join('｜'), t.q11.memo],
    q12: [[t.q12.t1, t.q12.t2].filter(Boolean).join(' / '), t.q12.memo],
  }
}

const Ref = ({ children }) => <div className="text-[11px] text-muted mt-1 num">{children}</div>

function Summary({ t, order }) {
  const brief = briefs(t)
  const rows = [['市場', marketName(t)], ['商品', t.product], ...order.map((k, i) => [`${i + 1} ${QMETA[k].short}`, brief[k]])]
  return (
    <Panel title="一句話總覽">
      <dl className="text-[12px] grid grid-cols-[84px_1fr] gap-y-1">
        {rows.map(([k, v]) => <Fragment key={k}><dt className="text-muted">{k}</dt><dd className={v ? 'text-ink' : 'text-muted'}>{v || '—'}</dd></Fragment>)}
      </dl>
    </Panel>
  )
}

function TradeRow({ t, m, order, onDelete, onResult }) {
  const [open, setOpen] = useState(false)
  const f = followUp(t, m)
  const res = resultOf(t)
  const created = new Date(t.created_at).toLocaleString('zh-TW', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="rounded-lg bg-surface2 p-2">
      <button className="w-full text-left flex flex-wrap items-center gap-x-3 gap-y-1" onClick={() => setOpen((o) => !o)}>
        <span className="num text-[12px] text-muted">{created}</span>
        <span className="text-[13px] text-ink font-medium">{marketName(t)}{t.product && <span className="text-ink2 font-normal">｜{t.product}</span>}</span>
        <span className={`text-[12px] ${t.q5.bias === '偏多' ? 'up' : t.q5.bias === '偏空' ? 'down' : 'text-ink2'}`}>{t.q5.bias || '—'}</span>
        <span className="text-[12px] text-ink2">{t.q8.decision || '未決定'}{t.q8.cycle ? `・${t.q8.cycle}` : ''}</span>
        {t.result?.status && t.result.status !== '未進場' && (
          <span className="text-[12px] px-1.5 rounded bg-bg num">{t.result.status}
            {res && <b className={`ml-1 ${res.net > 0 ? 'up' : res.net < 0 ? 'down' : ''}`}>{res.R != null ? `${res.R > 0 ? '+' : ''}${res.R.toFixed(2)}R` : Math.round(res.net).toLocaleString()}</b>}</span>
        )}
        {f && (
          <span className="text-[12px] num ml-auto">
            至今 <span className={f.chg > 0 ? 'up' : f.chg < 0 ? 'down' : ''}>{f.rate ? `${f.chg > 0 ? '+' : ''}${f.chg.toFixed(1)}bp` : `${f.chg > 0 ? '+' : ''}${f.chg.toFixed(2)}%`}</span>
            {f.dirOk != null && f.days > 0 && <span className="ml-1" style={{ color: f.dirOk ? 'var(--color-good)' : 'var(--color-critical)' }}>{f.dirOk ? '方向✓' : '方向✗'}</span>}
            {f.stopHit && <span className="ml-1 text-critical">防守位已觸及（{f.stopHit[0]}）</span>}
            {f.targetHit && !f.stopHit && <span className="ml-1 text-good">目標已達（{f.targetHit[0]}）</span>}
            {f.days === 0 && <span className="ml-1 text-muted">尚無新收盤</span>}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2 text-[12px] text-ink2 space-y-1 border-t border-line pt-2">
          {(() => {
            const d = details(t)
            return order.map((k, i) => (
              <p key={k}>{i + 1}. {QMETA[k].short}：{d[k][0] || '—'}{d[k][1] && <span className="block pl-4 text-muted whitespace-pre-wrap">備註：{d[k][1]}</span>}</p>
            ))
          })()}
          <SnapLine s={t.snap} />
          {f && <p className="text-muted num">追蹤：基準 {fmt(f.e, 2)} → 最新 {fmt(f.last, 2)}（{f.lastDate}，{f.days} 個收盤）。{f.mismatch ? '你的進場價與參考指數差距超過 15%（可能是個股或其他商品），改以當日指數為基準追蹤方向，不判斷防守／目標。' : '防守／目標以日收盤價判斷。'}</p>}
          <ResultEditor t={t} onSave={onResult} />
          <button onClick={onDelete} className="text-critical text-[11px]">刪除</button>
        </div>
      )}
    </div>
  )
}
