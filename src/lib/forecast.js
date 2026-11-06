/**
 * 板塊方向預估（5／10／20／30 日）—— 歷史條件機率模型，完全透明、可驗證
 * ─────────────────────────────────────────────
 * 1. 訊號：每個項目「過去 H 日」的資金流向 σ（與雷達同算法），以及相對母市場的 σ
 * 2. 分組：σ 分成 5 個區間（≤−1、−1~−0.25、±0.25、0.25~1、≥1）
 * 3. 機率：同一組（例如美股 8 大類股）所有項目、所有歷史日期中，σ 落在同區間後
 *          「接下來 H 日上漲」的比例 → 目前落在該區間的項目，就給這個機率
 * 4. 驗證：走動式（walk-forward）——每個歷史日期只用「當時已知」的資料建表再預測，
 *          和「只用基本上漲率」的天真預測比較 Brier 分數；贏不了就明說「沒有預測力」
 * 限制：資料約 1–2 年，相鄰樣本期間重疊，20／30 日的有效獨立樣本很少。
 */
import { windowScore, ratioSeries } from './flowRadar'

export const HORIZONS = [5, 10, 20, 30]
const EDGES = [-1, -0.25, 0.25, 1]
export const BUCKET_LABEL = ['≤−1σ 明顯流出', '−1～−0.25σ 偏流出', '±0.25σ 持平', '0.25～1σ 偏流入', '≥+1σ 明顯流入']
const bucket = (z) => (z <= EDGES[0] ? 0 : z < EDGES[1] ? 1 : z <= EDGES[2] ? 2 : z < EDGES[3] ? 3 : 4)
const MIN_N = 20

/** 單一序列：每個可用日期 t 的 (σ, 未來 H 日是否上漲)；σ 只用 t 以前的資料 */
function samples(h, H, bond) {
  const out = []
  if (!h || h.length < 62 + H + 2) return out
  const v = h.map((x) => x[1])
  for (let t = 61 + H; t < h.length; t++) {
    const s = windowScore(h, H, bond, t)
    if (!s) continue
    const j = t + H
    const fwd = j < h.length ? (bond ? -(v[j] - v[t]) : v[j] / v[t] - 1) : null
    out.push({ t, d: h[t][0], z: s.z, up: fwd == null ? null : fwd > 0 ? 1 : fwd < 0 ? 0 : null, fwdDate: j < h.length ? h[j][0] : null })
  }
  return out
}

/** 由樣本建立「區間 → 上漲次數／總數」表（只收 fwdDate ≤ cutoff 的樣本，避免偷看未來） */
function table(list, cutoff) {
  const tb = Array.from({ length: 5 }, () => ({ up: 0, n: 0 }))
  let up = 0, n = 0
  for (const s of list) {
    if (s.up == null || (cutoff && s.fwdDate > cutoff)) continue
    const b = tb[bucket(s.z)]
    b.n++; b.up += s.up; n++; up += s.up
  }
  return { tb, base: n ? up / n : null, n }
}

/** 機率：樣本不足時往基本上漲率收斂（貝氏平滑，先驗強度 10 筆） */
function prob(tb, base, z) {
  const b = tb[bucket(z)]
  const k = 10
  return { p: (b.up + k * base) / (b.n + k), n: b.n }
}

/** 走動式驗證：後半段每個日期只用「當時已到期」的樣本建表再預測（增量更新，O(n log n)）
 *  回傳 Brier 技能分數（>0＝比只猜基本上漲率好）與方向命中率 */
function walkForward(allSamples, H) {
  const valid = allSamples.filter((s) => s.up != null)
  if (!valid.length) return null
  const dates = [...new Set(valid.map((s) => s.d))].sort()
  const start = dates[Math.floor(dates.length * 0.5)]
  const byFwd = [...valid].sort((a, b) => (a.fwdDate < b.fwdDate ? -1 : 1))
  const tests = valid.filter((s) => s.d >= start).sort((a, b) => (a.d < b.d ? -1 : 1))
  const tb = Array.from({ length: 5 }, () => ({ up: 0, n: 0 }))
  let up = 0, nn = 0, j = 0
  let bm = 0, bb = 0, n = 0, calls = 0, hits = 0
  for (const s of tests) {
    while (j < byFwd.length && byFwd[j].fwdDate <= s.d) { const x = byFwd[j++]; const b = tb[bucket(x.z)]; b.n++; b.up += x.up; nn++; up += x.up }
    if (nn < MIN_N * 3) continue
    const base = up / nn
    const { p } = prob(tb, base, s.z)
    bm += (p - s.up) ** 2; bb += (base - s.up) ** 2; n++
    if (p >= 0.6 || p <= 0.4) { calls++; if ((p >= 0.6) === (s.up === 1)) hits++ }
  }
  if (!n || !bb) return null
  return { n, skill: 1 - bm / bb, hitRate: calls ? hits / calls : null, calls, eff: Math.round(n / H) }
}

/**
 * items: [{k,label,history,mode}]；parent：母市場序列（可為 null）
 * 回傳 {H: {rows:[...], base, valid:{abs, rel}}}
 */
export function forecastGroup(items, parent) {
  const res = {}
  const usable = items.filter((it) => it.mode !== 'supply')
  for (const H of HORIZONS) {
    const absS = {}, relS = {}
    for (const it of usable) {
      const bond = it.mode === 'bond'
      absS[it.k] = samples(it.history, H, bond)
      const rs = parent && !bond ? ratioSeries(it.history, parent) : null
      relS[it.k] = rs ? samples(rs, H, false) : []
    }
    const poolA = Object.values(absS).flat(), poolR = Object.values(relS).flat()
    const A = table(poolA), R = table(poolR)
    const rows = usable.map((it) => {
      const a = absS[it.k].at(-1), r = relS[it.k].at(-1)
      const pa = a && A.base != null ? prob(A.tb, A.base, a.z) : null
      const pr = r && R.base != null ? prob(R.tb, R.base, r.z) : null
      return { k: it.k, label: it.label, z: a?.z ?? null, zr: r?.z ?? null, asOf: a?.d, pUp: pa?.p ?? null, n: pa?.n ?? 0, pBeat: pr?.p ?? null, nr: pr?.n ?? 0 }
    })
    res[H] = {
      rows, base: A.base, baseRel: R.base, nAll: A.n, tb: A.tb,
      valid: { abs: walkForward(poolA, H), rel: poolR.length ? walkForward(poolR, H) : null },
    }
  }
  return res
}

/** 依機率與模型可信度給出結論 */
export function verdict(p, n, valid) {
  if (p == null) return { t: '資料不足', c: 'muted' }
  const ok = valid && valid.skill > 0 && n >= MIN_N
  if (p >= 0.6) return { t: ok ? '偏上漲' : '偏上漲（弱）', c: ok ? 'up' : 'muted' }
  if (p <= 0.4) return { t: ok ? '偏下跌' : '偏下跌（弱）', c: ok ? 'down' : 'muted' }
  return { t: '不明確', c: 'muted' }
}
