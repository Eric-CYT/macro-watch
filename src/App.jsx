import { useCallback, useEffect, useMemo, useState } from 'react'
import { Panel, MetricRow, StatusDot, CheckLine } from './components/bits'
import { Heatmap, BtcDxyChart, IntradayChart, HistoryChart, MacroChart, FlowChart } from './components/charts'
import News from './components/News'
import Reflection from './components/Reflection'
import { loadEntries } from './lib/journal'
import Journal from './components/Journal'
import Quality from './components/Quality'
import Guide from './components/Guide'
import { TwChips, NetLiq, Cftc } from './components/Flows'
import { FlowRadar } from './components/FlowRadar'
import Review from './components/Review'
import TradeCheck from './components/TradeCheck'
import Matrix from './components/Matrix'
import { computeAlerts, alertFor, LEVEL_C } from './lib/alerts'
import { getJSON, fmt, fmtChg, dirClass, twTime, timeAgo, STATUS } from './lib/util'

const TABS = [['macro', '宏觀'], ['market', '市場'], ['news', '新聞'], ['reflect', '反思']]

function useHash() {
  const [h, setH] = useState(location.hash || '#/')
  useEffect(() => {
    const f = () => setH(location.hash || '#/')
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  return h
}

export default function App() {
  const hash = useHash()
  const [market, setMarket] = useState(null)
  const [news, setNews] = useState(null)
  const [cfg, setCfg] = useState(null)
  const [qIndex, setQIndex] = useState([])
  const [today, setToday] = useState(null)
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('macro')
  const [pick, setPick] = useState(null)
  const [liveBtc, setLiveBtc] = useState(null)
  const [conv, setConv] = useState(() => localStorage.getItem('mdj.conv') || 'tw')

  useEffect(() => {
    document.documentElement.dataset.conv = conv
    localStorage.setItem('mdj.conv', conv)
  }, [conv])

  const load = useCallback(async () => {
    try {
      const [m, n, c, qi, dr] = await Promise.all([
        getJSON('data/market.json'), getJSON('data/news.json').catch(() => null),
        getJSON('data/config.json').catch(() => null), getJSON('data/questions/index.json').catch(() => []),
        getJSON('data/drill.json').catch(() => null),
      ])
      setMarket(dr ? { ...m, drill: dr } : m); setNews(n); setCfg(c); setQIndex(qi); setErr(null)
      if (qi.length) setToday(await getJSON(`data/questions/${qi.at(-1).d}.json`).catch(() => null))
    } catch (e) { setErr(e.message) }
  }, [])

  useEffect(() => { load(); const t = setInterval(load, 5 * 60 * 1000); return () => clearInterval(t) }, [load])

  // 瀏覽器端直接向 Binance 公開行情取 BTC 即時價（每 30 秒；失敗則只用管線資料）
  useEffect(() => {
    let stop = false
    const f = async () => {
      try {
        const r = await fetch('https://data-api.binance.vision/api/v3/ticker/24hr?symbol=BTCUSDT')
        const j = await r.json()
        if (!stop) setLiveBtc({ p: +j.lastPrice, c: +j.priceChangePercent, t: Date.now() })
      } catch { /* 靜默 */ }
    }
    f(); const t = setInterval(f, 30000)
    return () => { stop = true; clearInterval(t) }
  }, [])

  const alerts = useMemo(() => computeAlerts(market?.metrics, cfg), [market, cfg])

  if (err && !market) return <Center>資料載入失敗：{err}<br /><span className="text-muted text-sm">若剛部署，請等 GitHub Actions 第一次跑完（約 3–5 分鐘）。</span></Center>
  if (!market) return <Center>載入中…</Center>

  const M = market.metrics
  const A = (k) => alertFor(alerts, k)
  const route = hash.replace('#/', '').split('?')[0]
  const jDate = new URLSearchParams(hash.split('?')[1] || '').get('d')

  return (
    <div className="min-h-screen pb-16 xl:pb-3">
      <Header market={market} route={route} conv={conv} setConv={setConv} />
      {market.SAMPLE && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-lg bg-critical/20 border border-critical text-[12px]">
          ⚠ 目前顯示的是「離線樣本資料」，僅供版面預覽，數字不是真實行情。部署到 GitHub 後會自動換成真實資料。
        </div>
      )}
      <AlertBar alerts={alerts} />

      {route === 'journal' ? (
        <main className="p-3"><Journal index={qIndex} initialDate={jDate} metrics={market.metrics} /></main>
      ) : route === 'reflect' ? (
        <main className="p-3 max-w-6xl mx-auto">
          {today ? <Reflection q={today} metrics={M} onSaved={() => {}} /> : <p className="text-muted">尚未產生本期題目</p>}
        </main>
      ) : route === 'matrix' ? (
        <main className="p-3"><Matrix metrics={market.metrics} /></main>
      ) : route === 'trade' ? (
        <main className="p-3"><TradeCheck metrics={market.metrics} flows={market.flows} /></main>
      ) : route === 'review' ? (
        <main className="p-3"><Review metrics={market.metrics} index={qIndex} /></main>
      ) : route === 'guide' ? (
        <main className="p-3"><Guide /></main>
      ) : route === 'quality' ? (
        <main className="p-3"><Quality market={market} /></main>
      ) : (
        <main className="p-3 grid gap-3 xl:grid-cols-[minmax(300px,1fr)_minmax(0,2.3fr)_minmax(320px,1.1fr)] 2xl:grid-cols-[minmax(340px,1fr)_minmax(0,2.6fr)_minmax(380px,1.1fr)]">
          {/* 頂：七邊形資金雷達 */}
          <div className={`${tab === 'macro' ? 'block' : 'hidden'} xl:block xl:col-span-3`}>
            <Panel title="七邊形資金雷達（台股／美股／加密／DXY／黃金／美債／原油）">
              <FlowRadar metrics={M} weights={market.crypto_weights} drill={market.drill} />
            </Panel>
          </div>

          {/* 左：宏觀定錨 */}
          <div className={`${tab === 'macro' ? 'flex' : 'hidden'} xl:flex flex-col gap-3`}>
            <Panel title="債券與利率">
              {['us10y', 'us02y', 'spread', 'hy'].map((k) => <MetricRow key={k} m={M[k]} alert={A(k)} onPick={setPick} />)}
            </Panel>
            <Panel title="原物料與外匯">
              {['copper', 'wti', 'gold', 'dxy', 'usdjpy'].map((k) => <MetricRow key={k} m={M[k]} alert={A(k)} onPick={setPick} />)}
            </Panel>
            <Panel title="CFTC 投機部位（擁擠度）">
              <Cftc b={market.flows?.cftc} />
            </Panel>
            <Panel title="聯準會淨流動性（美元水位）">
              <NetLiq b={market.flows?.netliq} />
            </Panel>
            <Events events={market.events} />
          </div>

          {/* 中：熱圖與核心標的 */}
          <div className={`${tab === 'market' ? 'flex' : 'hidden'} xl:flex flex-col gap-3 min-w-0`}>
            <Panel title="跨資產資金流向（金屬／原油／美股／台股／加密／美元／美債）">
              <FlowChart metrics={M} weights={market.crypto_weights} />
            </Panel>
            <Panel title="台股籌碼：三大法人現貨 ＋ 台指期未平倉">
              <TwChips inst={market.flows?.tw_inst} txf={market.flows?.txf} options={market.flows?.options} />
            </Panel>
            <Panel title="資金熱圖（1 日漲跌）" right={<div className="flex gap-3">
              <MiniIdx m={M.spx} onPick={setPick} /><MiniIdx m={M.sox} onPick={setPick} alert={A('sox')} /></div>}>
              <div className="space-y-3">
                <Heatmap title="S&P 500 類股 ETF" items={market.heatmap.sectors} />
                <Heatmap title="費半主要成分股" items={market.heatmap.sox} alertCls={A('heat-sox').className} alertStyle={A('heat-sox').style} />
                <Heatmap title="台股權值股" items={market.heatmap.tw} alertCls={A('taiex').className} alertStyle={A('taiex').style} />
              </div>
            </Panel>
            <Panel title="台股 × 匯率 × 加密 連動">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                <BigTile m={M.taiex} alert={A('taiex')} onPick={setPick} />
                <BigTile m={M.usdtwd} alert={A('usdtwd')} onPick={setPick} />
                <BigTile m={M.btc} alert={A('btc')} onPick={setPick} live={liveBtc} />
              </div>
              <BtcDxyChart btc={M.btc?.history} dxy={M.dxy?.history} />
            </Panel>
            <Panel title="VIX 恐慌指數（盤中 5 分鐘）" right={<StatusDot status={M.vix?.status} checks={M.vix?.checks} />}>
              <VixBlock m={M.vix} points={market.intraday.vix} />
            </Panel>
          </div>

          {/* 右：新聞 + 反思 */}
          <div className={`${tab === 'news' || tab === 'reflect' ? 'flex' : 'hidden'} xl:flex flex-col gap-3 min-h-0`}>
            <News news={news} className={`${tab === 'news' ? 'flex' : 'hidden'} xl:flex xl:max-h-[52vh] max-h-none`} />
            {today?.version === 2 ? (
              <>
                {/* 寬螢幕：精簡摘要＋前往獨立作答頁；手機：直接完整作答 */}
                <div className="hidden xl:block"><ReflectionTeaser q={today} /></div>
                <div className={`${tab === 'reflect' ? 'block' : 'hidden'} xl:hidden`}>
                  <Reflection q={today} metrics={M} onSaved={() => {}} />
                </div>
              </>
            ) : (
              <div className={`${tab === 'reflect' ? 'block' : 'hidden'} xl:block`}>
                <Reflection q={today} metrics={M} onSaved={() => {}} />
              </div>
            )}
            <a href={`#/journal`} className={`${tab === 'reflect' ? 'block' : 'hidden'} xl:block text-center text-[12px] text-s1`}>→ 開啟歷史推敲日誌</a>
          </div>

          {/* 下：總經 */}
          <div className={`${tab === 'macro' ? 'block' : 'hidden'} xl:block xl:col-span-3`}>
            <Panel title="核心總經數據（長線循環位階）" right={<span className="text-[10px] text-muted">月資料 · 點 ○/✓ 看來源比對</span>}>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <MacroBox m={market.macro.cpi}><MacroChart m={market.macro.cpi} extra={market.macro.core} /></MacroBox>
                <MacroBox m={market.macro.nfp}><MacroChart m={market.macro.nfp} kind="bar" years={5} />
                  <p className="text-[10px] text-muted">縱軸上限 +800k，極端月份以提示框顯示實際值</p></MacroBox>
                <MacroBox m={market.macro.unrate}><MacroChart m={market.macro.unrate} /></MacroBox>
                <MacroBox m={market.macro.ism}><MacroChart m={market.macro.ism} ref50={50} />
                  <p className="text-[10px] text-muted">虛線 50 = 擴張/收縮分界</p></MacroBox>
              </div>
            </Panel>
          </div>
        </main>
      )}

      {pick && M[pick] && <Detail m={M[pick]} onClose={() => setPick(null)} />}

      {!['journal', 'quality', 'review', 'trade', 'reflect', 'matrix', 'guide'].includes(route) && (
        <nav className="xl:hidden fixed bottom-0 inset-x-0 bg-surface border-t border-line grid grid-cols-4 pb-safe z-40">
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => { setTab(k); scrollTo(0, 0) }}
              className={`py-3 text-[13px] ${tab === k ? 'text-s1 font-semibold' : 'text-ink2'}`}>{l}</button>
          ))}
        </nav>
      )}
    </div>
  )
}

