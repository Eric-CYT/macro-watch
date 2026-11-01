/**
 * 推敲日誌的「驗證 / 統整 / 總結」邏輯（全部在瀏覽器計算，免費）
 * 驗證方式：作答日收盤 → N 個交易日後收盤（加密以日曆日計），用實際行情對答案。
 */
export const ASSETS = {
  us10y: { name: '美債10Y殖利率', rate: true }, us02y: { name: '美債2Y殖利率', rate: true },
  spread: { name: '10Y-2Y利差', rate: true }, hy: { name: '高收益債利差', rate: true },
  dxy: { name: '美元DXY' }, usdjpy: { name: 'USD/JPY' }, usdtwd: { name: 'USD/TWD' },
  spx: { name: '美股S&P500' }, sox: { name: '費半SOX' }, taiex: { name: '台股' },
  btc: { name: '比特幣' }, gold: { name: '黃金' }, wti: { name: '原油' }, copper: { name: '銅' },
  vix: { name: 'VIX' },
}
export const DIRS = { up: '↑ 漲', down: '↓ 跌', flat: '— 盤整' }
export const HORIZONS = [1, 5, 20]
export const CONF = { 1: '低', 2: '中', 3: '高' }

/** 單一預判的實際結果。回傳 null（無資料）、{pending}（未到期）或完整結果 */
export function outcome(metrics, pred, date) {
  const m = metrics?.[pred?.asset]
  const h = m?.history
  if (!pred?.dir || !h?.length) return null
  let base = -1
  for (let i = h.length - 1; i >= 0; i--) if (h[i][0] <= date) { base = i; break }
  if (base < 0) return null
  const target = base + pred.h
  if (target > h.length - 1) return { pending: true, left: target - (h.length - 1) }
  const a = h[base][1], b = h[target][1]
  const rate = !!m.rate
  const move = rate ? (b - a) * 100 : (b / a - 1) * 100
  // 波動基準：作答日前 60 日的日變動標準差
  const d = []
  for (let i = Math.max(1, base - 60); i <= base; i++) d.push(rate ? (h[i][1] - h[i - 1][1]) * 100 : Math.log(h[i][1] / h[i - 1][1]) * 100)
  const mu = d.reduce((s, x) => s + x, 0) / (d.length || 1)
  const sd = Math.sqrt(d.reduce((s, x) => s + (x - mu) ** 2, 0) / (d.length || 1))
  const z = sd ? move / (sd * Math.sqrt(pred.h)) : 0
  // 判定：漲/跌看方向且需超過 0.25σ（避免雜訊算命中）；盤整 = |z| < 0.5
  const hit = pred.dir === 'up' ? z > 0.25 : pred.dir === 'down' ? z < -0.25 : Math.abs(z) < 0.5
  const noise = pred.dir !== 'flat' && Math.abs(z) <= 0.25
  return { move, z, hit: noise ? null : hit, noise, rate, from: h[base][0], to: h[target][0] }
}

export const fmtMove = (o) => (o.rate ? `${o.move > 0 ? '+' : ''}${o.move.toFixed(1)}bp` : `${o.move > 0 ? '+' : ''}${o.move.toFixed(2)}%`)

/** 作答後實際走勢（沒有預判時也顯示）：1/5/20 日 */
export function afterMoves(metrics, asset, date) {
  return HORIZONS.map((n) => ({ n, o: outcome(metrics, { asset, dir: 'up', h: n }, date) }))
}

/** 把日誌展開成逐題紀錄，附上驗證結果 */
export function flatten(entries, metrics, qIndex) {
  const evMap = new Map((qIndex || []).map((x) => [x.d, x.ev || []]))
  const rows = []
  for (const [date, e] of Object.entries(entries || {})) {
    const qs = e.questions || []
    qs.forEach((q, i) => {
      const p = e.predictions?.[i]
      const o = p?.dir ? outcome(metrics, p, date) : null
      rows.push({
        date, i, q, a: e.answers?.[i] || '', type: e.types?.[i] || (i >= 6 ? 'asset' : i >= 3 ? 'flow' : 'market'),
        pred: p?.dir ? p : null, o, events: e.events?.length ? e.events : evMap.get(date) || [],
        grade: e.grade, note: e.review, summary: e.summary,
      })
    })
  }
  return rows.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : x.i - y.i))
}

