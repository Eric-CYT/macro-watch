/** 交易前檢查：選項定義、儲存、系統參考、邏輯檢查 */
const TKEY = 'mdj.trades.v1'
const TDRAFT = 'mdj.tradedraft.v1'

export const MARKETS = [
  ['spx', '美股 S&P 500'], ['sox', '費城半導體 SOX'], ['taiex', '台股加權'], ['btc', '比特幣 BTC'],
  ['gold', '黃金'], ['wti', 'WTI 原油'], ['copper', '銅'], ['dxy', '美元指數 DXY'],
  ['us10y', '美債 10Y 殖利率'], ['usdjpy', 'USD/JPY'], ['usdtwd', 'USD/TWD'], ['other', '其他（自行輸入）'],
]
export const marketName = (t) => (t.market === 'other' ? t.custom || '其他' : MARKETS.find(([k]) => k === t.market)?.[1] || t.market)

export const STATES = ['趨勢上漲', '趨勢下跌', '區間震盪', '突破進行中', '跌破進行中', '上漲中的回調', '下跌中的反彈', '收斂整理（等待方向）']
export const TRENDS = ['上升', '下降', '橫盤']
export const LEVELS = ['月線', '週線', '日線', '4小時', '1小時', '15分', '5分']
export const BIASES = ['偏多', '偏空', '中性']
export const DECISIONS = ['進場', '等待（設條件觀察）', '放棄']
export const CYCLES = ['當沖', '短線（數日）', '波段（數週）', '中長線（數月）']

export const emptyTrade = () => ({
  market: 'spx', custom: '',
  q1: { state: '', note: '' },
  q2: { date: '', price: '', note: '' },
  q3: { trend: '' },
  q4: { level: '' },
  q5: { bias: '', note: '' },
  q6: { bigLevel: '', bigDir: '', smallLevel: '', smallDir: '' },
  q7: { entry: '', stop: '', target: '', note: '' },
  q8: { decision: '', cycle: '', note: '' },
})

export function loadTrades() { try { return JSON.parse(localStorage.getItem(TKEY) || '[]') } catch { return [] } }
export function saveTrades(list) { localStorage.setItem(TKEY, JSON.stringify(list)) }
export function addTrade(t) {
  const now = new Date().toISOString()
  const rec = { ...t, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, created_at: now, updated_at: now }
  const list = [rec, ...loadTrades()]
  saveTrades(list)
  return list
}
export function updateTrade(id, patch) {
  const list = loadTrades().map((t) => (t.id === id ? { ...t, ...patch, updated_at: new Date().toISOString() } : t))
  saveTrades(list)
  return list
}
export function deleteTrade(id) {
  // 軟刪除：保留墓碑以便跨裝置同步時不會被另一台裝置「復活」
  return updateTrade(id, { deleted: true })
}
export function mergeTrades(a, b) {
  const m = new Map()
  for (const t of [...(a || []), ...(b || [])]) {
    const cur = m.get(t.id)
    if (!cur || (t.updated_at || '') > (cur.updated_at || '')) m.set(t.id, t)
  }
  return [...m.values()].sort((x, y) => (x.created_at < y.created_at ? 1 : -1))
}
export const loadTradeDraft = () => { try { return JSON.parse(localStorage.getItem(TDRAFT) || 'null') } catch { return null } }
export const saveTradeDraft = (d) => { try { localStorage.setItem(TDRAFT, JSON.stringify({ ...d, saved_at: new Date().toISOString() })) } catch { /* ignore */ } }
export const clearTradeDraft = () => { try { localStorage.removeItem(TDRAFT) } catch { /* ignore */ } }

/** 系統參考：日線趨勢、近期高低點（只用日收盤價，僅供參考） */
export function reference(m) {
  const h = m?.history
  if (!h || h.length < 65) return null
  const v = h.map((x) => x[1])
  const ma = (n, end = v.length) => v.slice(end - n, end).reduce((s, x) => s + x, 0) / n
  const last = v.at(-1), ma20 = ma(20), ma60 = ma(60), ma20prev = ma(20, v.length - 5)
  let trend = '橫盤'
  if (last > ma20 && ma20 > ma60 && ma20 > ma20prev) trend = '上升'
  else if (last < ma20 && ma20 < ma60 && ma20 < ma20prev) trend = '下降'
  const ext = (n) => {
    const seg = h.slice(-n)
    const hi = seg.reduce((a, b) => (b[1] > a[1] ? b : a)), lo = seg.reduce((a, b) => (b[1] < a[1] ? b : a))
    return { hi, lo }
  }
  return { last, date: h.at(-1)[0], ma20, ma60, trend, e20: ext(20), e60: ext(60), rate: !!m.rate, decimals: m.decimals ?? 2 }
}

const num = (x) => (x === '' || x == null ? null : Number(x))