function Center({ children }) {
  return <div className="min-h-screen flex items-center justify-center text-center p-6 text-ink2">{children}</div>
}

const NAV = [['', '儀表板'], ['reflect', '本期推敲'], ['journal', '推敲日誌'], ['review', '統整驗證'], ['matrix', '連動矩陣'],
  ['trade', '交易前檢查'], ['quality', '資料驗證'], ['guide', '使用指南']]
const NAV_KEY = 'mdj.nav.v1'
function loadNav() {
  try {
    const o = JSON.parse(localStorage.getItem(NAV_KEY) || 'null')
    const keys = NAV.map(([k]) => k)
    if (!Array.isArray(o)) return keys
    return [...o.filter((k) => keys.includes(k)), ...keys.filter((k) => !o.includes(k))] // 未來新增的頁面自動補在最後
  } catch { return NAV.map(([k]) => k) }
}

function Header({ market, route, conv, setConv }) {
  const s = market.quality.summary
  const bad = (s.warn || 0) + (s.fail || 0) + (s.stale || 0) + (s.missing || 0)
  const [order, setOrderRaw] = useState(loadNav)
  const [edit, setEdit] = useState(false)
  const setOrder = (o) => { setOrderRaw(o); try { localStorage.setItem(NAV_KEY, JSON.stringify(o)) } catch { /* ignore */ } }
  const label = (k) => NAV.find(([x]) => x === k)?.[1]
  const move = (i, d) => {
    const j = i + d
    if (j < 0 || j >= order.length) return
    const o = [...order]; [o[i], o[j]] = [o[j], o[i]]; setOrder(o)
  }
  const link = (r, l) => (
    <a key={r} href={`#/${r}`} className={`px-2 py-1 rounded-md text-[13px] ${route === r ? 'bg-surface2 text-ink' : 'text-ink2 hover:text-ink'}`}>{l}</a>
  )
  return (
    <header className="sticky top-0 z-30 bg-bg/95 backdrop-blur border-b border-line px-3 py-2 flex items-center gap-2 flex-wrap">
      <h1 className="font-semibold text-[15px] mr-2">Macro & Market Watch</h1>
      <nav className="flex gap-1 flex-wrap items-center relative">
        {order.map((k) => link(k, label(k)))}
        <button onClick={() => setEdit((e) => !e)} aria-label="自訂選單順序" title="自訂選單順序"
          className={`px-1.5 py-1 rounded-md text-[13px] ${edit ? 'bg-s1 text-white' : 'text-muted hover:text-ink'}`}>⇅</button>
        {edit && (
          <div className="absolute top-9 left-0 z-50 w-60 rounded-lg bg-surface2 border border-line shadow-2xl p-2">
            <div className="text-[12px] text-ink mb-1">選單順序（這台裝置記住）</div>
            <ul className="space-y-1">
              {order.map((k, i) => (
                <li key={k} className="flex items-center gap-1 text-[13px]">
                  <span className="w-5 text-muted num">{i + 1}</span>
                  <span className="flex-1 text-ink2">{label(k)}</span>
                  <button onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${label(k)} 上移`}
                    className="w-7 h-7 rounded bg-bg text-ink2 disabled:opacity-30">↑</button>
                  <button onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`${label(k)} 下移`}
                    className="w-7 h-7 rounded bg-bg text-ink2 disabled:opacity-30">↓</button>
                </li>
              ))}
            </ul>
            <div className="flex justify-between mt-2">
              <button onClick={() => setOrder(NAV.map(([k]) => k))} className="text-[11px] text-muted">恢復預設</button>
              <button onClick={() => setEdit(false)} className="text-[12px] px-2 py-0.5 rounded bg-s1 text-white">完成</button>
            </div>
          </div>
        )}
      </nav>
      <div className="ml-auto flex items-center gap-2 text-[11px] text-ink2">
        <a href="#/quality" className="px-2 py-1 rounded-md bg-surface2" title="交叉比對摘要">
          <span style={{ color: bad ? STATUS.warn.c : STATUS.ok.c }}>{bad ? '⚠' : '✓'}</span> 一致 {s.ok}{bad ? ` · 需留意 ${bad}` : ''} · 單源 {s.single}
        </a>
        <span title={twTime(market.updated)}>更新 {timeAgo(market.updated)}</span>
        <button onClick={() => setConv(conv === 'tw' ? 'us' : 'tw')} className="px-2 py-1 rounded-md bg-surface2"
          title="切換漲跌顏色慣例">
          <span className="up">▲</span><span className="down">▼</span> {conv === 'tw' ? '紅漲' : '綠漲'}
        </button>
      </div>
    </header>
  )
}

function AlertBar({ alerts }) {
  if (!alerts.length) return (
    <div className="mx-3 mt-2 text-[11px] text-muted">推敲矩陣：目前無觸發（流動性緊縮／套息反轉／科技估值壓力）</div>
  )
  return (
    <div className="mx-3 mt-2 flex flex-col sm:flex-row gap-2">
      {alerts.map((a) => (
        <div key={a.id} className="flex-1 rounded-lg px-3 py-2 border text-[12px]"
          style={{ borderColor: LEVEL_C[a.level], background: `color-mix(in srgb, ${LEVEL_C[a.level]} 14%, transparent)` }}>
          <div className="font-semibold text-ink">⚠ {a.label}</div>
          <div className="text-ink2">{a.desc}</div>
          <div className="num text-muted">{a.detail}</div>
        </div>
      ))}
    </div>
  )
}

function MiniIdx({ m, onPick, alert }) {
  if (!m) return null
  return (
    <button onClick={() => onPick(m.key)} className={`text-right px-1 ${alert?.className || ''}`} style={alert?.style}>
      <div className="text-[10px] text-muted">{m.name}</div>
      <div className="num text-[13px]">{fmt(m.last, 0)} <span className={dirClass(m.chg_1d)}>{fmtChg(m.chg_1d)}</span></div>
    </button>
  )
}

function BigTile({ m, alert, onPick, live }) {
  if (!m) return null
  const useLive = live && live.p > 0
  const v = useLive ? live.p : m.last
  const c = useLive ? live.c : m.chg_1d
  return (
    <div onClick={() => onPick(m.key)} className={`bg-surface2 rounded-lg p-2 cursor-pointer ${alert.className}`} style={alert.style}>
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-ink2">{m.name}</span>
        <StatusDot status={m.status} checks={m.checks} compact />
      </div>
      <div className="num text-xl">{fmt(v, m.decimals)}</div>
      <div className="flex justify-between text-[11px]">
        <span className={`num ${dirClass(c)}`}>{fmtChg(c, m.rate)}{useLive ? ' 24h' : ''}</span>
        <span className="text-muted">{useLive ? '● 即時 Binance' : m.date}</span>
      </div>
    </div>
  )
}

function VixBlock({ m, points }) {
  if (!m) return null
  const lastT = points?.at(-1)?.[0]
  const nyDate = lastT ? new Date(lastT * 1000).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) : null
  const prev = nyDate ? [...(m.history || [])].reverse().find(([d]) => d < nyDate)?.[1] : null
  const lv = m.last
  const zone = lv >= 30 ? ['恐慌', 'critical'] : lv >= 20 ? ['警戒', 'serious'] : lv >= 15 ? ['正常', 'muted'] : ['自滿', 'warning']
  return (
    <div className="grid sm:grid-cols-[150px_1fr] gap-3 items-center">
      <div>
        <div className="num text-3xl">{fmt(lv, 2)}</div>
        <div className={`num text-[12px] ${dirClass(m.chg_1d)}`}>{fmtChg(m.chg_1d)}（{m.date}）</div>
        <div className="text-[11px] mt-1" style={{ color: `var(--color-${zone[1]})` }}>● {zone[0]}區間</div>
        <div className="text-[10px] text-muted">&lt;15 自滿 · 15–20 正常 · 20–30 警戒 · ≥30 恐慌</div>
      </div>
      {points?.length ? <IntradayChart points={points} name="VIX" refLine={prev} color="var(--color-s2)" />
        : <div className="text-muted text-sm">盤中資料暫無（休市或來源延遲）</div>}
    </div>
  )
}

function Events({ events }) {
  if (!events?.length) return null
  return (
    <Panel title="未來經濟事件">
      <ul className="text-[12px] space-y-1">
        {events.slice(0, 8).map((e, i) => (
          <li key={i} className="flex justify-between"><span className="num text-ink2">{e.date}</span><span className="text-ink">{e.event}</span></li>
        ))}
      </ul>
      <p className="text-[10px] text-muted mt-1">來源：BLS 官方發布日曆、ISM 每月首個營業日、Fed FOMC 日程</p>
    </Panel>
  )
}

function MacroBox({ m, children }) {
  return (
    <div>
      {children}
      <div className="flex items-center gap-1 text-[10px] text-muted">{m?.source}<StatusDot status={m?.status} checks={m?.checks} /></div>
    </div>
  )
}

function Detail({ m, onClose }) {
  useEffect(() => {
    const f = (e) => e.key === 'Escape' && onClose()
    addEventListener('keydown', f); return () => removeEventListener('keydown', f)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-6" onClick={onClose}>
      <div className="bg-surface border border-line rounded-t-2xl sm:rounded-2xl w-full max-w-3xl p-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start mb-2">
          <div>
            <h3 className="text-lg font-semibold">{m.name}</h3>
            <div className="num text-2xl">{fmt(m.last, m.decimals)} <span className={`text-sm ${dirClass(m.chg_1d)}`}>{fmtChg(m.chg_1d, m.rate)}</span></div>
            <div className="text-[11px] text-muted">{m.source} · {m.date}{m.live ? ` · 即時參考 ${m.live.src} ${m.live.v}` : ''}</div>
          </div>
          <button onClick={onClose} className="text-ink2 text-xl px-2" aria-label="關閉">×</button>
        </div>
        <HistoryChart m={m} />
        <div className="mt-3 text-[12px]">
          <div className="text-muted mb-1">交叉比對</div>
          {(m.checks || []).map((c, i) => <CheckLine key={i} c={c} />)}
          {m.note && <p className="text-muted mt-1">{m.note}</p>}
        </div>
      </div>
    </div>
  )
}

/** 儀表板右欄：本期推敲的精簡摘要 */
function ReflectionTeaser({ q }) {
  const a = q.assessment || {}
  const e = loadEntries()[q.date]
  const done = e?.answers?.filter((x) => x?.trim()).length || 0
  const RC = { risk_on: 'var(--up)', risk_off: 'var(--down)', deleverage: 'var(--color-critical)', liquidity_up: 'var(--color-good)', mixed: 'var(--color-muted)' }
  return (
    <Panel title={<>本期推敲 <span className="text-muted font-normal">· {q.cycle?.from?.slice(5)}→{q.cycle?.to?.slice(5)}</span></>}
      right={<span className="text-[11px] text-muted">{done ? `已答 ${done}/6` : '尚未作答'}</span>}>
      <div className="flex flex-wrap gap-1.5 mb-2">
        <span className="text-[11px] px-2 py-0.5 rounded-full border" style={{ borderColor: RC[a.regime], color: RC[a.regime] }}>{a.regime_txt}</span>
        <span className="text-[11px] px-2 py-0.5 rounded-full border border-line text-ink2">流動性：{a.liquidity}</span>
      </div>
      <ul className="text-[12px] text-ink2 space-y-1 leading-relaxed">
        {(a.text || []).slice(0, 4).map((l, i) => <li key={i}>{i === 0 ? '🧭 ' : '• '}{l}</li>)}
      </ul>
      <div className="mt-2 text-[12px] text-ink">焦點市場：{(q.focus || []).map((k) => q.markets?.[k]?.name).join('、')}</div>
      <a href="#/reflect" className="mt-3 block text-center px-3 py-2 rounded-lg bg-s1 text-white text-sm font-medium">
        {done ? '繼續本期推敲 →' : '開始本期推敲 →'}</a>
    </Panel>
  )
}
