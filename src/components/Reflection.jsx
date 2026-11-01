import { useEffect, useState } from 'react'
import { Panel } from './bits'
import { loadEntries, upsertEntry, feedback, loadSync, syncGithub } from '../lib/journal'
import { PredictionPicker } from './Prediction'

export default function Reflection({ q, onSaved, className = '' }) {
  const [answers, setAnswers] = useState([])
  const [preds, setPreds] = useState([])
  const [fb, setFb] = useState(null)
  const [sync, setSync] = useState('')

  useEffect(() => {
    if (!q) return
    const e = loadEntries()[q.date]
    const n = q.questions.length
    setAnswers(Array.from({ length: n }, (_, i) => e?.answers?.[i] || ''))
    setPreds(Array.from({ length: n }, (_, i) => e?.predictions?.[i] || null))
    setFb(e?.answers ? { msgs: feedback(e.answers), saved: true } : null)
  }, [q])

  if (!q) return <Panel title="今日推敲" className={className}><div className="text-muted text-sm">尚未產生（每個美股交易日收盤後約 05:30 台北時間產生）</div></Panel>

  const submit = async () => {
    upsertEntry(q.date, {
      questions: q.questions.map((x) => x.text), hints: q.questions.map((x) => x.hint),
      answers, predictions: preds, assets: q.questions.map((x) => x.assets || []),
      types: q.questions.map((x) => x.type || 'market'),
      snapshot: q.snapshot, events: q.events, engine: q.engine,
    })
    setFb({ msgs: feedback(answers), saved: true })
    onSaved?.()
    const s = loadSync()
    if (s?.token) {
      setSync('同步中…')
      try { await syncGithub(s); setSync('已同步到 GitHub ✓') } catch (e) { setSync(`同步失敗：${e.message}`) }
    }
  }

  return (
    <Panel className={className} title={<>今日推敲 {q.questions.length} 問 <span className="text-muted font-normal">· {q.date}{q.events?.length ? ` · ${q.events.join('/')}` : ''}</span></>}
      right={<span className="text-[10px] text-muted">{q.engine === 'llm' ? 'LLM 生成' : '規則生成'}</span>}>
      <ol className="space-y-3">
        {q.questions.map((x, i) => (
          <li key={i}>
            {(i === 0 || (x.type === 'flow') !== (q.questions[i - 1].type === 'flow')) && (
              <div className={`text-[11px] font-semibold tracking-wide mb-1 ${i ? 'mt-4 pt-3 border-t border-line' : ''} ${x.type === 'flow' ? 'text-s2' : 'text-s1'}`}>
                {x.type === 'flow' ? '▍資金流向推敲（對照上方資金流向圖）' : '▍市場推敲'}
              </div>
            )}
            <p className="text-[13px] leading-relaxed text-ink"><span className={`font-semibold mr-1 ${x.type === 'flow' ? 'text-s2' : 'text-s1'}`}>Q{i + 1}</span>{x.text}</p>
            <textarea
              value={answers[i] || ''}
              onChange={(e) => setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))}
              rows={3}
              placeholder="你的推敲：因為…所以…；什麼情況代表我錯了？"
              className="mt-1 w-full bg-bg border border-line rounded-lg p-2 text-[13px] text-ink placeholder:text-muted focus:outline-none focus:border-s1"
            />
            <PredictionPicker value={preds[i]} suggest={(x.assets || []).filter(Boolean)}
              onChange={(v) => setPreds((a) => a.map((p, j) => (j === i ? v : p)))} />
            {fb && x.hint && <p className="text-[12px] text-ink2 mt-1 pl-2 border-l-2 border-s3">💡 {x.hint}</p>}
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-2 mt-2">
        <button onClick={submit} className="px-3 py-1.5 rounded-lg bg-s1 text-white text-sm font-medium hover:brightness-110">
          {fb?.saved ? '更新紀錄' : '提交'}
        </button>
        <span className="text-[11px] text-muted">{sync}</span>
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
