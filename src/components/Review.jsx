import { useMemo, useState } from 'react'
import { Panel } from './bits'
import { loadEntries } from '../lib/journal'
import { flatten, stats, summaryText, aiPrompt, ASSETS, DIRS, CONF, fmtMove } from '../lib/review'

const PERIODS = [[7, '近 7 天'], [30, '近 30 天'], [90, '近 90 天'], [0, '全部']]
const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`)

export default function Review({ metrics, index }) {
  const [days, setDays] = useState(30)
  const [copied, setCopied] = useState('')
  const [manual, setManual] = useState('')
  const all = useMemo(loadEntries, [])
  const label = PERIODS.find(([d]) => d === days)[1]
  const entries = useMemo(() => {
    if (!days) return all
    const cut = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)
    return Object.fromEntries(Object.entries(all).filter(([d]) => d >= cut))
  }, [all, days])
  const rows = useMemo(() => flatten(entries, metrics, index), [entries, metrics, index])
  const st = useMemo(() => stats(rows, entries, metrics), [rows, entries, metrics])
  const summary = useMemo(() => summaryText(st, label), [st, label])

  const copyAI = async () => {
    const text = aiPrompt(rows, st, label)
    try { await navigator.clipboard.writeText(text); setCopied('已複製，貼到 Claude 對話即可') } catch {
      setCopied('瀏覽器不允許自動複製，請改用下方文字框手動複製')
      setManual(text)
    }
  }

  return (
    <div className="space-y-3">
      <Panel title="推敲日誌：統整・驗證・總結" right={
        <div className="flex gap-1">
          {PERIODS.map(([d, l]) => (
            <button key={d} onClick={() => setDays(d)}
              className={`text-[11px] px-2 py-0.5 rounded whitespace-nowrap ${days === d ? 'bg-s1 text-white' : 'bg-surface2 text-ink2'}`}>{l}</button>
          ))}
        </div>}>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
          <Kpi label="作答天數" v={st.days} />
          <Kpi label="連續作答" v={`${st.streak} 天`} />
          <Kpi label="作答題數" v={`${st.answered}/${st.total}`} />
          <Kpi label="預判數" v={st.preds} sub={st.pending ? `${st.pending} 個未到期` : ''} />
          <Kpi label="已驗證" v={st.overall.n} sub={`命中 ${st.overall.hit}`} />
          <Kpi label="命中率" v={pct(st.overall.pct)} big
            c={st.overall.pct == null ? undefined : st.overall.pct >= 0.55 ? 'var(--color-good)' : st.overall.pct < 0.45 ? 'var(--color-critical)' : 'var(--color-warning)'} />
        </div>
        <div className="mt-3 p-3 rounded-lg bg-surface2 text-[13px] text-ink space-y-1.5 leading-relaxed">
          {summary.map((l, i) => <p key={i}>{i === 0 ? '📋 ' : '• '}{l}</p>)}
        </div>
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          <button onClick={copyAI} className="px-3 py-1.5 rounded-lg bg-s1 text-white text-sm">複製給 AI 做深度總結</button>
          <span className="text-[11px] text-muted">{copied || '會複製本期所有題目、回答、預判與驗證結果，附分析指令'}</span>
        </div>
        {manual && <textarea readOnly value={manual} rows={6} className="mt-2 w-full bg-bg border border-line rounded-lg p-2 text-[11px] num" onFocus={(e) => e.target.select()} />}
        <p className="text-[10px] text-muted mt-2">
          驗證規則：作答日收盤 → N 個交易日後收盤（加密以日曆日計）。預判 ↑／↓ 需移動超過 0.25σ 才算命中或落空，波動太小不計；
          預判「盤整」為移動小於 0.5σ。σ = 作答前 60 日的日波動 × √N。利率類 ↑ 代表殖利率上升。
        </p>
      </Panel>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Group title="按資產" data={st.byAsset} />
        <Group title="按題型" data={st.byType} />
        <Group title="按預判期間" data={st.byH} />
        <Group title="按信心（校準）" data={st.byConf} note="理想狀態：信心越高，命中率越高" />
        <Group title="事件日 vs 一般日" data={st.byEvent} note="事件日 = CPI / NFP / ISM / FOMC" />
        <Group title="按方向" data={st.byDir} note="檢查是否有偏多或偏空的慣性" />
        <Group title={`每日總結驗證（5 日）・已寫 ${st.summaries} 天`} data={st.sumCalls.by}
          note={`整體方向以美股驗證；看好／看壞以各資產驗證。${st.sumCalls.pending ? `另有 ${st.sumCalls.pending} 個未到期。` : ''}`} />
      </div>

      <SysVsYou sv={st.svy} />

      <div className="grid gap-3 xl:grid-cols-3">
        <Panel title="你最常用的解釋框架">
          {st.drivers.length ? (
            <ul className="space-y-1">
              {st.drivers.map((d) => (
                <li key={d.k} className="flex items-center gap-2 text-[12px]">
                  <span className="w-24 text-ink2 shrink-0">{d.k}</span>
                  <span className="h-2 rounded bg-s1" style={{ width: `${(d.n / st.drivers[0].n) * 100}%`, minWidth: 4 }} />
                  <span className="num text-muted">{d.n}</span>
                </li>
              ))}
            </ul>
          ) : <Empty>作答累積後，這裡會統計你回答中提到的驅動因子</Empty>}
          <p className="text-[10px] text-muted mt-2">以關鍵字統計回答內容；若長期只用一兩種框架，容易忽略其他驅動因子。</p>
        </Panel>
        <Panel title="偏差最大的預判（優先檢討）">
          {st.misses.length ? (
            <ul className="space-y-1.5">
              {st.misses.slice(0, 8).map((r, k) => (
                <li key={k} className="text-[12px]">
                  <a href={`#/journal?d=${r.date}`} className="text-s1 num">{r.date}</a>
                  <span className="text-ink2"> Q{r.i + 1} 預判 {ASSETS[r.pred.asset]?.name} {DIRS[r.pred.dir]}（{r.pred.h}日・信心{CONF[r.pred.conf || 2]}）</span>
                  <span className="text-critical num"> 實際 {fmtMove(r.o)}（{r.o.z.toFixed(1)}σ）</span>
                </li>
              ))}
            </ul>
          ) : <Empty>目前沒有落空的預判</Empty>}
        </Panel>
        <Panel title="自評與待檢討">
          <div className="grid grid-cols-3 gap-1 mb-2">
            <Kpi label="邏輯正確" v={st.grades.logic_ok} />
            <Kpi label="方向對時機錯" v={st.grades.timing} />
            <Kpi label="邏輯錯誤" v={st.grades.logic_bad} />
          </div>
          {st.unreviewed.length ? (
            <div className="text-[12px] text-ink2">還沒寫檢討：{st.unreviewed.slice(-10).reverse().map((d) => (
              <a key={d} href={`#/journal?d=${d}`} className="text-s1 num mr-2">{d}</a>))}</div>
          ) : <Empty>有預判的日子都已檢討 👍</Empty>}
        </Panel>
      </div>
    </div>
  )
}

