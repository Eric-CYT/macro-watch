import { useMemo, useState } from 'react'
import { Panel } from './bits'
import { timeAgo } from '../lib/util'

const TAGS = ['全部', 'FED', '通膨', '就業', '地緣政治', '半導體', '能源', '匯率', '債市', '加密', '台股', '中國']

export default function News({ news, className = '' }) {
  const [tag, setTag] = useState('全部')
  const items = useMemo(() => (news?.items || []).filter((n) => tag === '全部' || n.tags.includes(tag)), [news, tag])
  const counts = useMemo(() => {
    const c = {}
    for (const n of news?.items || []) for (const t of n.tags) c[t] = (c[t] || 0) + 1
    return c
  }, [news])
  return (
    <Panel title="即時新聞與催化劑" className={`flex flex-col min-h-0 ${className}`}
      right={<span className="text-[11px] text-muted">{news ? `更新 ${timeAgo(news.updated)}` : ''}</span>}>
      <div className="flex gap-1 flex-wrap mb-2">
        {TAGS.map((t) => (
          <button key={t} onClick={() => setTag(t)}
            className={`text-[11px] px-2 py-0.5 rounded-full border ${tag === t ? 'bg-s1 border-s1 text-white' : 'border-line text-ink2 hover:bg-surface2'}`}>
            {t}{t !== '全部' && counts[t] ? <span className="text-muted ml-0.5">{counts[t]}</span> : null}
          </button>
        ))}
      </div>
      <ul className="overflow-y-auto scroll-thin flex-1 min-h-0 -mx-1">
        {items.map((n, i) => (
          <li key={i} className="px-1 py-2 border-b border-line last:border-0">
            <a href={n.url} target="_blank" rel="noreferrer" className="text-[13px] leading-snug text-ink hover:text-s1">{n.title}</a>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span className="text-[10px] text-muted">{n.source}{n.t ? ` · ${timeAgo(n.t)}` : ''}</span>
              {n.tags.map((t) => <span key={t} className="text-[10px] px-1.5 rounded bg-surface2 text-ink2">{t}</span>)}
            </div>
          </li>
        ))}
        {!items.length && <li className="text-muted text-sm p-2">沒有符合的新聞</li>}
      </ul>
    </Panel>
  )
}
