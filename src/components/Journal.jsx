import { useEffect, useMemo, useState } from 'react'
import { Panel } from './bits'
import { getJSON, fmt } from '../lib/util'
import { loadEntries, upsertEntry, exportJSON, importJSON, loadSync, saveSync, syncGithub, loadDraft, saveDraft, clearDraft } from '../lib/journal'
import { PredictionPicker, OutcomeBadge, AfterMoves } from './Prediction'
import { SummaryBox, emptySummary } from './Summary'
import { groupOf, typeOf } from '../lib/groups'
import AssessmentCard from './Assessment'

const GRADES = [['logic_ok', '✓ 邏輯正確'], ['timing', '◐ 方向對、時機錯'], ['logic_bad', '✗ 邏輯錯誤']]

const SNAP_NAMES = { vix: 'VIX', dxy: 'DXY', us10y: 'US10Y', us02y: 'US02Y', spread: '10Y-2Y', hy: 'HY OAS',
  usdjpy: 'USD/JPY', usdtwd: 'USD/TWD', btc: 'BTC', taiex: 'TAIEX', spx: 'S&P500', sox: 'SOX', gold: '黃金', wti: 'WTI', copper: '銅' }

const ymd = (d) => d.toISOString().slice(0, 10)

export default function Journal({ index, initialDate, metrics }) {
  const [entries, setEntries] = useState(loadEntries)
  const start = initialDate || index?.at(-1)?.d || null
  const [month, setMonth] = useState(() => (start || ymd(new Date())).slice(0, 7))
  const [sel, setSel] = useState(start)
  const [qfile, setQfile] = useState(null)
  const [mode, setMode] = useState('cal')
  const [search, setSearch] = useState('')
  const [edit, setEdit] = useState(null)
  const [editPreds, setEditPreds] = useState([])
  const [editSummary, setEditSummary] = useState(emptySummary)
  const [review, setReview] = useState('')

  const qmap = useMemo(() => new Map((index || []).map((x) => [x.d, x.ev])), [index])
  // 網址帶的日期改變時（例如從統整頁點進來）跟著切換
  useEffect(() => { if (initialDate) { setSel(initialDate); setMonth(initialDate.slice(0, 7)) } }, [initialDate])

  const hasQ = !!sel && qmap.has(sel)
  // 只在切換日期時重設（每 5 分鐘的資料刷新不會清掉編輯中的內容）
  useEffect(() => {
    const d = sel ? loadDraft(`edit:${sel}`) : null
    if (d) { setEdit(d.answers); setEditPreds(d.predictions || []); setEditSummary({ ...emptySummary(), ...(d.summary || {}) }) } else setEdit(null)
    setReview(loadDraft(`review:${sel}`)?.review ?? (loadEntries()[sel]?.review || ''))
  }, [sel])
  useEffect(() => {
    if (!hasQ) { setQfile(null); return }
    getJSON(`data/questions/${sel}.json`).then(setQfile).catch(() => setQfile(null))
  }, [sel, hasQ])
  // 編輯中、檢討中自動存草稿
  useEffect(() => {
    if (!sel || !edit) return
    const t = setTimeout(() => saveDraft(`edit:${sel}`, { answers: edit, predictions: editPreds, summary: editSummary }), 600)
    return () => clearTimeout(t)
  }, [sel, edit, editPreds, editSummary])
  useEffect(() => {
    if (!sel) return
    const saved = loadEntries()[sel]?.review || ''
    const t = setTimeout(() => (review !== saved ? saveDraft(`review:${sel}`, { review }) : clearDraft(`review:${sel}`)), 600)
    return () => clearTimeout(t)
  }, [sel, review])

  const days = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const first = new Date(Date.UTC(y, m - 1, 1))
    const pad = (first.getUTCDay() + 6) % 7 // 週一開頭
    const n = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return [...Array(pad).fill(null), ...Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)]
  }, [month])

  const shift = (k) => {
    const [y, m] = month.split('-').map(Number)
    const d = new Date(Date.UTC(y, m - 1 + k, 1))
    setMonth(ymd(d).slice(0, 7))
  }

  const list = useMemo(() => {
    const all = new Set([...Object.keys(entries), ...qmap.keys()])
    return [...all].sort().reverse().filter((d) => {
      if (mode === 'event' && !(qmap.get(d)?.length || entries[d]?.events?.length)) return false
      if (search) {
        const e = entries[d]
        const text = [...(e?.answers || []), ...(e?.questions || [])].join(' ')
        if (!text.toLowerCase().includes(search.toLowerCase())) return false
      }
      return true
    })
  }, [entries, qmap, mode, search])

  const e = sel ? entries[sel] : null
  // 若當天題目檔後來補上了資金流向題，以題目檔為準（回答依序對應，不會遺失）
  const fileQs = qfile?.questions?.map((x) => x.text) || []
  const questions = fileQs.length > (e?.questions?.length || 0) ? fileQs : (e?.questions || fileQs)
  const qTypes = qfile?.questions?.map((x) => x.type) || []
  const qAssets = (i) => e?.assets?.[i] || qfile?.questions?.[i]?.assets || []
  const isV2 = e?.version === 2 || qfile?.version === 2
  const v2Focus = e?.focus || qfile?.focus || []
  const v2Names = v2Focus.map((k) => qfile?.markets?.[k]?.name || k)
  const snapshot = e?.snapshot || qfile?.snapshot
  const events = qmap.get(sel) || e?.events || []

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(320px,420px)_1fr] gap-3">
      <div className="space-y-3">
        <Panel title="歷史推敲日誌" right={
          <div className="flex gap-1">
            {[['cal', '日曆'], ['list', '清單'], ['event', '事件日']].map(([k, l]) => (
              <button key={k} onClick={() => setMode(k)}
                className={`text-[11px] px-2 py-0.5 rounded ${mode === k ? 'bg-s1 text-white' : 'bg-surface2 text-ink2'}`}>{l}</button>
            ))}
          </div>}>
          {mode === 'cal' ? (
            <>
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => shift(-1)} className="px-2 text-ink2 hover:text-ink" aria-label="上個月">‹</button>
                <span className="num text-ink">{month}</span>
                <button onClick={() => shift(1)} className="px-2 text-ink2 hover:text-ink" aria-label="下個月">›</button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted mb-1">
                {['一', '二', '三', '四', '五', '六', '日'].map((d) => <div key={d}>{d}</div>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {days.map((d, i) => {
                  if (!d) return <div key={i} />
                  const ans = entries[d]?.answers?.some((a) => a?.trim())
                  const hasQ = qmap.has(d)
                  const ev = qmap.get(d) || []
                  return (
                    <button key={d} onClick={() => setSel(d)}
                      className={`aspect-square rounded-md text-[12px] flex flex-col items-center justify-center border
                        ${sel === d ? 'border-s1 bg-surface2' : 'border-transparent hover:bg-surface2'}
                        ${hasQ || ans ? 'text-ink' : 'text-muted'}`}>
                      <span className="num">{Number(d.slice(8))}</span>
                      <span className="flex gap-0.5 h-1.5 mt-0.5">
                        {ans && <span className="w-1.5 h-1.5 rounded-full bg-s1" title="已作答" />}
                        {hasQ && !ans && <span className="w-1.5 h-1.5 rounded-full border border-ink2" title="有提問未作答" />}
                        {ev.length > 0 && <span className="w-1.5 h-1.5 rounded-sm bg-s2" title={ev.join('/')} />}
                      </span>
                    </button>
                  )
                })}
              </div>
              <div className="flex gap-3 mt-2 text-[10px] text-muted">
                <span><span className="inline-block w-1.5 h-1.5 rounded-full bg-s1 mr-1" />已作答</span>
                <span><span className="inline-block w-1.5 h-1.5 rounded-full border border-ink2 mr-1" />未作答</span>
                <span><span className="inline-block w-1.5 h-1.5 rounded-sm bg-s2 mr-1" />事件日（CPI/NFP/ISM/FOMC）</span>
              </div>
            </>
          ) : (
            <>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜尋回答內容…"
                className="w-full mb-2 bg-bg border border-line rounded-lg px-2 py-1 text-[13px]" />
              <ul className="max-h-[55vh] overflow-y-auto scroll-thin">
                {list.map((d) => (
                  <li key={d}>
                    <button onClick={() => setSel(d)} className={`w-full text-left px-2 py-1.5 rounded-md text-[13px] hover:bg-surface2 ${sel === d ? 'bg-surface2' : ''}`}>
                      <span className="num">{d}</span>
                      {(qmap.get(d) || []).map((x) => <span key={x} className="ml-1 text-[10px] px-1 rounded bg-s2/30 text-ink">{x}</span>)}
                      <span className="block text-[11px] text-muted truncate">{entries[d]?.answers?.find((a) => a?.trim()) || '（未作答）'}</span>
                    </button>
                  </li>
                ))}
                {!list.length && <li className="text-muted text-sm p-2">沒有紀錄</li>}
              </ul>
            </>
          )}
        </Panel>
        <SyncPanel onSynced={setEntries} />
      </div>

      <Panel title={sel ? `${sel}${events.length ? ` · ${events.join(' / ')}` : ''}` : '選擇一天'}>
        {!sel && <p className="text-muted text-sm">點選日曆上的日期，回顧當天的宏觀數據、系統提問與你的推敲。</p>}
        {sel && !questions.length && <p className="text-muted text-sm">這天沒有提問紀錄。</p>}
        {isV2 && qfile?.assessment && (
          <details className="mb-3"><summary className="text-[12px] text-ink2 cursor-pointer">
            當期系統資金動向評估（{qfile.cycle?.from} → {qfile.cycle?.to}）</summary>
            <div className="mt-2"><AssessmentCard a={qfile.assessment} /></div></details>
        )}
        {snapshot && (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-1 mb-3">
            {Object.entries(snapshot).map(([k, s]) => (
              <div key={k} className="bg-surface2 rounded-md px-2 py-1">
                <div className="text-[10px] text-muted">{SNAP_NAMES[k] || k}</div>
                <div className="num text-[13px]">{fmt(s.v, k === 'btc' ? 0 : 2)}</div>
                {s.chg_1d != null && <div className={`num text-[10px] ${s.chg_1d > 0 ? 'up' : s.chg_1d < 0 ? 'down' : ''}`}>
                  {s.chg_1d > 0 ? '+' : ''}{s.chg_1d.toFixed(s.rate ? 1 : 2)}{s.rate ? 'bp' : '%'}</div>}
              </div>
            ))}
          </div>
        )}
        {questions.map((qt, i) => (
          <div key={i} className="mb-3">
            {isV2 && i % 3 === 0 && (
              <div className={`text-[11px] font-semibold mb-1 ${i ? 'mt-4 pt-3 border-t border-line' : ''} ${i ? 'text-s2' : 'text-s1'}`}>
                ▍焦點市場 {i / 3 + 1}：{v2Names[i / 3] || '—'}</div>
            )}
            {!isV2 && (i === 0 || typeOf(qTypes[i] || e?.types?.[i], i) !== typeOf(qTypes[i - 1] || e?.types?.[i - 1], i - 1)) && (
              <div className={`text-[11px] font-semibold mb-1 ${i ? 'mt-4 pt-3 border-t border-line' : ''} ${groupOf(qTypes[i] || e?.types?.[i], i).cls}`}>
                {groupOf(qTypes[i] || e?.types?.[i], i).label}</div>
            )}
            <p className="text-[13px] text-ink"><span className={`font-semibold mr-1 ${groupOf(qTypes[i] || e?.types?.[i], i).cls}`}>Q{i + 1}</span>{qt}</p>
            {edit ? (
              <textarea value={edit[i] || ''} rows={3} onChange={(ev) => setEdit((a) => a.map((v, j) => (j === i ? ev.target.value : v)))}
                className="mt-1 w-full bg-bg border border-line rounded-lg p-2 text-[13px]" />
            ) : (
              <p className="mt-1 text-[13px] text-ink2 whitespace-pre-wrap pl-2 border-l-2 border-line">{e?.answers?.[i] || '（未作答）'}</p>
            )}
            {edit ? (
              <PredictionPicker value={editPreds[i]} suggest={qAssets(i)} defaultH={isV2 ? 3 : 5}
                onChange={(v) => setEditPreds((a) => a.map((p, j) => (j === i ? v : p)))} />
            ) : e?.predictions?.[i]?.dir ? (
              <OutcomeBadge metrics={metrics} pred={e.predictions[i]} date={sel} />
            ) : (
              <AfterMoves metrics={metrics} assets={qAssets(i)} date={sel} />
            )}
          </div>
        ))}
        {questions.length > 0 && (edit || e?.summary) && (
          <div className="mt-4 pt-3 border-t border-line mb-3">
            <div className="text-[11px] font-semibold mb-1 text-warning">▍總結：接下來的策略與市場方向</div>
            {edit ? <SummaryBox value={editSummary} onChange={setEditSummary} showAgree={isV2} />
              : <SummaryBox value={e.summary} readOnly metrics={metrics} date={sel} />}
          </div>
        )}
        {questions.length > 0 && (
          <div className="flex gap-2 flex-wrap">
            {edit ? (
              <>
                <button className="px-3 py-1 rounded bg-s1 text-white text-sm" onClick={() => {
                  setEntries(upsertEntry(sel, { answers: edit, predictions: editPreds, summary: editSummary, questions, snapshot, events,
                    assets: questions.map((_, j) => qAssets(j)),
                    types: questions.map((_, j) => typeOf(qTypes[j] || e?.types?.[j], j)),
                    hints: e?.hints || qfile?.questions?.map((x) => x.hint) }))
                  clearDraft(`edit:${sel}`)
                  setEdit(null)
                }}>儲存</button>
                <button className="px-3 py-1 rounded bg-surface2 text-sm" onClick={() => { clearDraft(`edit:${sel}`); setEdit(null) }}>取消</button>
                <span className="text-[11px] text-warning self-center">● 編輯內容會自動暫存，按「儲存」才正式寫入</span>
              </>
            ) : (
              <button className="px-3 py-1 rounded bg-surface2 text-sm" onClick={() => {
                setEdit(Array.from({ length: questions.length }, (_, j) => e?.answers?.[j] || ''))
                setEditPreds(Array.from({ length: questions.length }, (_, j) => e?.predictions?.[j] || null))
                setEditSummary({ ...emptySummary(isV2 ? 3 : undefined), ...(e?.summary || {}) })
              }}>
                {e?.answers ? '編輯回答 / 預判 / 總結' : '補寫回答'}</button>
            )}
          </div>
        )}
        {e?.answers && !edit && (
          <div className="mt-4 pt-3 border-t border-line">
            <div className="text-[11px] font-semibold text-s3 mb-1">▍事後檢討（對照上方實際走勢）</div>
            <div className="flex flex-wrap gap-1 mb-1">
              {GRADES.map(([k, l]) => (
                <button key={k} onClick={() => setEntries(upsertEntry(sel, { grade: e.grade === k ? null : k }))}
                  className={`text-[11px] px-2 py-0.5 rounded border ${e.grade === k ? 'bg-s3 border-s3 text-white' : 'border-line text-ink2'}`}>{l}</button>
              ))}
            </div>
            <textarea value={review} onChange={(ev) => setReview(ev.target.value)} rows={2}
              placeholder="回頭看：哪個假設對了、哪個錯了？下次遇到類似情況要先看什麼？"
              className="w-full bg-bg border border-line rounded-lg p-2 text-[13px]" />
            <button className="mt-1 px-3 py-1 rounded bg-surface2 text-sm"
              onClick={() => { setEntries(upsertEntry(sel, { review })); clearDraft(`review:${sel}`) }}>儲存檢討</button>
            {e.review && e.review === review && <span className="text-[11px] text-good ml-2">已儲存</span>}
          </div>
        )}
        {qfile?.headlines?.length > 0 && (
          <div className="mt-4">
            <div className="text-[11px] text-muted mb-1">當日頭條</div>
            <ul className="text-[12px] text-ink2 space-y-1">
              {qfile.headlines.map((h, i) => <li key={i}>• <a className="hover:text-s1" href={h.url} target="_blank" rel="noreferrer">{h.title}</a></li>)}
            </ul>
          </div>
        )}
      </Panel>
    </div>
  )
}