const rate = (arr) => {
  const done = arr.filter((r) => r.o && !r.o.pending && r.o.hit !== null)
  const hit = done.filter((r) => r.o.hit).length
  return { n: done.length, hit, pct: done.length ? hit / done.length : null }
}

export const DRIVERS = [
  ['利率', /利率|殖利率|yield|2Y|10Y|債/i], ['美元', /美元|DXY|dollar/i], ['流動性', /流動性|去槓桿|保證金|QT|縮表|注資/],
  ['通膨', /通膨|CPI|PCE|物價/i], ['Fed/央行', /Fed|聯準會|央行|FOMC|升息|降息|日銀|BOJ/i], ['避險', /避險|risk.?off|恐慌|VIX/i],
  ['外資', /外資|匯出|匯入|新台幣|台幣/], ['財報/基本面', /財報|EPS|營收|指引|基本面|估值/], ['地緣政治', /地緣|戰爭|關稅|制裁|選舉/],
  ['技術面', /支撐|壓力|均線|突破|跌破|量能|成交量/], ['情緒/部位', /情緒|部位|擁擠|空單|軋空|散戶/],
]

/** 每日總結的驗證：整體方向（以美股）＋看好/看壞資產，皆以 5 個交易日 */
export function summaryCalls(entries, metrics) {
  const out = []
  for (const [date, e] of Object.entries(entries || {})) {
    const s = e.summary
    if (!s) continue
    if (s.bias) out.push({ date, kind: '整體方向', asset: 'spx', dir: s.bias === 'bull' ? 'up' : s.bias === 'bear' ? 'down' : 'flat' })
    ;(s.long || []).forEach((k) => out.push({ date, kind: '看好', asset: k, dir: 'up' }))
    ;(s.short || []).forEach((k) => out.push({ date, kind: '看壞', asset: k, dir: 'down' }))
  }
  return out.map((c) => ({ ...c, o: outcome(metrics, { asset: c.asset, dir: c.dir, h: 5 }, c.date) }))
}

