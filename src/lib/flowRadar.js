/**
 * 七邊形資金雷達：7 個市場在「本期」與「上一期（前一段同樣長度）」的資金流向 σ
 * σ 算法與儀表板「跨資產資金流向」直立圖完全相同：
 *   N 日報酬 ÷（期間起點之前 60 個交易日的單日報酬標準差 × √N）
 *   美債以價格方向計算（殖利率下跌＝流入）
 * 加密＝BTC＋ETH 市值加權籃子（權重來自 CoinGecko 市值，由資料管線提供）
 */
export const RADAR_ASSETS = [
  { k: 'taiex', label: '台股' },
  { k: 'spx', label: '美股' },
  { k: 'crypto', label: '加密' },
  { k: 'dxy', label: 'DXY' },
  { k: 'gold', label: '黃金' },
  { k: 'us10y', label: '美債', bond: true },
  { k: 'wti', label: '原油' },
]
export const RADAR_PERIODS = [1, 3, 5, 10, 20, 30]

/** BTC＋ETH 買進持有籃子：以共同起始日為基準 100，依權重加總 */
export function cryptoBasket(metrics, w) {
  const b = metrics?.btc?.history, e = metrics?.eth?.history
  if (!b?.length) return null
  if (!e?.length) return { history: b, note: '只有 BTC（ETH 資料缺漏）' }
  const em = new Map(e)
  const common = b.filter(([d]) => em.has(d))
  if (common.length < 70) return { history: b, note: '只有 BTC（ETH 共同日期不足）' }
  const wb = w?.btc ?? 0.83, we = w?.eth ?? 0.17
  const b0 = common[0][1], e0 = em.get(common[0][0])
  return {
    history: common.map(([d, v]) => [d, +(100 * (wb * v / b0 + we * em.get(d) / e0)).toFixed(4)]),
    note: `BTC ${Math.round(wb * 100)}%＋ETH ${Math.round(we * 100)}%（${w?.source || '預設權重'}）`,
  }
}

/** 與 FlowChart 的 flowScore 相同算法，但可指定期間「終點」索引 end（預設最後一筆） */
export function windowScore(h, n, bond, end = h ? h.length - 1 : 0, opts = {}) {
  if (!h || h.length < 70) return null
  const base = end - n
  if (base < 61 || end > h.length - 1) return null
  const v = h.map((p) => p[1])
  const daily = []
  for (let i = end - 60; i <= end; i++) daily.push(bond ? -(v[i] - v[i - 1]) * 100 : Math.log(v[i] / v[i - 1]) * 100)
  const hist = daily.slice(0, -1)
  const mu = hist.reduce((s, x) => s + x, 0) / hist.length
  const sd = Math.sqrt(hist.reduce((s, x) => s + (x - mu) ** 2, 0) / hist.length)
  const raw = bond ? -(v[end] - v[base]) * 100 : (v[end] / v[base] - 1) * 100
  // drift：扣掉「平常每天的成長速度」（穩定幣流通量長期向上，不扣會永遠顯示為異常流入）
  const adj = opts.drift ? raw - mu * n : raw
  return { z: sd ? +(adj / (sd * Math.sqrt(n))).toFixed(2) : 0, raw, net: v[end] - v[base], drift: opts.drift ? mu : null,
    from: h[base][0], to: h[end][0] }
}

/** 序列中「日期 ≤ d」的最後一個索引；沒有則 -1 */
export function idxAtOrBefore(h, d) {
  if (!h?.length) return -1
  if (!d || h[h.length - 1][0] <= d) return h.length - 1
  let lo = 0, hi = h.length - 1, ans = -1
  while (lo <= hi) { const m = (lo + hi) >> 1; if (h[m][0] <= d) { ans = m; lo = m + 1 } else hi = m - 1 }
  return ans
}

/** 本期與上一期；align = 對齊日期（null＝各自最新） */
export function curPrev(h, n, bond, align, opts) {
  if (!h?.length) return { cur: null, prev: null }
  const end = idxAtOrBefore(h, align)
  if (end < 0) return { cur: null, prev: null }
  return { cur: windowScore(h, n, bond, end, opts), prev: windowScore(h, n, bond, end - n, opts) }
}

/**
 * 量能比：期間內平均成交量 ÷ 期間開始前 20 日平均成交量
 * 回傳 {ratio, tag}；tag 依價格方向判斷是否「量價配合」
 */