function SyncPanel({ onSynced }) {
  const [cfg, setCfg] = useState(() => loadSync() || { owner: '', repo: 'macro-journal', token: '', path: 'journal.json' })
  const [msg, setMsg] = useState('')
  const on = !!loadSync()?.token
  const set = (k) => (e) => setCfg((c) => ({ ...c, [k]: e.target.value.trim() }))
  return (
    <Panel title="備份與跨裝置同步" right={<span className={`text-[11px] ${on ? 'text-good' : 'text-muted'}`}>{on ? '● 已啟用 GitHub 同步' : '○ 僅存於此裝置'}</span>}>
      <div className="flex gap-2 mb-3">
        <button onClick={exportJSON} className="px-2 py-1 rounded bg-surface2 text-[12px]">匯出 JSON</button>
        <label className="px-2 py-1 rounded bg-surface2 text-[12px] cursor-pointer">匯入 JSON
          <input type="file" accept="application/json" className="hidden"
            onChange={async (e) => { if (e.target.files[0]) { onSynced(await importJSON(e.target.files[0])); setMsg('已匯入並合併') } }} />
        </label>
      </div>
      <details className="text-[12px] text-ink2">
        <summary className="cursor-pointer text-ink">設定 GitHub 私人 repo 同步（免費，手機電腦共用）</summary>
        <p className="mt-2 text-muted">建立一個 <b>Private</b> repo（例如 macro-journal），再建立只授權該 repo「Contents: Read and write」的 Fine-grained token。Token 只存在這台裝置的瀏覽器。</p>
        <div className="grid grid-cols-2 gap-1 mt-2">
          <input placeholder="GitHub 帳號" value={cfg.owner} onChange={set('owner')} className="bg-bg border border-line rounded px-2 py-1" />
          <input placeholder="私人 repo 名稱" value={cfg.repo} onChange={set('repo')} className="bg-bg border border-line rounded px-2 py-1" />
          <input placeholder="Fine-grained token" type="password" value={cfg.token} onChange={set('token')} className="col-span-2 bg-bg border border-line rounded px-2 py-1" />
        </div>
        <div className="flex gap-2 mt-2">
          <button className="px-2 py-1 rounded bg-s1 text-white" onClick={async () => {
            saveSync(cfg); setMsg('同步中…')
            try { onSynced(await syncGithub(cfg)); setMsg('同步完成 ✓') } catch (e) { setMsg(e.message) }
          }}>儲存並同步</button>
          {on && <button className="px-2 py-1 rounded bg-surface2" onClick={() => { saveSync(null); setMsg('已停用同步（本機資料保留）') }}>停用</button>}
        </div>
      </details>
      {msg && <p className="text-[11px] text-ink2 mt-2">{msg}</p>}
    </Panel>
  )
}
