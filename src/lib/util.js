export const BASE = import.meta.env.BASE_URL

export async function getJSON(path) {
  const r = await fetch(`${BASE}${path}?t=${Math.floor(Date.now() / 60000)}`)
  if (!r.ok) throw new Error(`${path} HTTP ${r.status}`)
  return r.json()
}

export function fmt(v, d = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—'
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

/** 漲跌文字：利率類用 bp，其它用 % */
export function fmtChg(v, rate) {
  if (v === null || v === undefined) return '—'
  const s = v > 0 ? '+' : ''
  return rate ? `${s}${v.toFixed(1)}bp` : `${s}${v.toFixed(2)}%`
}

export const dirClass = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'text-ink2')

export function timeAgo(iso) {
  const t = typeof iso === 'number' ? iso * 1000 : Date.parse(iso)
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return '剛剛'
  if (m < 60) return `${m} 分鐘前`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} 小時前`
  return `${Math.round(h / 24)} 天前`
}

export function twTime(iso) {
  return new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false,
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export const STATUS = {
  ok: { label: '雙源一致', icon: '✓', c: 'var(--color-good)' },
  warn: { label: '來源差異', icon: '⚠', c: 'var(--color-warning)' },
  single: { label: '單一來源', icon: '○', c: 'var(--color-muted)' },
  fail: { label: '備援來源', icon: '↺', c: 'var(--color-serious)' },
  stale: { label: '沿用舊資料', icon: '⏸', c: 'var(--color-serious)' },
  missing: { label: '無資料', icon: '✕', c: 'var(--color-critical)' },
}