export function volumeCheck(vol, cur, n) {
  if (!vol?.length || !cur) return null
  const end = idxAtOrBefore(vol, cur.to)
  if (end < 0 || vol[end][0] !== cur.to || end - n - 20 + 1 < 0) return null
  const win = vol.slice(end - n + 1, end + 1).map((x) => x[1])
  const base = vol.slice(end - n - 19, end - n + 1).map((x) => x[1])
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length
  if (!avg(base)) return null
  const ratio = avg(win) / avg(base)
  const up = cur.z >= 0.25, dn = cur.z <= -0.25
  const big = ratio >= 1.1, small = ratio <= 0.9
  const tag = up && big ? '價漲量增（流入確認）' : up && small ? '價漲量縮（流入偏弱）'
    : dn && big ? '價跌量增（流出確認）' : dn && small ? '價跌量縮（賣壓減輕）' : '量能持平'
  return { ratio: +ratio.toFixed(2), tag, ok: (up || dn) && big }
}

/** 兩個成交量序列按日期加總 */
export function sumVolume(...series) {
  const lst = series.filter((s) => s?.length).map((s) => new Map(s))
  if (!lst.length) return null
  const dates = [...lst[0].keys()].filter((d) => lst.every((m) => m.has(d))).sort()
  return dates.map((d) => [d, lst.reduce((s, m) => s + m.get(d), 0)])
}

/** 相對強弱：item / parent 的比值序列（共同日期） */
export function ratioSeries(h, parent) {
  if (!h?.length || !parent?.length) return null
  const pm = new Map(parent)
  const out = h.filter(([d]) => pm.has(d) && pm.get(d)).map(([d, v]) => [d, v / pm.get(d)])
  return out.length >= 70 ? out : null
}

export function radarSeries(metrics, weights) {
  const basket = cryptoBasket(metrics, weights)
  const hist = (a) => (a.k === 'crypto' ? basket?.history : metrics?.[a.k]?.history)
  const volume = (a) => (a.k === 'crypto' ? sumVolume(metrics?.btc?.volume, metrics?.eth?.volume) : metrics?.[a.k]?.volume)
  return { hist, volume, basket: basket?.history, basketNote: basket?.note }
}

/** 對齊日期：美股最新交易日（其他市場取「該日或之前」的最後收盤） */
export function alignDate(metrics) {
  return metrics?.spx?.history?.at(-1)?.[0] || null
}

/** 一個週期的 7 個市場：本期與上一期 */
export function radarPeriod(metrics, weights, n, align = null) {
  const { hist, volume, basketNote } = radarSeries(metrics, weights)
  const rows = RADAR_ASSETS.map((a) => {
    const h = hist(a)
    const { cur, prev } = curPrev(h, n, a.bond, align)
    return { ...a, cur, prev, vol: volumeCheck(volume(a), cur, n) }
  })
  return { n, rows, basketNote }
}

/** 最長可選天數：要能同時算出上一期（2N）＋ 60 日波動 */
export function radarMaxN(metrics, weights) {
  const { hist } = radarSeries(metrics, weights)
  const lens = RADAR_ASSETS.map((a) => hist(a)?.length || 0).filter(Boolean)
  return Math.max(1, Math.floor((Math.min(...lens) - 62) / 2))
}

/**
 * 雷達歷史回測：某市場過去 N 日 σ 很強（≥ +1）或很弱（≤ −1）之後，接下來 H 個交易日是延續還是反轉
 * 延續率要和「基準」（不分條件時，H 日後上漲／下跌的比例）比，才看得出訊號有沒有價值。
 * 相鄰樣本期間重疊，實際不確定性比樣本數顯示的大。
 */
export function radarBacktest(metrics, weights, looks = [5, 20], H = 5, thr = 1) {
  const { hist } = radarSeries(metrics, weights)
  const out = []
  for (const a of RADAR_ASSETS) {
    const h = hist(a)
    if (!h || h.length < 62 + Math.max(...looks) + H + 20) continue
    const v = h.map((x) => x[1])
    const fwd = (t) => (a.bond ? -(v[t + H] - v[t]) : v[t + H] / v[t] - 1)
    const row = { k: a.k, label: a.label, from: null, to: h[h.length - 1 - H][0] }
    let upAll = 0, dnAll = 0, nAll = 0
    for (let t = 62 + Math.max(...looks); t + H < h.length; t++) { const f = fwd(t); if (f > 0) upAll++; else if (f < 0) dnAll++; nAll++ }
    row.baseUp = nAll ? upAll / nAll : null
    row.baseDn = nAll ? dnAll / nAll : null
    for (const n of looks) {
      let su = 0, nu = 0, sd = 0, nd = 0
      for (let t = 62 + n; t + H < h.length; t++) {
        row.from = row.from || h[t][0]
        const s = windowScore(h, n, a.bond, t)
        if (!s) continue
        const f = fwd(t)
        if (s.z >= thr) { nu++; if (f > 0) su++ }
        if (s.z <= -thr) { nd++; if (f < 0) sd++ }
      }
      row[n] = { strong: nu ? { rate: su / nu, n: nu } : null, weak: nd ? { rate: sd / nd, n: nd } : null }
    }
    out.push(row)
  }
  return out
}
