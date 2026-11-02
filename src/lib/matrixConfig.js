/**
 * 全球資產連動監控：設定檔（日後維護只需修改這裡）
 * ─────────────────────────────────────────────
 * DRIVERS   驅動指標（手動輸入區的下拉選單）
 * TARGETS   受影響資產（矩陣欄位；score: true 者顯示計分燈號）
 * MATRIX    附錄 1：資產連動矩陣  分數 +1 / -1 / 0，null = N/A（不計分）
 * SCENARIOS 附錄 2：總經情境觸發模組  when 內所有條件同時成立（AND）才觸發
 */

export const STATES = { up: '上漲', down: '下跌' }

export const DRIVERS = [
  { key: 'dxy', name: '美元 (DXY)', metric: 'dxy' },
  { key: 'us10y', name: '美債 (US10Y)', metric: 'us10y' },
  { key: 'oil', name: '原油 (Oil)', metric: 'wti' },
  { key: 'spx', name: '美股 (SPX)', metric: 'spx' },
]

export const TARGETS = [
  { key: 'us', name: '美股', score: false },
  { key: 'tw', name: '台股', score: true },
  { key: 'crypto', name: '加密幣', score: true },
  { key: 'gold', name: '黃金', score: true },
  { key: 'oil', name: '原油', score: false },
]

export const MATRIX = {
  dxy: {
    up: { scores: { us: -1, tw: -1, crypto: -1, gold: -1, oil: -1 },
      note: '資金回流美國，非美資產計價變貴，全球流動性收緊，外資提款台股。' },
    down: { scores: { us: 1, tw: 1, crypto: 1, gold: 1, oil: 1 },
      note: '資金溢出至非美市場，風險資產估值提升，大宗商品計價變便宜而上漲。' },
  },
  us10y: {
    up: { scores: { us: -1, tw: -1, crypto: -1, gold: -1, oil: 0 },
      note: '無風險利率飆升，企業未來現金流折現下修；黃金與加密貨幣等無孳息資產的機會成本大增。' },
    down: { scores: { us: 1, tw: 1, crypto: 1, gold: 1, oil: 0 },
      note: '資金預期降息或避險買盤湧入債市，資金成本降低，有利科技股與風險資產估值修復。' },
  },
  oil: {
    up: { scores: { us: -1, tw: -1, crypto: 0, gold: 1, oil: null },
      note: '通膨預期升溫，企業生產與運輸成本增加侵蝕毛利；黃金發揮抗通膨屬性。' },
    down: { scores: { us: 1, tw: 1, crypto: 0, gold: -1, oil: null },
      note: '通膨降溫，市場預期貨幣政策將轉向寬鬆，有利股債齊揚；黃金抗通膨需求下降。' },
  },
  spx: {
    up: { scores: { us: null, tw: 1, crypto: 1, gold: -1, oil: 0 },
      note: '市場處於 Risk-On 狀態，風險偏好極高，外資買盤帶動台股與高 Beta 屬性的加密貨幣上漲。' },
    down: { scores: { us: null, tw: -1, crypto: -1, gold: 1, oil: 0 },
      note: '市場處於 Risk-Off 狀態，資金撤出高風險資產，黃金受惠於傳統避險需求而上漲。' },
  },
}

export const SCENARIOS = [
  { key: 'party', name: '完美流動性派對', tone: 'good',
    when: { dxy: 'down', us10y: 'down' },
    note: '資金充裕且成本低廉，最適合做多科技股、台股與加密貨幣的絕佳環境。' },
  { key: 'panic', name: '極端恐慌 / 衰退', tone: 'critical',
    when: { spx: 'down', us10y: 'down' },
    note: '經濟衰退擔憂再起，資金奪門而出逃向美債與黃金避險，應避開所有風險資產。' },
  { key: 'inflation', name: '通膨復燃恐懼', tone: 'serious',
    when: { oil: 'up', us10y: 'up' },
    note: '停滯性通膨陰霾籠罩，央行被迫維持高利率，形成股債雙殺格局，僅美元與原油受惠。' },
  { key: 'strongusd', name: '強勢美元吸金', tone: 'warning',
    when: { dxy: 'up', us10y: 'up' },
    note: '美國本土經濟一枝獨秀，高息環境將全球資金抽乾，非美資產與無孳息資產面臨強大賣壓。' },
]

export const NO_SCENARIO_NOTE = '目前的指標組合沒有觸發任何預設情境（混合訊號）。此時各資產較受個別因素影響，建議以下方計分與個別市場的資金流向為主要參考。'
export const SCORE_RULE_NOTE = '總分 = 4 個驅動指標在矩陣中對該資產的分數加總（N/A 不計）。> 0 亮綠燈（偏多）、< 0 亮紅燈（偏空）、= 0 灰燈（中性）。'

/** 計算各資產總分與明細 */
export function computeScores(states) {
  const out = {}
  for (const t of TARGETS) {
    const parts = DRIVERS.map((d) => {
      const st = states[d.key]
      const row = st ? MATRIX[d.key]?.[st] : null
      const v = row ? row.scores[t.key] : undefined
      return { driver: d, state: st, value: v, note: row?.note }
    })
    const total = parts.reduce((s, p) => s + (typeof p.value === 'number' ? p.value : 0), 0)
    out[t.key] = { target: t, total, parts }
  }
  return out
}

/** 判定觸發的情境（可能同時多個） */
export function matchScenarios(states) {
  return SCENARIOS.filter((sc) => Object.entries(sc.when).every(([k, v]) => states[k] === v))
}
