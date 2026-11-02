import { useState } from 'react'
import { Panel } from './bits'
import { GUIDE, GUIDE_INTRO } from '../lib/guideContent'

function Table({ rows }) {
  const [head, ...body] = rows
  return (
    <>
    {/* 手機：每列一張卡片 */}
    <div className="sm:hidden my-2 space-y-1.5">
      {body.map((r, i) => (
        <div key={i} className="rounded-lg bg-surface2 p-2">
          <div className="text-[13px] text-ink font-medium">{r[0]}</div>
          {r.slice(1).map((c, j) => (
            <div key={j} className="text-[13px] text-ink2 leading-relaxed mt-0.5">
              {head.length > 2 && <span className="text-muted text-[11px] mr-1">{head[j + 1]}</span>}{c}
            </div>
          ))}
        </div>
      ))}
    </div>
    <div className="hidden sm:block overflow-x-auto my-2">
      <table className="w-full text-[13px] border-collapse">
        <thead><tr>{head.map((h) => <th key={h} className="text-left font-normal text-muted py-1.5 pr-3 border-b border-line whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>
          {body.map((r, i) => (
            <tr key={i} className="border-b border-line align-top">
              {r.map((c, j) => <td key={j} className={`py-2 pr-3 leading-relaxed ${j === 0 ? 'text-ink font-medium whitespace-nowrap' : 'text-ink2'}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  )
}

function Block({ b }) {
  return (
    <div className="mt-3 first:mt-0">
      {b.h && <h3 className="text-[14px] font-semibold text-ink mb-1">{b.h}</h3>}
      {b.p && <p className="text-[13px] text-ink2 leading-relaxed">{b.p}</p>}
      {b.list && <ul className="list-disc pl-5 text-[13px] text-ink2 space-y-0.5 mt-1">{b.list.map((x) => <li key={x}>{x}</li>)}</ul>}
      {b.ol && <ol className="list-decimal pl-5 text-[13px] text-ink2 space-y-1 mt-1 leading-relaxed">{b.ol.map((x) => <li key={x}>{x}</li>)}</ol>}
      {b.table && <Table rows={b.table} />}
      {b.qa && <dl className="text-[13px] space-y-2 mt-1">{b.qa.map(([q, a]) => <div key={q}><dt className="text-ink font-medium">{q}</dt><dd className="text-ink2">{a}</dd></div>)}</dl>}
      {b.after && <p className="text-[12px] text-muted leading-relaxed mt-1">{b.after}</p>}
    </div>
  )
}

export default function Guide() {
  const [q, setQ] = useState('')
  const kw = q.trim().toLowerCase()
  const hit = (s) => JSON.stringify(s).toLowerCase().includes(kw)
  const secs = kw ? GUIDE.map((s) => ({ ...s, blocks: s.blocks.filter(hit) })).filter((s) => s.blocks.length || (s.lead && hit(s.lead))) : GUIDE
  const go = (id) => document.getElementById(`g-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  return (
    <div className="grid gap-3 xl:grid-cols-[220px_1fr] max-w-6xl mx-auto">
      <aside className="xl:sticky xl:top-16 self-start space-y-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋，例如 σ、淨流動性、R 倍數"
          className="w-full bg-bg border border-line rounded-lg px-2 py-1.5 text-[13px] text-ink placeholder:text-muted focus:outline-none focus:border-s1" aria-label="搜尋指南" />
        <nav className="flex xl:flex-col gap-1 flex-wrap">
          {GUIDE.map((s) => (
            <button key={s.id} onClick={() => go(s.id)} className="text-left text-[12px] px-2 py-1 rounded bg-surface2 xl:bg-transparent text-ink2 hover:text-ink">{s.title}</button>
          ))}
        </nav>
      </aside>
      <div className="space-y-3 min-w-0">
        <Panel title="使用指南"><p className="text-[13px] text-ink2 leading-relaxed">{GUIDE_INTRO}</p></Panel>
        {secs.length === 0 && <p className="text-[13px] text-muted">找不到「{q}」，換個關鍵字試試。</p>}
        {secs.map((s) => (
          <section key={s.id} id={`g-${s.id}`} className="scroll-mt-16">
            <Panel title={s.title}>
              {s.lead && <p className="text-[13px] text-ink2 leading-relaxed mb-2">{s.lead}</p>}
              {s.blocks.map((b, i) => <Block key={i} b={b} />)}
            </Panel>
          </section>
        ))}
      </div>
    </div>
  )
}