function Kpi({ label, v, sub, c, big }) {
  return (
    <div className="bg-surface2 rounded-lg px-3 py-2">
      <div className="text-[11px] text-muted">{label}</div>
      <div className={`num ${big ? 'text-2xl' : 'text-lg'} text-ink`} style={c ? { color: c } : undefined}>{v}</div>
      {sub && <div className="text-[10px] text-muted">{sub}</div>}
    </div>
  )
}

function Group({ title, data, note }) {
  return (
    <Panel title={title}>
      {data.length ? (
        <ul className="space-y-1.5">
          {data.map((g) => (
            <li key={g.k} className="text-[12px]">
              <div className="flex justify-between">
                <span className="text-ink2">{g.k}</span>
                <span className="num text-ink">{g.n ? `${g.hit}/${g.n}　${pct(g.pct)}` : '未到期'}{g.n > 0 && g.n < 3 && <span className="text-muted">（樣本少）</span>}</span>
              </div>
              <div className="h-1.5 rounded bg-bg mt-0.5 overflow-hidden">
                {g.pct != null && <div className="h-full rounded" style={{ width: `${g.pct * 100}%`, background: g.pct >= 0.55 ? 'var(--color-good)' : g.pct < 0.45 ? 'var(--color-critical)' : 'var(--color-warning)' }} />}
              </div>
            </li>
          ))}
        </ul>
      ) : <Empty>尚無預判紀錄</Empty>}
      {note && <p className="text-[10px] text-muted mt-2">{note}</p>}
    </Panel>
  )
}

function SysVsYou({ sv }) {
  if (!sv) return null
  const p = (x) => (x?.n ? x.hit / x.n : null)
  const row = (label, a) => (
    <div className="grid grid-cols-[110px_1fr_1fr] gap-2 items-center text-[12px] py-1 border-b border-line last:border-0">
      <span className="text-ink2">{label}{a.days ? <span className="text-muted">（{a.days} 期）</span> : null}</span>
      <Bar label="系統" x={a.sys} />
      <Bar label="你" x={a.you} />
    </div>
  )
  const AG = { agree: '你同意時', partial: '部分同意時', disagree: '你不同意時', none: '未表態' }
  return (
    <Panel title="系統 vs 你（新制：3 個交易日一期）">
      {sv.sys.n + sv.you.n === 0 ? <Empty>新制作答並到期後，這裡會比較系統的「資金動向評估」與你的判斷誰比較準。</Empty> : (
        <>
          {row('全部', sv)}
          {Object.entries(sv.byAgree).map(([k, a]) => <div key={k}>{row(AG[k] || k, a)}</div>)}
          <p className="text-[10px] text-muted mt-2">系統判斷 = 評估中的「下一期傾向」（動能規則）；你的判斷 = 總結的方向／看好看壞 + 各題預判。重點看「你不同意時」：若你較準，代表你看到了規則看不到的東西。</p>
        </>
      )}
    </Panel>
  )
  function Bar({ label, x }) {
    const v = p(x)
    return (
      <div className="flex items-center gap-2">
        <span className="w-8 text-muted">{label}</span>
        <div className="flex-1 h-1.5 bg-bg rounded overflow-hidden">{v != null && <div className="h-full rounded" style={{ width: `${v * 100}%`, background: v >= 0.55 ? 'var(--color-good)' : v < 0.45 ? 'var(--color-critical)' : 'var(--color-warning)' }} />}</div>
        <span className="num w-16 text-right">{v == null ? '—' : `${Math.round(v * 100)}% ${x.hit}/${x.n}`}</span>
      </div>
    )
  }
}

const Empty = ({ children }) => <p className="text-[12px] text-muted">{children}</p>
