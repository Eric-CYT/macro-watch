import { useMemo, useState } from 'react'
import { HORIZONS, BUCKET_LABEL, forecastGroup, verdict } from '../lib/forecast'
import { RADAR_ASSETS, radarSeries } from '../lib/flowRadar'
import { cryptoBasket } from '../lib/flowRadar'

const GROUPS = [['overview', '7 大市場'], ['taiex', '台股產業'], ['spx', '美股類股'], ['crypto', '加密'], ['dxy', '匯率'], ['gold', '貴金屬'], ['us10y', '美債'], ['wti', '能源']]
const PARENT = { spx: 'spx', taiex: 'taiex', gold: 'gold', wti: 'wti', crypto: 'crypto' }
const P = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`)
const sg = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}σ`)

function groupItems(key, metrics, weights, drill) {
  if (key === 'overview') {
    const { hist } = radarSeries(metrics, weights)
    return { items: RADAR_ASSETS.map((a) => ({ k: a.k, label: a.label, history: hist(a), mode: a.bond ? 'bond' : 'price' })), parent: null }
  }
  let items = drill?.[key]?.items || []
  if (key === 'dxy' && metrics?.dxy?.history) items = [{ k: 'usd', label: '美元', history: metrics.dxy.history, mode: 'price' }, ...items]
  const pk = PARENT[key]
  const parent = pk ? (pk === 'crypto' ? cryptoBasket(metrics, weights)?.history : metrics?.[pk]?.history) : null
  return { items, parent }
}

export function Forecast({ metrics, weights, drill }) {
  const [open, setOpen] = useState(false)
  const [g, setG] = useState('overview')
  const [H, setH] = useState(20)
  const res = useMemo(() => {
    if (!open) return null
    const { items, parent } = groupItems(g, metrics, weights, drill)
    return items.length ? forecastGroup(items, parent) : null
  }, [open, g, metrics, weights, drill])
  const r = res?.[H]
  const va = r?.valid?.abs, vr = r?.valid?.rel
  const skillOk = (v) => v && v.skill > 0
  const rows = r ? [...r.rows].sort((a, b) => (b.pUp ?? -1) - (a.pUp ?? -1)) : []
  return (
    <details className="mt-3" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="text-[12px] text-s1 cursor-pointer">板塊方向預估：接下來 5／10／20／30 日，哪些可能上漲、哪些可能下跌？（含歷史驗證）</summary>
      {open && (
        <div className="mt-2">
          <div className="flex flex-wrap gap-1 items-center">
            {GROUPS.map(([k, l]) => <button key={k} onClick={() => setG(k)} className={`text-[11px] px-2 py-0.5 rounded ${g === k ? 'bg-s1 text-white' : 'bg-surface2 text-ink2'}`}>{l}</button>)}
            <span className="mx-1 text-muted">｜</span>
            {HORIZONS.map((h) => <button key={h} onClick={() => setH(h)} className={`text-[11px] px-2 py-0.5 rounded ${H === h ? 'bg-s1 text-white' : 'bg-surface2 text-ink2'}`}>{h} 日</button>)}
          </div>
          {!r ? <p className="text-[12px] text-muted mt-2">這一組的歷史資料尚未載入或不足。</p> : (
            <>
              <div className={`mt-2 rounded-lg px-3 py-2 text-[12px] border ${skillOk(va) ? 'border-good/40' : 'border-warning/40'}`}>
                {skillOk(va)
                  ? <span className="text-good">✓ 這組 {H} 日的訊號在歷史上有預測力</span>
                  : <span className="text-warning">⚠ 這組 {H} 日的訊號在歷史上「沒有」預測力：下方機率只是歷史統計，不要當成買賣訊號</span>}
                <span className="block text-ink2 mt-0.5 num">
                  走動式驗證（後半段，每天只用當時已知資料）：Brier 技能 {va ? va.skill.toFixed(3) : '—'}（&gt;0＝比只猜「基本上漲率 {P(r.base)}」準）
                  ；明確判斷 {va?.calls ?? 0} 次、命中 {P(va?.hitRate)}；有效獨立樣本約 {va?.eff ?? 0}
                  {vr && <>｜相對母市場：技能 {vr.skill.toFixed(3)}、命中 {P(vr.hitRate)}</>}
                </span>
              </div>
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-[12px]">
                  <thead className="text-muted"><tr>
                    <th className="text-left font-normal py-1">項目</th><th className="font-normal">過去 {H} 日 σ</th>
                    <th className="font-normal">歷史相似情況 {H} 日後上漲機率</th><th className="font-normal">方向</th>
                    {vr && <><th className="font-normal">相對 σ</th><th className="font-normal">勝過母市場機率</th></>}
                  </tr></thead>
                  <tbody>
                    {rows.map((x) => {
                      const v = verdict(x.pUp, x.n, va)
                      const vb = vr ? verdict(x.pBeat, x.nr, vr) : null
                      return (
                        <tr key={x.k} className="border-t border-line num text-center">
                          <td className="text-left py-1 text-ink">{x.label}</td>
                          <td className="text-ink2">{sg(x.z)}</td>
                          <td className="text-ink2">{P(x.pUp)}<span className="text-muted text-[10px]">（{x.n} 次）</span></td>
                          <td className={v.c === 'muted' ? 'text-muted' : v.c}>{v.t}</td>
                          {vr && <><td className="text-ink2">{sg(x.zr)}</td>
                            <td className={vb.c === 'muted' ? 'text-muted' : vb.c}>{P(x.pBeat)}{x.pBeat != null && (x.pBeat >= 0.6 || x.pBeat <= 0.4) && skillOk(vr) ? (x.pBeat >= 0.6 ? '・強於大盤' : '・弱於大盤') : ''}</td></>}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <details className="mt-1">
                <summary className="text-[11px] text-muted cursor-pointer">這組歷史上各 σ 區間之後 {H} 日的上漲比例</summary>
                <div className="flex flex-wrap gap-2 text-[11px] mt-1 num">
                  {r.tb.map((b, i) => <span key={i} className="bg-surface2 rounded px-2 py-0.5">{BUCKET_LABEL[i]}：{b.n ? P(b.up / b.n) : '—'}（{b.n}）</span>)}
                </div>
              </details>
              <p className="text-[10px] text-muted leading-relaxed mt-1">
                算法：把這一組所有項目、所有歷史日期依「過去 {H} 日 σ」分成 5 個區間，統計每個區間之後 {H} 日上漲的比例，目前落在哪個區間就給那個機率（樣本少時往基本上漲率收斂）。
                機率 ≥60％ 標「偏上漲」、≤40％ 標「偏下跌」；只有在走動式驗證技能 &gt;0 且樣本 ≥20 時才算有效，否則標「弱」。資料約 1–2 年、相鄰期間重疊，30 日的獨立樣本特別少。這是統計參考，不是投資建議。
              </p>
            </>
          )}
        </div>
      )}
    </details>
  )
}
