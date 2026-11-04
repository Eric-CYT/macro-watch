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
export function windowScore(h, n, bond, end = h ? h.length - 1 : 0) {
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
  return { z: sd ? +(raw / (sd * Math.sqrt(n))).toFixed(2) : 0, raw, from: h[base][0], to: h[end][0] }
}

export function radarSeries(metrics, weights) {
  const basket = cryptoBasket(metrics, weights)
  const hist = (a) => (a.k === 'crypto' ? basket?.history : metrics?.[a.k]?.history)
  return { hist, basketNote: basket?.note }
}

/** 一個週期的 7 個市場：本期與上一期 */
export function radarPeriod(metrics, weights, n) {
  const { hist, basketNote } = radarSeries(metrics, weights)
  const rows = RADAR_ASSETS.map((a) => {
    const h = hist(a)
    const cur = windowScore(h, n, a.bond)
    const prev = h ? windowScore(h, n, a.bond, h.length - 1 - n) : null
    return { ...a, cur, prev }
  })
  return { n, rows, basketNote }
}

/** 最長可選天數：要能同時算出上一期（2N）＋ 60 日波動 */
export function radarMaxN(metrics, weights) {
  const { hist } = radarSeries(metrics, weights)
  const lens = RADAR_ASSETS.map((a) => hist(a)?.length || 0).filter(Boolean)
  return Math.max(1, Math.floor((Math.min(...lens) - 62) / 2))
}
