import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Panel } from './bits'
import { fmt } from '../lib/util'
import {
  MARKETS, STATES, TRENDS, LEVELS, BIASES, DECISIONS, CYCLES, emptyTrade, marketName,
  loadTrades, addTrade, deleteTrade, loadTradeDraft, saveTradeDraft, clearTradeDraft, reference, checks, followUp,
} from '../lib/trades'

const inp = 'bg-bg border border-line rounded-lg px-2 py-1.5 text-[13px] text-ink placeholder:text-muted focus:outline-none focus:border-s1'
const sel = `${inp} pr-6`

export default function TradeCheck({ metrics }) {
  const [t, setT] = useState(() => {
    const d = loadTradeDraft()
    return d ? { ...emptyTrade(), ...d } : emptyTrade()
  })
  const [list, setList] = useState(loadTrades)
  const [msg, setMsg] = useState('')
  const [filter, setFilter] = useState('all')
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

  const submit = () => {
    if (errors && !confirm(`還有 ${errors} 個邏輯錯誤，仍要記錄嗎？`)) return
    setList(addTrade({ ...t, ref: ref ? { last: ref.last, date: ref.date, trend: ref.trend } : null }))
    clearTradeDraft(); dirty.current = false
    setT({ ...emptyTrade(), market: t.market, custom: t.custom })
    setMsg('已記錄 ✓（下方歷史紀錄可追蹤後續走勢）')
    setTimeout(() => setMsg(''), 4000)
  }

  const shown = list.filter((x) => !x.deleted && (filter === 'all' || x.market === filter))
  const usedMarkets = [...new Set(list.filter((x) => !x.deleted).map((x) => x.market))]

  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_380px]">
      <div className="space-y-3 min-w-0">
        <Panel title="交易前檢查：每次進場前回答 8 個問題">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            <span className="text-[13px] text-ink2">交易市場</span>
            <select value={t.market} onChange={(e) => set('market', e.target.value)} className={sel} aria-label="交易市場">
              {MARKETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {t.market === 'other' && (
              <input value={t.custom} onChange={(e) => set('custom', e.target.value)} placeholder="例如：2330 台積電、NVDA、ETH" className={`${inp} w-56`} />
            )}
            {ref && <span className="text-[12px] text-muted num">現價 {fmt(ref.last, ref.decimals)}（{ref.date}）</span>}
          </div>

          <Q n={1} title="當前市場正在幹甚麼？">
            <Chips options={STATES} value={t.q1.state} onChange={(v) => set('q1', { state: v })} />
            <input value={t.q1.note} onChange={(e) => set('q1', { note: e.target.value })} placeholder="補充：量價、消息、資金流向…" className={`${inp} w-full mt-2`} />
          </Q>

          <Q n={2} title="趨勢的起點在哪裡？">
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
          </Q>

          <Q n={3} title="當前趨勢是甚麼？">
            <Chips options={TRENDS} value={t.q3.trend} onChange={(v) => set('q3', { trend: v })} />
            {ref && <Ref>參考｜日線：{ref.trend}（現價 {fmt(ref.last, ref.decimals)}、MA20 {fmt(ref.ma20, ref.decimals)}、MA60 {fmt(ref.ma60, ref.decimals)}）</Ref>}
          </Q>

          <Q n={4} title="當前趨勢的級別是甚麼？">
            <Chips options={LEVELS} value={t.q4.level} onChange={(v) => set('q4', { level: v })} />
          </Q>

          <Q n={5} title="你的偏見是甚麼？">
            <Chips options={BIASES} value={t.q5.bias} onChange={(v) => set('q5', { bias: v })} colors={{ 偏多: 'var(--up)', 偏空: 'var(--down)' }} />
            <input value={t.q5.note} onChange={(e) => set('q5', { note: e.target.value })} placeholder="偏見的理由，以及它可能錯在哪" className={`${inp} w-full mt-2`} />
          </Q>

          <Q n={6} title="你是順哪個大、逆哪個小？">
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
          </Q>

          <Q n={7} title="你的防守位在哪？">
            <div className="flex flex-wrap gap-2">
              {[['entry', '預計進場價'], ['stop', '防守位（停損）'], ['target', '目標位（選填）']].map(([k, l]) => (
                <label key={k} className="text-[12px] text-muted flex items-center gap-1">{l}
                  <input type="number" inputMode="decimal" value={t.q7[k]} onChange={(e) => set('q7', { [k]: e.target.value })} className={`${inp} w-32 num`} /></label>
              ))}
              {ref && !t.q7.entry && <button className="text-[12px] text-s1" onClick={() => set('q7', { entry: String(+ref.last.toFixed(ref.decimals)) })}>以現價帶入進場價</button>}
            </div>
            <input value={t.q7.note} onChange={(e) => set('q7', { note: e.target.value })} placeholder="防守位的依據：前低、均線、結構破壞點…" className={`${inp} w-full mt-2`} />
            {ref && <Ref>參考｜近 20 日低點 {fmt(ref.e20.lo[1], ref.decimals)}、高點 {fmt(ref.e20.hi[1], ref.decimals)}</Ref>}
          </Q>

          <Q n={8} title="要不要到交易週期裡面去？">
            <Chips options={DECISIONS} value={t.q8.decision} onChange={(v) => set('q8', { decision: v })}
              colors={{ 進場: 'var(--color-s1)', 放棄: 'var(--color-muted)' }} />
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className="text-[12px] text-muted">交易週期</span>
              <Chips options={CYCLES} value={t.q8.cycle} onChange={(v) => set('q8', { cycle: v })} />
            </div>
            <input value={t.q8.note} onChange={(e) => set('q8', { note: e.target.value })}
              placeholder={t.q8.decision === '等待（設條件觀察）' ? '等待什麼條件出現才進場？' : '決策理由'} className={`${inp} w-full mt-2`} />
          </Q>

          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <button onClick={submit} className="px-4 py-2 rounded-lg bg-s1 text-white text-sm font-medium">記錄這次檢查</button>
            <button onClick={() => { clearTradeDraft(); dirty.current = false; setT({ ...emptyTrade(), market: t.market }) }}
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
        <Summary t={t} />
      </div>

      <div className="xl:col-span-2">
        <Panel title={`歷史交易檢查紀錄（${shown.length}）`} right={
          <select value={filter} onChange={(e) => setFilter(e.target.value)} className={sel} aria-label="篩選市場">
            <option value="all">全部市場</option>
            {usedMarkets.map((k) => <option key={k} value={k}>{MARKETS.find(([x]) => x === k)?.[1] || k}</option>)}
          </select>}>
          {shown.length ? (
            <div className="space-y-2">
              {shown.map((x) => <TradeRow key={x.id} t={x} m={x.market !== 'other' ? metrics?.[x.market] : null}
                onDelete={() => confirm('刪除這筆紀錄？') && setList(deleteTrade(x.id))} />)}
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

const Ref = ({ children }) => <div className="text-[11px] text-muted mt-1 num">{children}</div>

function Summary({ t }) {
  const rows = [
    ['市場', marketName(t)], ['1 在幹嘛', t.q1.state], ['2 起點', [t.q2.date, t.q2.price].filter(Boolean).join(' @ ')],
    ['3 趨勢', t.q3.trend], ['4 級別', t.q4.level], ['5 偏見', t.q5.bias],
    ['6 順大逆小', t.q6.bigLevel && t.q6.smallLevel ? `順${t.q6.bigLevel}${t.q6.bigDir} 逆${t.q6.smallLevel}${t.q6.smallDir}` : ''],
    ['7 防守', [t.q7.entry && `進 ${t.q7.entry}`, t.q7.stop && `守 ${t.q7.stop}`, t.q7.target && `目標 ${t.q7.target}`].filter(Boolean).join('・')],
    ['8 決策', [t.q8.decision, t.q8.cycle].filter(Boolean).join('・')],
  ]
  return (
    <Panel title="一句話總覽">
      <dl className="text-[12px] grid grid-cols-[84px_1fr] gap-y-1">
        {rows.map(([k, v]) => <Fragment key={k}><dt className="text-muted">{k}</dt><dd className={v ? 'text-ink' : 'text-muted'}>{v || '—'}</dd></Fragment>)}
      </dl>
    </Panel>
  )
}

function TradeRow({ t, m, onDelete }) {
  const [open, setOpen] = useState(false)
  const f = followUp(t, m)
  const created = new Date(t.created_at).toLocaleString('zh-TW', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  return (
    <div className="rounded-lg bg-surface2 p-2">
      <button className="w-full text-left flex flex-wrap items-center gap-x-3 gap-y-1" onClick={() => setOpen((o) => !o)}>
        <span className="num text-[12px] text-muted">{created}</span>
        <span className="text-[13px] text-ink font-medium">{marketName(t)}</span>
        <span className={`text-[12px] ${t.q5.bias === '偏多' ? 'up' : t.q5.bias === '偏空' ? 'down' : 'text-ink2'}`}>{t.q5.bias || '—'}</span>
        <span className="text-[12px] text-ink2">{t.q8.decision || '未決定'}{t.q8.cycle ? `・${t.q8.cycle}` : ''}</span>
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
          <p>1. 在幹嘛：{t.q1.state || '—'}{t.q1.note && `｜${t.q1.note}`}</p>
          <p>2. 起點：{[t.q2.date, t.q2.price].filter(Boolean).join(' @ ') || '—'}{t.q2.note && `｜${t.q2.note}`}</p>
          <p>3. 趨勢：{t.q3.trend || '—'}　4. 級別：{t.q4.level || '—'}{t.ref && <span className="text-muted">（當時系統日線判斷：{t.ref.trend}）</span>}</p>
          <p>5. 偏見：{t.q5.bias || '—'}{t.q5.note && `｜${t.q5.note}`}</p>
          <p>6. 順「{t.q6.bigLevel}{t.q6.bigDir}」逆「{t.q6.smallLevel}{t.q6.smallDir}」</p>
          <p>7. 進場 {t.q7.entry || '—'}・防守 {t.q7.stop || '—'}・目標 {t.q7.target || '—'}{t.q7.note && `｜${t.q7.note}`}</p>
          <p>8. {t.q8.decision || '—'}・{t.q8.cycle || '—'}{t.q8.note && `｜${t.q8.note}`}</p>
          {f && <p className="text-muted num">追蹤：基準 {fmt(f.e, 2)} → 最新 {fmt(f.last, 2)}（{f.lastDate}，{f.days} 個收盤）。防守／目標以日收盤價判斷。</p>}
          <button onClick={onDelete} className="text-critical text-[11px]">刪除</button>
        </div>
      )}
    </div>
  )
}