export function stats(rows, entries, metrics) {
  const days = Object.values(entries || {}).filter((e) => e.answers?.some((a) => a?.trim()))
  const dates = days.map((e) => e.date).sort()
  // 連續作答（以有題目的交易日序列計，簡化為：相鄰作答日相差 ≤ 3 天視為連續，涵蓋週末）
  let streak = 0
  for (let i = dates.length - 1; i >= 0; i--) {
    if (i === dates.length - 1) { streak = 1; continue }
    const gap = (Date.parse(dates[i + 1]) - Date.parse(dates[i])) / 864e5
    if (gap <= 3) streak++; else break
  }
  const preds = rows.filter((r) => r.pred)
  const group = (keyFn) => {
    const g = {}
    preds.forEach((r) => { const k = keyFn(r); (g[k] ||= []).push(r) })
    return Object.entries(g).map(([k, arr]) => ({ k, ...rate(arr) })).sort((a, b) => b.n - a.n)
  }
  const answers = rows.map((r) => r.a).filter(Boolean)
  const drivers = DRIVERS.map(([k, rx]) => ({ k, n: answers.filter((a) => rx.test(a)).length })).filter((d) => d.n).sort((a, b) => b.n - a.n)
  const grades = { logic_ok: 0, timing: 0, logic_bad: 0 }
  days.forEach((e) => { if (e.grade && grades[e.grade] !== undefined) grades[e.grade]++ })
  return {
    days: days.length, streak, answered: answers.length, total: rows.length,
    preds: preds.length, pending: preds.filter((r) => r.o?.pending).length,
    overall: rate(preds),
    byAsset: group((r) => ASSETS[r.pred.asset]?.name || r.pred.asset),
    byType: group((r) => ({ flow: '資金流向題', asset: '美元/黃金/加密題' }[r.type] || '市場推敲題')),
    byH: group((r) => `${r.pred.h} 日`),
    byConf: group((r) => `信心${CONF[r.pred.conf || 2]}`),
    byEvent: group((r) => (r.events.length ? '事件日' : '一般日')),
    byDir: group((r) => DIRS[r.pred.dir]),
    drivers, grades,
    summaries: Object.values(entries || {}).filter((e) => e.summary && (e.summary.theme?.trim() || e.summary.plan?.trim() || e.summary.bias)).length,
    sumCalls: (() => {
      const calls = summaryCalls(entries, metrics)
      const done = calls.filter((c) => c.o && !c.o.pending && c.o.hit !== null)
      const hit = done.filter((c) => c.o.hit).length
      const by = {}
      done.forEach((c) => { (by[c.kind] ||= { k: c.kind, n: 0, hit: 0 }); by[c.kind].n++; if (c.o.hit) by[c.kind].hit++ })
      return { n: done.length, hit, pct: done.length ? hit / done.length : null, pending: calls.filter((c) => c.o?.pending).length,
        by: Object.values(by).map((g) => ({ ...g, pct: g.hit / g.n })) }
    })(),
    misses: preds.filter((r) => r.o && !r.o.pending && r.o.hit === false).sort((a, b) => Math.abs(b.o.z) - Math.abs(a.o.z)),
    unreviewed: days.filter((e) => !e.review?.trim() && e.predictions?.some((p) => p?.dir)).map((e) => e.date),
  }
}

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`)

export function summaryText(st, label) {
  const lines = []
  lines.push(`【${label}總結】作答 ${st.days} 天、${st.answered} 題；做出 ${st.preds} 個預判，已到期 ${st.overall.n} 個，命中 ${st.overall.hit} 個（命中率 ${pct(st.overall.pct)}）${st.pending ? `，另有 ${st.pending} 個尚未到期` : ''}。`)
  const ok = st.byAsset.filter((g) => g.n >= 2)
  if (ok.length) {
    const best = [...ok].sort((a, b) => b.pct - a.pct)[0]
    const worst = [...ok].sort((a, b) => a.pct - b.pct)[0]
    if (best.k !== worst.k) lines.push(`最準的資產：${best.k}（${best.hit}/${best.n}）；最常判斷錯：${worst.k}（${worst.hit}/${worst.n}）。`)
  }
  const hs = st.byH.filter((g) => g.n >= 2)
  if (hs.length >= 2) {
    const b = [...hs].sort((a, b) => b.pct - a.pct)[0]
    lines.push(`在 ${b.k} 的預判期間表現最好（${pct(b.pct)}），可以考慮以這個週期作為主要判斷框架。`)
  }
  const cf = Object.fromEntries(st.byConf.map((g) => [g.k, g]))
  if (cf['信心高']?.n >= 2 && cf['信心低']?.n >= 2) {
    const d = cf['信心高'].pct - cf['信心低'].pct
    lines.push(d > 0.1 ? `信心校準良好：高信心命中 ${pct(cf['信心高'].pct)}，高於低信心的 ${pct(cf['信心低'].pct)}。`
      : `信心校準需要注意：高信心命中 ${pct(cf['信心高'].pct)} 並未明顯高於低信心 ${pct(cf['信心低'].pct)}，可能有過度自信的情形。`)
  }
  const ev = Object.fromEntries(st.byEvent.map((g) => [g.k, g]))
  if (ev['事件日']?.n >= 2 && ev['一般日']?.n >= 2) lines.push(`事件日命中 ${pct(ev['事件日'].pct)}、一般日 ${pct(ev['一般日'].pct)}。`)
  if (st.drivers.length) lines.push(`你最常用的解釋框架：${st.drivers.slice(0, 3).map((d) => `${d.k}（${d.n} 次）`).join('、')}${st.drivers.length < 4 ? '；可以多嘗試其他角度，避免單一框架盲點' : ''}。`)
  const g = st.grades
  if (g.logic_ok + g.timing + g.logic_bad) lines.push(`事後自評：邏輯正確 ${g.logic_ok} 天、方向對但時機錯 ${g.timing} 天、邏輯錯誤 ${g.logic_bad} 天。`)
  if (st.misses.length) lines.push(`偏差最大的一次：${st.misses[0].date} 預判 ${ASSETS[st.misses[0].pred.asset]?.name} ${DIRS[st.misses[0].pred.dir]}，實際 ${fmtMove(st.misses[0].o)}（${st.misses[0].o.z.toFixed(1)}σ），值得回頭重讀。`)
  if (st.unreviewed.length) lines.push(`尚有 ${st.unreviewed.length} 天的預判還沒寫事後檢討。`)
  if (st.summaries) {
    const sc = st.sumCalls
    lines.push(`寫了 ${st.summaries} 天的總結；總結中的方向與看好/看壞判斷（5 日驗證）已到期 ${sc.n} 個，命中 ${sc.hit} 個（${pct(sc.pct)}）${sc.pending ? `，${sc.pending} 個未到期` : ''}。`)
  }
  if (!st.preds) lines.push('目前還沒有預判紀錄：作答時在每題下方選「我的判斷」，系統才能自動驗證命中率。')
  return lines
}

export function aiPrompt(rows, st, label) {
  const lines = [
    `以下是我的「每日總經推敲日誌」${label}紀錄。請扮演資深總經交易教練，幫我：`,
    '1) 找出我反覆出現的推理錯誤或盲點；2) 指出哪類判斷我最有優勢；3) 根據命中/落空案例，給我 3 條具體可執行的改進建議。',
    '請只根據下列資料分析，不要捏造市場數字。', '',
    `## 統計`, ...summaryText(st, label).map((l) => `- ${l}`), '', '## 逐題紀錄',
  ]
  const byDate = {}
  rows.forEach((r) => (byDate[r.date] ||= []).push(r))
  for (const [d, arr] of Object.entries(byDate)) {
    lines.push(`### ${d}${arr[0].events.length ? `（${arr[0].events.join('/')}）` : ''}`)
    arr.forEach((r) => {
      lines.push(`- Q${r.i + 1}[${r.type === 'flow' ? '資金流向' : '市場'}] ${r.q}`)
      lines.push(`  - 我的回答：${r.a || '（未作答）'}`)
      if (r.pred) {
        const o = r.o
        const res = !o ? '無資料' : o.pending ? `未到期（還差 ${o.left} 日）` : `${o.hit === null ? '雜訊內' : o.hit ? '命中' : '落空'}，實際 ${fmtMove(o)}（${o.z.toFixed(1)}σ）`
        lines.push(`  - 預判：${ASSETS[r.pred.asset]?.name} ${DIRS[r.pred.dir]}，${r.pred.h} 日，信心${CONF[r.pred.conf || 2]} → ${res}`)
      }
    })
    const sm = arr[0].summary
    if (sm && (sm.theme || sm.plan || sm.bias)) {
      lines.push(`- 當日總結：主軸「${sm.theme || '—'}」；方向 ${({ bull: '偏多', neutral: '中性', bear: '偏空' })[sm.bias] || '—'}；看好 ${(sm.long || []).map((k) => ASSETS[k]?.name).join('、') || '—'}；看壞 ${(sm.short || []).map((k) => ASSETS[k]?.name).join('、') || '—'}`)
      if (sm.plan) lines.push(`  - 策略：${sm.plan}`)
      if (sm.invalidation) lines.push(`  - 失效條件：${sm.invalidation}`)
    }
    if (arr[0].note) lines.push(`- 事後檢討：${arr[0].note}`)
  }
  return lines.join('\n')
}