/** 邏輯一致性檢查：回傳 [{level:'error'|'warn'|'ok', msg}] */
export function checks(t, ref) {
  const out = []
  const e = num(t.q7.entry), s = num(t.q7.stop), g = num(t.q7.target)
  const bias = t.q5.bias, dec = t.q8.decision
  const li = (x) => LEVELS.indexOf(x)
  const filled = [t.q1.state, t.q2.date || t.q2.price || t.q2.note, t.q3.trend, t.q4.level, t.q5.bias,
    t.q6.bigLevel && t.q6.smallLevel, t.q7.stop, t.q8.decision].filter(Boolean).length
  out.push({ level: filled === 8 ? 'ok' : 'warn', msg: `已回答 ${filled}/8 題` })

  if (t.q6.bigLevel && t.q6.smallLevel && li(t.q6.bigLevel) >= li(t.q6.smallLevel))
    out.push({ level: 'error', msg: `「順大逆小」的大級別（${t.q6.bigLevel}）必須比小級別（${t.q6.smallLevel}）更長` })
  if (bias && t.q6.bigDir && bias !== '中性' && ((bias === '偏多' && t.q6.bigDir === '下降') || (bias === '偏空' && t.q6.bigDir === '上升')))
    out.push({ level: 'warn', msg: `你的偏見（${bias}）與要順的大級別方向（${t.q6.bigDir}）相反，等於逆大勢操作` })
  if (t.q3.trend && t.q6.bigDir && t.q4.level && t.q4.level === t.q6.bigLevel && t.q3.trend !== t.q6.bigDir)
    out.push({ level: 'warn', msg: `第 3 題趨勢（${t.q3.trend}）與第 6 題同級別的方向（${t.q6.bigDir}）不一致` })
  if (e != null && s != null) {
    if (bias === '偏多' && s >= e) out.push({ level: 'error', msg: '偏多但防守位不低於進場價，停損方向錯了' })
    if (bias === '偏空' && s <= e) out.push({ level: 'error', msg: '偏空但防守位不高於進場價，停損方向錯了' })
    const risk = Math.abs(e - s) / e * 100
    if (Number.isFinite(risk)) out.push({ level: risk > 8 ? 'warn' : 'ok', msg: `單筆風險（進場→防守）：${risk.toFixed(2)}%${risk > 8 ? '，距離偏大，確認部位大小' : ''}` })
    if (g != null) {
      const rr = Math.abs(g - e) / Math.abs(e - s)
      if (Number.isFinite(rr)) out.push({ level: rr < 1.5 ? 'warn' : 'ok', msg: `報酬風險比 R:R = ${rr.toFixed(2)}${rr < 1.5 ? '（低於 1.5，值得再想想）' : ''}` })
    }
  }
  if (dec === '進場' && !t.q7.stop) out.push({ level: 'error', msg: '決定進場卻沒有防守位' })
  if (dec === '進場' && bias === '中性') out.push({ level: 'warn', msg: '偏見是中性卻決定進場：方向依據是什麼？' })
  if (dec === '進場' && !t.q8.cycle) out.push({ level: 'warn', msg: '請選擇交易週期，週期決定防守位與持有時間' })
  if (ref && t.q3.trend && t.q4.level === '日線' && ref.trend !== t.q3.trend)
    out.push({ level: 'warn', msg: `系統依日線均線判斷為「${ref.trend}」，與你的判斷（${t.q3.trend}）不同，確認一下依據` })
  return out
}

/** 已記錄交易的後續追蹤（僅日收盤價） */
export function followUp(t, m) {
  const h = m?.history
  if (!h?.length || t.market === 'other') return null
  const d = t.created_at.slice(0, 10)
  const after = h.filter(([x]) => x > d)
  const e = num(t.q7.entry) ?? (h.filter(([x]) => x <= d).at(-1)?.[1])
  if (e == null) return null
  const last = h.at(-1)[1]
  const chg = m.rate ? (last - e) * 100 : (last / e - 1) * 100
  const s = num(t.q7.stop)
  let stopHit = null
  if (s != null && after.length) {
    if (t.q5.bias === '偏多') stopHit = after.find(([, v]) => v <= s)
    else if (t.q5.bias === '偏空') stopHit = after.find(([, v]) => v >= s)
    else stopHit = undefined
  }
  const g = num(t.q7.target)
  let targetHit = null
  if (g != null && after.length) {
    if (t.q5.bias === '偏多') targetHit = after.find(([, v]) => v >= g)
    else if (t.q5.bias === '偏空') targetHit = after.find(([, v]) => v <= g)
  }
  const dirOk = t.q5.bias === '偏多' ? chg > 0 : t.q5.bias === '偏空' ? chg < 0 : null
  return { e, last, chg, rate: !!m.rate, days: after.length, stopHit, targetHit, dirOk, lastDate: h.at(-1)[0] }
}
