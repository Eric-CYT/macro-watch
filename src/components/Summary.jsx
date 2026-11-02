import { ASSETS, outcome, fmtMove } from '../lib/review'

export const BIAS = { bull: '偏多（Risk-on）', neutral: '中性／觀望', bear: '偏空（Risk-off）' }
const PICK = ['spx', 'sox', 'taiex', 'btc', 'gold', 'wti', 'copper', 'dxy', 'us10y', 'usdjpy', 'usdtwd']
const SUMMARY_H = 5 // 舊制總結以 5 個交易日驗證；新制（3 日一期）存 h: 3
export const AGREE = { agree: '同意', partial: '部分同意', disagree: '不同意' }

export const emptySummary = (h) => ({ theme: '', bias: null, long: [], short: [], plan: '', invalidation: '', agree: null, disagree: '', ...(h ? { h } : {}) })
export const summaryFilled = (s) => !!(s && (s.theme?.trim() || s.plan?.trim() || s.bias || s.long?.length || s.short?.length))

/** 總結欄位：可編輯或唯讀（唯讀時附 5 日驗證） */
export function SummaryBox({ value, onChange, readOnly, metrics, date, showAgree }) {
  const v = { ...emptySummary(), ...(value || {}) }
  const H = v.h || SUMMARY_H
  const set = (patch) => {
    const touched = 'bias' in patch || 'long' in patch || 'short' in patch
    onChange?.({ ...v, ...patch, ...(touched ? { t: new Date().toISOString() } : {}) })
  }
  const toggle = (key, k) => {
    const other = key === 'long' ? 'short' : 'long'
    const on = v[key].includes(k)
    set({ [key]: on ? v[key].filter((x) => x !== k) : [...v[key], k], [other]: v[other].filter((x) => x !== k) })
  }
  const chip = (on, color) => `text-[11px] px-2 py-0.5 rounded border ${on ? 'text-white' : 'border-line text-ink2'}` + (on ? ` ${color}` : '')

  if (readOnly) {
    if (!summaryFilled(v)) return <p className="text-[12px] text-muted">（未填寫總結）</p>
    return (
      <div className="space-y-1.5 text-[13px]">
        {v.theme && <p><span className="text-muted">市場主軸：</span>{v.theme}</p>}
        {v.bias && <p><span className="text-muted">整體方向：</span>{BIAS[v.bias]}　<Verdict metrics={metrics} date={date} pred={{ asset: 'spx', dir: v.bias === 'bull' ? 'up' : v.bias === 'bear' ? 'down' : 'flat', h: H, t: v.t }} label={`以美股 ${H} 日驗證`} /></p>}
        {v.long.length > 0 && <p><span className="text-muted">看好：</span>{v.long.map((k) => <span key={k} className="mr-2">{ASSETS[k]?.name}<Verdict metrics={metrics} date={date} pred={{ asset: k, dir: 'up', h: H, t: v.t }} /></span>)}</p>}
        {v.short.length > 0 && <p><span className="text-muted">看壞：</span>{v.short.map((k) => <span key={k} className="mr-2">{ASSETS[k]?.name}<Verdict metrics={metrics} date={date} pred={{ asset: k, dir: 'down', h: H, t: v.t }} /></span>)}</p>}
        {v.plan && <p className="whitespace-pre-wrap"><span className="text-muted">策略：</span>{v.plan}</p>}
        {v.invalidation && <p className="whitespace-pre-wrap"><span className="text-muted">失效條件：</span>{v.invalidation}</p>}
        {v.agree && <p><span className="text-muted">對系統評估：</span>{AGREE[v.agree]}{v.disagree && `｜${v.disagree}`}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <input value={v.theme} onChange={(e) => set({ theme: e.target.value })} placeholder="市場主軸（一句話）：例如「利率高原期 + AI 估值修正，資金往防禦與美債移動」"
        className="w-full bg-bg border border-line rounded-lg px-2 py-1.5 text-[13px] placeholder:text-muted focus:outline-none focus:border-s1" />
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[11px] text-muted mr-1">{H === 3 ? '下一期（3 個交易日）整體方向' : '未來 1–2 週整體方向'}</span>
        {Object.entries(BIAS).map(([k, l]) => (
          <button key={k} type="button" onClick={() => set({ bias: v.bias === k ? null : k })}
            className={chip(v.bias === k, k === 'bull' ? 'bg-[var(--up)] border-[var(--up)]' : k === 'bear' ? 'bg-[var(--down)] border-[var(--down)]' : 'bg-s1 border-s1')}>{l}</button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[11px] text-muted mr-1 w-14">看好</span>
        {PICK.map((k) => <button key={k} type="button" onClick={() => toggle('long', k)}
          className={chip(v.long.includes(k), 'bg-[var(--up)] border-[var(--up)]')}>{ASSETS[k].name}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <span className="text-[11px] text-muted mr-1 w-14">看壞</span>
        {PICK.map((k) => <button key={k} type="button" onClick={() => toggle('short', k)}
          className={chip(v.short.includes(k), 'bg-[var(--down)] border-[var(--down)]')}>{ASSETS[k].name}</button>)}
      </div>
      <textarea value={v.plan} onChange={(e) => set({ plan: e.target.value })} rows={3}
        placeholder="策略與行動計畫：接下來要加碼／減碼／避險什麼？進場或調整的條件是什麼？"
        className="w-full bg-bg border border-line rounded-lg p-2 text-[13px] placeholder:text-muted focus:outline-none focus:border-s1" />
      <textarea value={v.invalidation} onChange={(e) => set({ invalidation: e.target.value })} rows={2}
        placeholder="觀察指標與失效條件：哪個數據或價位出現，代表這個判斷錯了？"
        className="w-full bg-bg border border-line rounded-lg p-2 text-[13px] placeholder:text-muted focus:outline-none focus:border-s1" />
      {showAgree && (
        <div className="rounded-lg bg-surface2 p-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[11px] text-ink2 mr-1">你同意上方「系統資金動向評估」嗎？</span>
            {Object.entries(AGREE).map(([k, l]) => (
              <button key={k} type="button" onClick={() => set({ agree: v.agree === k ? null : k })}
                className={chip(v.agree === k, 'bg-s1 border-s1')}>{l}</button>
            ))}
          </div>
          {v.agree && v.agree !== 'agree' && (
            <textarea value={v.disagree} onChange={(e) => set({ disagree: e.target.value })} rows={2}
              placeholder="哪裡不同意？系統漏看了什麼（事件、部位、政策）？"
              className="mt-1 w-full bg-bg border border-line rounded-lg p-2 text-[13px] placeholder:text-muted focus:outline-none focus:border-s1" />
          )}
        </div>
      )}
      <p className="text-[10px] text-muted">「整體方向」以美股、「看好／看壞」以各資產在 {H} 個交易日後的實際走勢自動驗證（利率類看好 = 殖利率上升）。</p>
    </div>
  )
}

function Verdict({ metrics, date, pred, label }) {
  const o = outcome(metrics, pred, date)
  if (!o) return null
  if (o.pending) return <span className="text-[11px] text-muted ml-1">⏳{o.left}日後驗證</span>
  const c = o.hit === null ? 'var(--color-muted)' : o.hit ? 'var(--color-good)' : 'var(--color-critical)'
  return <span className="text-[11px] ml-1 num" style={{ color: c }}>{o.hit === null ? '○' : o.hit ? '✓' : '✗'} {fmtMove(o)}{label ? `（${label}）` : ''}</span>
}

export const SUMMARY_HORIZON = SUMMARY_H
