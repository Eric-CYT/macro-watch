import { useEffect, useMemo, useRef, useState } from 'react'
import { Panel } from './bits'
import AssessmentCard from './Assessment'
import { PredictionPicker, OutcomeBadge } from './Prediction'
import { SummaryBox, emptySummary } from './Summary'
import { loadEntries, upsertEntry, feedback, loadSync, syncGithub, loadDraft, saveDraft, clearDraft } from '../lib/journal'
import { outcome, fmtMove, ASSETS } from '../lib/review'

const LAYER = ['① 發生了什麼', '② 誰在推、錢從哪來', '③ 下一站與驗證']

/** 新制：每 3 個交易日一期，2 個焦點市場 × 3 層提問 + 總結（含對系統評估的表態） */
export default function ReflectionV2({ q, metrics, onSaved, className = '' }) {
  const markets = q.markets || {}
  const keys = Object.keys(markets)
  const [focus, setFocus] = useState(q.focus || keys.slice(0, 2))
  const [answers, setAnswers] = useState(['', '', '', '', '', ''])
  const [preds, setPreds] = useState([null, null, null, null, null, null])
  const [summary, setSummary] = useState(() => emptySummary(3))
  const [fb, setFb] = useState(null)
  const [sync, setSync] = useState('')
  const [draftAt, setDraftAt] = useState(null)
  const [showA, setShowA] = useState(true)
  const dirty = useRef(false)
  const loaded = useRef(null)

  useEffect(() => {
    if (loaded.current === q.date) return
    loaded.current = q.date
    const e = loadEntries()[q.date]
    const d = loadDraft(q.date)
    const useDraft = d && (!e?.updated_at || d.saved_at > e.updated_at)
    const src = useDraft ? d : e
    if (src?.focus?.length === 2) setFocus(src.focus)
    setAnswers(Array.from({ length: 6 }, (_, i) => src?.answers?.[i] || ''))
    setPreds(Array.from({ length: 6 }, (_, i) => src?.predictions?.[i] || null))
    setSummary({ ...emptySummary(3), ...(src?.summary || {}), h: 3 })
    setDraftAt(useDraft ? d.saved_at : null)
    setFb(e?.answers && !useDraft ? { msgs: feedback(e.answers, e.summary), saved: true } : null)
  }, [q.date]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!dirty.current) return
    const t = setTimeout(() => setDraftAt(saveDraft(q.date, { focus, answers, predictions: preds, summary })), 600)
    return () => clearTimeout(t)
  }, [focus, answers, preds, summary]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const f = () => { if (dirty.current) saveDraft(q.date, { focus, answers, predictions: preds, summary }) }
    addEventListener('pagehide', f); document.addEventListener('visibilitychange', f)
    return () => { removeEventListener('pagehide', f); document.removeEventListener('visibilitychange', f) }
  }, [q.date, focus, answers, preds, summary])

  const questions = focus.flatMap((k) => markets[k]?.questions || [])

  const changeFocus = (slot, k) => {
    const has = answers.slice(slot * 3, slot * 3 + 3).some((a) => a.trim())
    if (has && !confirm('更換市場會清空這個市場已寫的 3 題回答，確定嗎？')) return
    dirty.current = true
    setFocus((f) => f.map((x, i) => (i === slot ? k : x)))
    setAnswers((a) => a.map((v, i) => (Math.floor(i / 3) === slot ? '' : v)))
    setPreds((p) => p.map((v, i) => (Math.floor(i / 3) === slot ? null : v)))
  }

  const submit = async () => {
    const A = q.assessment || {}
    upsertEntry(q.date, {
      version: 2, cycle: q.cycle, focus, questions: questions.map((x) => x.text), hints: questions.map((x) => x.hint),
      answers, predictions: preds, summary: { ...summary, h: 3 }, types: questions.map(() => 'focus'),
      assets: questions.map((x) => x.assets || []), snapshot: q.snapshot, events: q.events, engine: q.engine,
      system: { regime: A.regime, regime_txt: A.regime_txt, liquidity: A.liquidity, calls: A.calls || [], text: A.text || [] },
    })
    setFb({ msgs: feedback(answers, summary), saved: true })
    clearDraft(q.date); dirty.current = false; setDraftAt(null)
    onSaved?.()
    const s = loadSync()
    if (s?.token) {
      setSync('同步中…')
      try { await syncGithub(s); setSync('已同步到 GitHub ✓') } catch (e) { setSync(`同步失敗：${e.message}`) }
    }
  }

  return (
    <Panel className={className}
      title={<>本期推敲 <span className="text-muted font-normal">· {q.cycle?.from?.slice(5)}→{q.cycle?.to?.slice(5)}（{q.cycle?.n || 3} 個交易日一期）{q.events?.length ? ` · ${q.events.join('/')}` : ''}</span></>}
      right={<button onClick={() => setShowA((x) => !x)} className="text-[11px] text-s1">{showA ? '收合系統評估' : '展開系統評估'}</button>}>
      <PrevReview date={q.date} metrics={metrics} />
      {showA && <div className="mb-3"><AssessmentCard a={q.assessment} /></div>}

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-[12px] text-ink2">本期焦點市場（系統依變化幅度選出，可更換）</span>
        {[0, 1].map((slot) => (
          <select key={slot} value={focus[slot]} onChange={(e) => changeFocus(slot, e.target.value)} aria-label={`焦點市場 ${slot + 1}`}
            className="text-[12px] bg-bg border border-line rounded-lg px-2 py-1 text-ink">
            {keys.map((k) => (
              <option key={k} value={k} disabled={focus[1 - slot] === k}>
                {markets[k].name}（{markets[k].stats.z3 > 0 ? '+' : ''}{markets[k].stats.z3.toFixed(1)}σ・{markets[k].stats.label}）
              </option>
            ))}
          </select>
        ))}
      </div>

      <ol className="space-y-3">
        {questions.map((x, i) => (
          <li key={`${focus[Math.floor(i / 3)]}-${i}`}>
            {i % 3 === 0 && (
              <div className={`text-[12px] font-semibold mb-1 ${i ? 'mt-4 pt-3 border-t border-line' : ''} ${i ? 'text-s2' : 'text-s1'}`}>
                ▍焦點市場 {i / 3 + 1}：{markets[focus[i / 3]]?.name}
              </div>
            )}
            <p className="text-[13px] leading-relaxed text-ink">
              <span className={`font-semibold mr-1 ${i < 3 ? 'text-s1' : 'text-s2'}`}>Q{i + 1}</span>
              <span className="text-muted mr-1">{LAYER[i % 3]}</span>{x.text.replace(/^【[^】]*】/, '')}
            </p>
            <textarea value={answers[i] || ''} rows={3}
              onChange={(e) => { dirty.current = true; setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v))) }}
              placeholder={i % 3 === 2 ? '下一站是…；我預期下一期…；如果…出現代表我錯了' : '你的推敲：因為…所以…'}
              className="mt-1 w-full bg-bg border border-line rounded-lg p-2 text-[13px] text-ink placeholder:text-muted focus:outline-none focus:border-s1" />
            {i % 3 === 2 && (
              <PredictionPicker value={preds[i]} suggest={x.assets || []} defaultH={3}
                onChange={(v) => { dirty.current = true; setPreds((a) => a.map((p, j) => (j === i ? v : p))) }} />
            )}
            {fb && x.hint && <p className="text-[12px] text-ink2 mt-1 pl-2 border-l-2 border-s3">💡 {x.hint}</p>}
          </li>
        ))}
      </ol>

      <div className="mt-4 pt-3 border-t border-line">
        <div className="text-[12px] font-semibold mb-1 text-warning">▍總結：下一期的資金方向與策略</div>
        <SummaryBox value={summary} showAgree onChange={(v) => { dirty.current = true; setSummary({ ...v, h: 3 }) }} />
      </div>

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <button onClick={submit} className="px-3 py-1.5 rounded-lg bg-s1 text-white text-sm font-medium hover:brightness-110">
          {fb?.saved ? '更新紀錄' : '提交'}</button>
        <span className="text-[11px] text-muted">{sync}</span>
        {draftAt && <span className="text-[11px] text-warning">● 草稿已自動儲存 {new Date(draftAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })}・寫完記得按提交</span>}
        <a href="#/review" className="ml-auto text-[11px] text-s1">統整驗證 →</a>
      </div>
      {fb && (
        <div className="mt-2 p-2 rounded-lg bg-surface2 text-[12px] text-ink2 space-y-1">
          {fb.msgs.map((m, i) => <p key={i}>{i === 0 ? '👏 ' : '• '}{m}</p>)}
        </div>
      )}
    </Panel>
  )
}

