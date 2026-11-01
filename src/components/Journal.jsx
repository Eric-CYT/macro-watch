import { useEffect, useMemo, useState } from 'react'
import { Panel } from './bits'
import { getJSON, fmt } from '../lib/util'
import { loadEntries, upsertEntry, exportJSON, importJSON, loadSync, saveSync, syncGithub } from '../lib/journal'

const SNAP_NAMES = { vix: 'VIX', dxy: 'DXY', us10y: 'US10Y', us02y: 'US02Y', spread: '10Y-2Y', hy: 'HY OAS',
  usdjpy: 'USD/JPY', usdtwd: 'USD/TWD', btc: 'BTC', taiex: 'TAIEX', spx: 'S&P500', sox: 'SOX', gold: '黃金', wti: 'WTI', copper: '銅' }

const ymd = (d) => d.toISOString().slice(0, 10)

export default function Journal({ index, initialDate }) {
  const [entries, setEntries] = useState(loadEntries)
  const start = initialDate || index?.at(-1)?.d || null
  const [month, setMonth] = useState(() => (start || ymd(new Date())).slice(0, 7))
  const [sel, setSel] = useState(start)
  const [qfile, setQfile] = useState(null)
  const [mode, setMode] = useState('cal')
  const [search, setSearch] = useState('')
  const [edit, setEdit] = useState(null)

  const qmap = useMemo(() => new Map((index || []).map((x) => [x.d, x.ev])), [index])

  useEffect(() => {
    setEdit(null)
    if (!sel || !qmap.has(sel)) { setQfile(null); return }
    getJSON(`data/questions/${sel}.json`).then(setQfile).catch(() => setQfile(null))
  }, [sel, qmap])

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
  const questions = e?.questions || qfile?.questions?.map((x) => x.text) || []
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
            <p className="text-[13px] text-ink"><span className="text-s1 font-semibold mr-1">Q{i + 1}</span>{qt}</p>
            {edit ? (
              <textarea value={edit[i] || ''} rows={3} onChange={(ev) => setEdit((a) => a.map((v, j) => (j === i ? ev.target.value : v)))}
                className="mt-1 w-full bg-bg border border-line rounded-lg p-2 text-[13px]" />
            ) : (
              <p className="mt-1 text-[13px] text-ink2 whitespace-pre-wrap pl-2 border-l-2 border-line">{e?.answers?.[i] || '（未作答）'}</p>
            )}
          </div>
        ))}
        {questions.length > 0 && (
          <div className="flex gap-2">
            {edit ? (
              <>
                <button className="px-3 py-1 rounded bg-s1 text-white text-sm" onClick={() => {
                  setEntries(upsertEntry(sel, { answers: edit, questions, snapshot, events,
                    hints: e?.hints || qfile?.questions?.map((x) => x.hint) }))
                  setEdit(null)
                }}>儲存</button>
                <button className="px-3 py-1 rounded bg-surface2 text-sm" onClick={() => setEdit(null)}>取消</button>
              </>
            ) : (
              <button className="px-3 py-1 rounded bg-surface2 text-sm" onClick={() => setEdit(e?.answers || ['', '', ''])}>
                {e?.answers ? '編輯回答' : '補寫回答'}</button>
            )}
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
