/** 系統自動產生的「資金動向評估」 */
const REGIME_C = {
  risk_on: 'var(--up)', risk_off: 'var(--down)', deleverage: 'var(--color-critical)',
  liquidity_up: 'var(--color-good)', mixed: 'var(--color-muted)',
}
const LIQ_C = { 收緊: 'var(--color-critical)', 偏收緊: 'var(--color-serious)', 中性: 'var(--color-muted)', 偏寬鬆: 'var(--color-s3)', 寬鬆: 'var(--color-good)' }
const CHAIN_C = { 成立: 'var(--color-good)', '失效（背離）': 'var(--color-warning)', 不明顯: 'var(--color-muted)' }

export default function AssessmentCard({ a, compact }) {
  if (!a) return null
  const rows = Object.entries(a.rows || {}).sort((x, y) => y[1].z3 - x[1].z3)
  const lim = Math.max(2, ...rows.map(([, r]) => Math.abs(r.z3)))
  return (
    <div className="rounded-lg border border-line bg-bg p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-semibold text-ink">系統資金動向評估</span>
        <Pill c={REGIME_C[a.regime]}>{a.regime_txt}</Pill>
        <Pill c={LIQ_C[a.liquidity]}>流動性：{a.liquidity}</Pill>
        <span className="text-[10px] text-muted">以 {a.cycle} 個交易日計算</span>
      </div>

      <ul className="text-[13px] text-ink space-y-1 leading-relaxed">
        {a.text.map((l, i) => <li key={i}>{i === 0 ? '🧭 ' : '• '}{l}</li>)}
      </ul>

      {!compact && (
        <>
          <div>
            <div className="text-[11px] text-muted mb-1">各市場資金流向（本期 {a.cycle} 日 σ，與近 20 日比較）</div>
            <div className="space-y-1">
              {rows.map(([k, r]) => (
                <div key={k} className="grid grid-cols-[88px_1fr_70px] sm:grid-cols-[110px_1fr_88px_150px] items-center gap-2 text-[12px]">
                  <span className="text-ink2 truncate">{r.name}</span>
                  <div className="relative h-3 bg-surface2 rounded">
                    <div className="absolute top-0 bottom-0 left-1/2 w-px bg-line" />
                    <div className="absolute top-0 bottom-0 rounded" style={{
                      left: r.z3 >= 0 ? '50%' : `${50 - (Math.abs(r.z3) / lim) * 50}%`,
                      width: `${(Math.abs(r.z3) / lim) * 50}%`, background: r.z3 >= 0 ? 'var(--up)' : 'var(--down)',
                    }} />
                  </div>
                  <span className="num text-right"><span className={r.z3 > 0 ? 'up' : r.z3 < 0 ? 'down' : ''}>{r.z3 > 0 ? '+' : ''}{r.z3.toFixed(1)}σ</span></span>
                  <span className="hidden sm:block text-ink2">{r.label}<span className="text-muted num">（20D {r.z20 == null ? '—' : `${r.z20 > 0 ? '+' : ''}${r.z20.toFixed(1)}σ`}）</span></span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] text-muted mb-1">流動性組成（上升 = 收緊）</div>
              <ul className="text-[12px] space-y-0.5">
                {a.liq_items.map((x) => (
                  <li key={x.name} className="flex justify-between"><span className="text-ink2">{x.name}</span>
                    <span className="num">{x.txt}（{x.z > 0 ? '+' : ''}{x.z.toFixed(1)}σ）→ {x.effect}</span></li>
                ))}
              </ul>
            </div>
            <div>
              <div className="text-[11px] text-muted mb-1">傳導鏈檢查（平常的關係是否成立）</div>
              <ul className="text-[12px] space-y-0.5">
                {a.chains.map((c) => (
                  <li key={c.name} className="flex justify-between gap-2" title={c.why}>
                    <span className="text-ink2">{c.name}</span>
                    <span style={{ color: CHAIN_C[c.status] }}>{c.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-[10px] text-muted">
            評估以價格與波動推導（代理指標，非實際申購贖回資金），只用日收盤價；「系統下一期傾向」為動能規則，會在下一期自動驗證，用來和你的判斷對照。
          </p>
        </>
      )}
    </div>
  )
}

const Pill = ({ c, children }) => (
  <span className="text-[11px] px-2 py-0.5 rounded-full border" style={{ borderColor: c, color: c }}>{children}</span>
)