/** 上一期回顧：你和系統的判斷，結果如何 */
function PrevReview({ date, metrics }) {
  const prev = useMemo(() => {
    const all = loadEntries()
    const d = Object.keys(all).filter((x) => x < date && !all[x].deleted && (all[x].summary || all[x].predictions?.some(Boolean))).sort().at(-1)
    return d ? { d, e: all[d] } : null
  }, [date])
  if (!prev) return null
  const { d, e } = prev
  const sm = e.summary || {}
  const h = sm.h || 5
  const calls = [
    ...(sm.bias ? [{ who: '你', label: `整體${{ bull: '偏多', bear: '偏空', neutral: '中性' }[sm.bias]}（美股）`, p: { asset: 'spx', dir: sm.bias === 'bull' ? 'up' : sm.bias === 'bear' ? 'down' : 'flat', h } }] : []),
    ...(sm.long || []).map((k) => ({ who: '你', label: `看好 ${ASSETS[k]?.name}`, p: { asset: k, dir: 'up', h } })),
    ...(sm.short || []).map((k) => ({ who: '你', label: `看壞 ${ASSETS[k]?.name}`, p: { asset: k, dir: 'down', h } })),
    ...((e.system?.calls) || []).map((c) => ({ who: '系統', label: `${ASSETS[c.asset]?.name} ${c.asset === 'us10y' ? (c.dir === 'up' ? '殖利率↑' : '殖利率↓') : (c.dir === 'up' ? '↑' : '↓')}`, p: { ...c, h: 3 } })),
  ].map((c) => ({ ...c, o: outcome(metrics, c.p, d) }))
  const done = (who) => calls.filter((c) => c.who === who && c.o && !c.o.pending && c.o.hit !== null)
  const score = (who) => { const x = done(who); return x.length ? `${x.filter((c) => c.o.hit).length}/${x.length}` : '—' }
  return (
    <details className="mb-3 rounded-lg border border-line bg-bg p-2" open>
      <summary className="text-[12px] text-ink cursor-pointer">上一期（{d}）回顧：你 {score('你')}　系統 {score('系統')}
        <span className="text-muted">（已到期且移動夠大的判斷才計分）</span></summary>
      <div className="mt-2 grid sm:grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
        {calls.map((c, i) => (
          <div key={i} className="flex justify-between gap-2">
            <span className="text-ink2"><span className={c.who === '你' ? 'text-s1' : 'text-s2'}>{c.who}</span>・{c.label}</span>
            <span className="num">{!c.o ? '—' : c.o.pending ? `⏳ 還差 ${c.o.left} 日` : c.o.hit === null ? `○ ${fmtMove(c.o)}` :
              <span style={{ color: c.o.hit ? 'var(--color-good)' : 'var(--color-critical)' }}>{c.o.hit ? '✓' : '✗'} {fmtMove(c.o)}</span>}</span>
          </div>
        ))}
        {e.predictions?.map((p, i) => p?.dir && <div key={`p${i}`} className="sm:col-span-2"><OutcomeBadge metrics={metrics} pred={p} date={d} /></div>)}
      </div>
      {sm.theme && <p className="text-[11px] text-muted mt-1">上一期你的主軸：{sm.theme}</p>}
    </details>
  )
}
