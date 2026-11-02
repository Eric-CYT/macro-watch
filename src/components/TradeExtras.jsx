import { useMemo, useState } from 'react'
import { Panel } from './bits'
import { fmt } from '../lib/util'
import { INSTRUMENTS, sizePosition, tradeResult, perfStats, processMatrix, side } from '../lib/position'
import { MARKETS, marketName } from '../lib/trades'

const inp = 'bg-bg border border-line rounded-lg px-2 py-1.5 text-[13px] text-ink placeholder:text-muted focus:outline-none focus:border-s1'
const AKEY = 'mdj.acct.v1'
export const loadAcct = () => { try { return JSON.parse(localStorage.getItem(AKEY) || 'null') } catch { return null } }
const saveAcct = (a) => { try { localStorage.setItem(AKEY, JSON.stringify(a)) } catch { /* ignore */ } }
const money = (v) => (v == null ? '—' : `${v < 0 ? '−' : ''}${Math.round(Math.abs(v)).toLocaleString()}`)
const Rtxt = (r) => (r == null ? '—' : `${r > 0 ? '+' : ''}${r.toFixed(2)}R`)
const pv = (pos) => INSTRUMENTS[pos?.inst]?.pv ?? (Number(pos?.pv) || null)

/* ---------------------------------------------------------------- 下單前：部位計算 */
export function Sizing({ t, set }) {
  const pos = t.pos
  const r = useMemo(() => sizePosition({ ...pos, entry: t.q7.entry, stop: t.q7.stop, t1: t.q12.t1, t2: t.q12.t2 }),
    [pos, t.q7.entry, t.q7.stop, t.q12.t1, t.q12.t2])
  const upd = (patch) => {
    set('pos', patch)
    if ('equity' in patch || 'riskPct' in patch) saveAcct({ ...loadAcct(), ...patch })
  }
  const I = INSTRUMENTS[pos.inst] || INSTRUMENTS.custom
  const warn = []
  if (Number(pos.riskPct) > 2) warn.push('單筆風險超過 2%：連虧 5 筆會回撤 10% 以上')
  if (r?.rr1 != null && r.rr1 < 1.5) warn.push(`第一目標風報比只有 ${r.rr1.toFixed(2)}，低於 1.5 需要很高勝率才划算`)
  if (r && r.qty === 0) warn.push('風險預算不足以承擔 1 單位：防守太遠或商品太大，考慮換小一級商品')
  if (r?.rr1 != null && r.rr1 <= 0) warn.push('獲利價在防守位同一側，方向矛盾')
  return (
    <div className="rounded-xl border border-line p-3 mt-3 bg-bg/40">
      <div className="text-[14px] text-ink font-medium mb-2">部位計算（用第 7 題進場／防守、第 12 題獲利價）</div>
      <div className="flex flex-wrap gap-2 items-center text-[12px] text-muted">
        <label className="flex items-center gap-1">帳戶資金
          <input type="number" inputMode="decimal" value={pos.equity} onChange={(e) => upd({ equity: e.target.value })} className={`${inp} w-32 num`} placeholder="例 1000000" /></label>
        <label className="flex items-center gap-1">單筆風險
          <input type="number" inputMode="decimal" step="0.1" value={pos.riskPct} onChange={(e) => upd({ riskPct: e.target.value })} className={`${inp} w-16 num`} />%</label>
        <select value={pos.inst} onChange={(e) => upd({ inst: e.target.value })} className={`${inp} pr-6`} aria-label="商品規格">
          {Object.entries(INSTRUMENTS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
        </select>
        {pos.inst === 'custom' && <label className="flex items-center gap-1">每點價值
          <input type="number" inputMode="decimal" value={pos.pv} onChange={(e) => upd({ pv: e.target.value })} className={`${inp} w-24 num`} placeholder="例 1 或 50" /></label>}
      </div>
      {!r ? <p className="text-[12px] text-muted mt-2">填入第 7 題的進場價與防守位後自動計算。</p> : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-[12px]">
          <Box l="方向">{r.dir === 'long' ? <span className="up">做多</span> : <span className="down">做空</span>}</Box>
          <Box l={`每${I.unit}風險`}>{fmt(r.riskPts, 2)} 點 × {r.pv} ＝ {money(r.riskPerUnit)}</Box>
          <Box l="風險預算">{money(r.budget)}</Box>
          <Box l="建議部位"><b className="text-ink text-[15px]">{r.qty ?? '—'}</b> {I.unit}</Box>
          <Box l="實際最大虧損">{money(r.riskAmt)}</Box>
          <Box l="名目價值">{money(r.notional)}</Box>
          <Box l="風報比（目標 1）">{r.rr1 == null ? '—' : `1 : ${r.rr1.toFixed(2)}`}</Box>
          <Box l="風報比（目標 2）">{r.rr2 == null ? '—' : `1 : ${r.rr2.toFixed(2)}`}</Box>
        </div>
      )}
      {warn.map((w) => <p key={w} className="text-[12px] text-warning mt-1">⚠ {w}</p>)}
      <p className="text-[10px] text-muted mt-1">台指期每點：大台 200、小台 50、微台 10 元（期交所契約規格）。部位無條件捨去，確保虧損不超過預算；未含手續費、期交稅與滑價。</p>
    </div>
  )
}
const Box = ({ l, children }) => <div className="bg-surface2 rounded px-2 py-1"><div className="text-[10px] text-muted">{l}</div><div className="num text-ink2">{children}</div></div>

/* ---------------------------------------------------------------- 下單後：結果紀錄 */
export const STATUS = ['未進場', '持有中', '已出場']
export const REASONS = ['觸及獲利價', '觸及防守位', '移動停利', '時間到／條件消失', '主觀提早出場', '其他']
export const PLAN = ['完全照計畫', '部分偏離', '沒照計畫']
export const EMOTION = ['平靜', '猶豫', '急躁／追價', '恐懼', '貪婪', '報復性交易']

/** 由紀錄算出結果（供列表與統計共用） */
export function resultOf(t) {
  const res = t.result
  if (!res || res.status !== '已出場') return null
  const dir = side(res.entry || t.q7.entry, t.q7.stop) || side(t.q7.entry, t.q7.stop)
  const qty = res.qty || sizePosition({ ...t.pos, entry: t.q7.entry, stop: t.q7.stop })?.qty
  return tradeResult({ dir, entry: res.entry || t.q7.entry, stop: t.q7.stop, exit: res.exit, qty, pv: pv(t.pos), cost: res.cost })
}

export function ResultEditor({ t, onSave }) {
  const [r, setR] = useState(() => ({ status: '未進場', entry: '', qty: '', exit: '', exitDate: '', cost: '', reason: '', plan: '', emotion: '', lesson: '', ...(t.result || {}) }))
  const [saved, setSaved] = useState('')
  const u = (p) => setR((o) => ({ ...o, ...p }))
  const preview = resultOf({ ...t, result: r })
  const planQty = sizePosition({ ...t.pos, entry: t.q7.entry, stop: t.q7.stop })?.qty
  const chip = (opts, key) => (
    <div className="flex flex-wrap gap-1">
      {opts.map((o) => <button key={o} type="button" onClick={() => u({ [key]: r[key] === o ? '' : o })}
        className={`text-[11px] px-2 py-0.5 rounded ${r[key] === o ? 'bg-s1 text-white' : 'bg-bg text-ink2'}`}>{o}</button>)}
    </div>
  )
  return (
    <div className="mt-2 rounded-lg border border-line p-2 space-y-2">
      <div className="text-[13px] text-ink">交易結果與檢討</div>
      {chip(STATUS, 'status')}
      {r.status !== '未進場' && (
        <div className="flex flex-wrap gap-2 text-[12px] text-muted items-center">
          <label className="flex items-center gap-1">實際進場<input type="number" inputMode="decimal" value={r.entry} onChange={(e) => u({ entry: e.target.value })} placeholder={t.q7.entry || ''} className={`${inp} w-24 num`} /></label>
          <label className="flex items-center gap-1">數量<input type="number" inputMode="decimal" value={r.qty} onChange={(e) => u({ qty: e.target.value })} placeholder={planQty != null ? String(planQty) : ''} className={`${inp} w-16 num`} /></label>
          {r.status === '已出場' && <>
            <label className="flex items-center gap-1">出場價<input type="number" inputMode="decimal" value={r.exit} onChange={(e) => u({ exit: e.target.value })} className={`${inp} w-24 num`} /></label>
            <label className="flex items-center gap-1">出場日<input type="date" value={r.exitDate} onChange={(e) => u({ exitDate: e.target.value })} className={`${inp} [color-scheme:dark]`} /></label>
            <label className="flex items-center gap-1">手續費＋稅<input type="number" inputMode="decimal" value={r.cost} onChange={(e) => u({ cost: e.target.value })} placeholder="來回合計" className={`${inp} w-24 num`} /></label>
          </>}
        </div>
      )}
      {r.status === '已出場' && <>
        <div className="text-[12px] text-muted">出場原因</div>{chip(REASONS, 'reason')}
        <div className="text-[12px] text-muted">有沒有照計畫？（判斷「過程」而不是「結果」）</div>{chip(PLAN, 'plan')}
        <div className="text-[12px] text-muted">當下情緒</div>{chip(EMOTION, 'emotion')}
      </>}
      <textarea value={r.lesson} onChange={(e) => u({ lesson: e.target.value })} rows={2} placeholder="這筆學到什麼？下次哪裡要改？" className={`${inp} w-full`} />
      {preview && (
        <p className="text-[12px] num">
          損益 <b className={preview.net > 0 ? 'up' : preview.net < 0 ? 'down' : ''}>{money(preview.net)}</b>（{fmt(preview.pts, 2)} 點，成本 {money(preview.cost)}）
          ｜ <b className={preview.R > 0 ? 'up' : preview.R < 0 ? 'down' : ''}>{Rtxt(preview.R)}</b>
          {preview.R == null && <span className="text-muted">（缺防守位，無法算 R）</span>}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button onClick={() => { onSave(r); setSaved('已儲存 ✓'); setTimeout(() => setSaved(''), 2500) }} className="px-3 py-1 rounded bg-s1 text-white text-[12px]">儲存結果</button>
        <span className="text-[12px] text-good">{saved}</span>
      </div>
    </div>
  )
}

export function SnapLine({ s }) {
  if (!s) return null
  const it = [['VIX', s.vix, 2], ['DXY', s.dxy, 2], ['10Y', s.us10y, 2], ['HY利差', s.hy, 2], ['淨流動性', s.netliq, 3, '兆'],
    ['外資台指期', s.txfForeign, 0, '口'], ['外資5日', s.instForeign5, 1, '億']].filter(([, v]) => v != null)
  return <p className="text-muted num">下單當下環境：{it.map(([l, v, d, u]) => `${l} ${fmt(v, d)}${u || ''}`).join('・')}</p>
}

/* ---------------------------------------------------------------- 績效統計 */
export function Performance({ list }) {
  const closed = list.filter((t) => !t.deleted && t.result?.status === '已出場')
  const rows = closed.map((t) => ({ t, r: resultOf(t) })).filter((x) => x.r)
    .sort((a, b) => ((a.t.result.exitDate || a.t.created_at) < (b.t.result.exitDate || b.t.created_at) ? -1 : 1))
  const st = perfStats(rows.map((x) => x.r))
  const pm = processMatrix(rows.map((x) => ({ plan: x.t.result.plan, net: x.r.net })))
  const byMkt = useMemo(() => {
    const g = {}
    for (const x of rows) (g[marketName(x.t)] ||= []).push(x.r)
    return Object.entries(g).map(([k, v]) => [k, perfStats(v)]).sort((a, b) => b[1].n - a[1].n)
  }, [rows])
  const open = list.filter((t) => !t.deleted && t.result?.status === '持有中').length
  const P = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`)
  return (
    <Panel title="交易績效（已出場）" right={<span className="text-[11px] text-muted">持有中 {open} 筆</span>}>
      {!st.n ? <p className="text-[12px] text-muted">還沒有已出場的交易。在下方紀錄展開後填「交易結果」，這裡就會統計勝率、期望值與過程品質。</p> : <>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
          <Box l={`勝率（${st.wins}勝 ${st.losses}敗${st.flat ? ` ${st.flat}平` : ''}）`}>{P(st.winRate)}</Box>
          <Box l="期望值（每筆平均 R）"><b className={st.expR > 0 ? 'up' : st.expR < 0 ? 'down' : ''}>{Rtxt(st.expR)}</b></Box>
          <Box l="平均賺 / 平均賠">{Rtxt(st.avgWinR)} / {Rtxt(st.avgLossR)}</Box>
          <Box l="獲利因子">{st.profitFactor == null ? '—' : st.profitFactor.toFixed(2)}</Box>
          <Box l="累計淨損益"><span className={st.net > 0 ? 'up' : st.net < 0 ? 'down' : ''}>{money(st.net)}</span></Box>
          <Box l="最大回撤（依出場順序）">{money(st.maxDD)}</Box>
          <Box l="最長連敗">{st.worstStreak} 筆</Box>
          <Box l="樣本">{st.n} 筆{st.n < 30 && <span className="text-muted">（&lt;30 參考性低）</span>}</Box>
        </div>
        <div className="mt-3 text-[12px]">
          <div className="text-ink2 mb-1">過程 vs 結果（只看「有沒有照計畫」，不看賺賠）</div>
          <div className="grid grid-cols-2 gap-1 max-w-md">
            <div className="rounded bg-surface2 p-2"><div className="text-good">照計畫・賺 {pm.goodWin}</div><div className="text-[10px] text-muted">應得的報酬</div></div>
            <div className="rounded bg-surface2 p-2"><div className="text-ink">照計畫・賠 {pm.goodLoss}</div><div className="text-[10px] text-muted">好交易，正常成本，別改系統</div></div>
            <div className="rounded bg-surface2 p-2"><div className="text-warning">沒照計畫・賺 {pm.badWin}</div><div className="text-[10px] text-muted">運氣，最危險：會強化壞習慣</div></div>
            <div className="rounded bg-surface2 p-2"><div className="text-critical">沒照計畫・賠 {pm.badLoss}</div><div className="text-[10px] text-muted">紀律問題，優先修正</div></div>
          </div>
        </div>
        {byMkt.length > 1 && (
          <table className="w-full text-[12px] mt-3">
            <thead className="text-muted"><tr><th className="text-left font-normal">市場</th><th className="font-normal">筆數</th><th className="font-normal">勝率</th><th className="font-normal">期望值</th><th className="font-normal">淨損益</th></tr></thead>
            <tbody>{byMkt.map(([k, s]) => (
              <tr key={k} className="border-t border-line text-center num"><td className="text-left py-1">{k}</td><td>{s.n}</td><td>{P(s.winRate)}</td>
                <td className={s.expR > 0 ? 'up' : s.expR < 0 ? 'down' : ''}>{Rtxt(s.expR)}</td><td>{money(s.net)}</td></tr>))}</tbody>
          </table>
        )}
        <p className="text-[10px] text-muted mt-2">期望值 ＝ 勝率 × 平均賺R ＋ 敗率 × 平均賠R；&gt; 0 才代表長期會賺。R ＝ 淨損益 ÷ 進場時的風險（進場價到防守位）。</p>
      </>}
    </Panel>
  )
}
export { MARKETS }
