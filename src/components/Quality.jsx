import { Panel, CheckLine } from './bits'
import { STATUS, twTime } from '../lib/util'

export default function Quality({ market }) {
  const rows = [...Object.values(market.metrics), ...Object.values(market.macro), ...Object.values(market.flows || {})]
  const sum = market.quality.summary
  return (
    <div className="space-y-3">
      <Panel title="資料交叉比對報告" right={<span className="text-[11px] text-muted">產出於 {twTime(market.updated)}（台北）</span>}>
        <p className="text-[12px] text-ink2 mb-2">
          每次更新都會把同一指標的兩個獨立來源，放在「同一個日期」比較；超出容忍度會標 ⚠ 並列出兩邊數值，請以官方來源為準。
          無法免費取得第二來源的指標會誠實標示「單一來源」。
        </p>
        <div className="flex gap-2 flex-wrap mb-3">
          {Object.entries(sum).map(([k, n]) => n > 0 && (
            <span key={k} className="text-[12px] px-2 py-1 rounded bg-surface2">
              <span style={{ color: STATUS[k]?.c }}>{STATUS[k]?.icon}</span> {STATUS[k]?.label} {n}
            </span>
          ))}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="text-muted text-left">
              <tr><th className="py-1 pr-2">指標</th><th className="pr-2">主來源</th><th className="pr-2">狀態</th><th>比對明細</th></tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.key} className="border-t border-line align-top">
                  <td className="py-1.5 pr-2 text-ink whitespace-nowrap">{m.name}</td>
                  <td className="pr-2 text-ink2">{m.source}</td>
                  <td className="pr-2 whitespace-nowrap" style={{ color: STATUS[m.status]?.c }}>{STATUS[m.status]?.icon} {STATUS[m.status]?.label}</td>
                  <td className="py-1">{(m.checks || []).map((c, i) => <CheckLine key={i} c={c} />)}{m.note && <span className="text-muted">{m.note}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
      {market.quality.errors?.length > 0 && (
        <Panel title="本次抓取失敗的來源">
          <ul className="text-[11px] text-muted num space-y-0.5">{market.quality.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </Panel>
      )}
    </div>
  )
}
