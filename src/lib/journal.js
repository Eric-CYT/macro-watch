/**
 * 推敲日誌儲存層
 * 1) 本機：localStorage（預設，零設定）
 * 2) 雲端同步（選用、免費）：寫進你自己的「私人」GitHub repo 的 journal.json，手機/電腦共用
 *    Token 只存在此瀏覽器的 localStorage，不會出現在網站原始碼或公開 repo。
 */
const KEY = 'mdj.entries.v1'
const SKEY = 'mdj.sync.v1'
const DKEY = 'mdj.drafts.v1'

/** 草稿：作答中自動保存（按提交前也不會遺失）；key 例：'2026-10-30' 或 'edit:2026-10-30' */
function loadDrafts() { try { return JSON.parse(localStorage.getItem(DKEY) || '{}') } catch { return {} } }
export function loadDraft(key) { return loadDrafts()[key] || null }
export function saveDraft(key, data) {
  try {
    const all = loadDrafts()
    all[key] = { ...data, saved_at: new Date().toISOString() }
    // 只保留最近 30 份草稿，避免無限增長
    const keys = Object.keys(all).sort((a, b) => (all[b].saved_at > all[a].saved_at ? 1 : -1))
    keys.slice(30).forEach((k) => delete all[k])
    localStorage.setItem(DKEY, JSON.stringify(all))
    return all[key].saved_at
  } catch { return null }
}
export function clearDraft(key) {
  try { const all = loadDrafts(); delete all[key]; localStorage.setItem(DKEY, JSON.stringify(all)) } catch { /* ignore */ }
}

export function loadEntries() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}
export function saveEntries(e) { localStorage.setItem(KEY, JSON.stringify(e)) }

export function upsertEntry(date, patch) {
  const all = loadEntries()
  all[date] = { ...(all[date] || {}), ...patch, date, updated_at: new Date().toISOString() }
  saveEntries(all)
  return all
}

export function loadSync() { try { return JSON.parse(localStorage.getItem(SKEY) || 'null') } catch { return null } }
export function saveSync(s) { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY) }

const b64e = (s) => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}
const b64d = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), (c) => c.charCodeAt(0)))

/** 以 updated_at 較新者為準，逐日合併 */
export function mergeEntries(a, b) {
  const out = { ...a }
  for (const [d, e] of Object.entries(b || {})) {
    if (!out[d] || (e.updated_at || '') > (out[d].updated_at || '')) out[d] = e
  }
  return out
}

export async function syncGithub(cfg) {
  const { owner, repo, token, path = 'journal.json' } = cfg
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`
  const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
  let remote = {}, sha
  const r = await fetch(url, { headers: h, cache: 'no-store' })
  if (r.status === 200) {
    const j = await r.json()
    sha = j.sha
    remote = JSON.parse(b64d(j.content) || '{}')
  } else if (r.status !== 404) {
    throw new Error(`讀取失敗 HTTP ${r.status}（檢查 repo 名稱與 token 權限）`)
  }
  const merged = mergeEntries(remote, loadEntries())
  saveEntries(merged)
  const body = { message: `journal sync ${new Date().toISOString()}`, content: b64e(JSON.stringify(merged, null, 1)) }
  if (sha) body.sha = sha
  const w = await fetch(url, { method: 'PUT', headers: h, body: JSON.stringify(body) })
  if (!w.ok) throw new Error(`寫入失敗 HTTP ${w.status}`)
  return merged
}

export function exportJSON() {
  const blob = new Blob([JSON.stringify(loadEntries(), null, 1)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `deduction-journal-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
}

export async function importJSON(file) {
  const data = JSON.parse(await file.text())
  const merged = mergeEntries(loadEntries(), data)
  saveEntries(merged)
  return merged
}

/** 提交後的回饋：依回答內容給鼓勵 + 結構化提示 */
export function feedback(answers) {
  const filled = answers.filter((a) => a && a.trim().length > 0)
  const len = filled.reduce((s, a) => s + a.trim().length, 0)
  const causal = filled.filter((a) => /因為|所以|導致|如果|若|代表|意味|because|if|so\b/i.test(a)).length
  const falsifiable = filled.filter((a) => /跌破|突破|假如|驗證|失效|停損|觀察|明天|下週|\d/.test(a)).length
  const msgs = []
  const total = answers.length
  if (filled.length === total) msgs.push(`${total} 題都完成了，保持每日紀錄就是你最大的 Alpha 來源。`)
  else msgs.push(`完成 ${filled.length}/${total} 題。就算只寫一句直覺，也比沒有紀錄好。`)
  if (causal >= 2) msgs.push('你的回答有清楚的因果鏈，這讓日後回溯時能判斷是「邏輯錯」還是「時機錯」。')
  else msgs.push('建議：試著用「因為 A → 所以 B」寫出因果鏈，回顧時才知道錯在哪一環。')
  if (falsifiable >= 1) msgs.push('很好，你留下了可驗證的條件（價位/時間），記得之後回來對答案。')
  else msgs.push('建議：加上一個「什麼情況代表我錯了」的條件，例如某價位或某數據。')
  if (len > 600) msgs.push('篇幅很充實；挑出最關鍵的一句加粗在心裡，那就是今天的結論。')
  const flowAns = answers.slice(3).filter((a) => a && a.trim())
  if (total > 3 && flowAns.length && !flowAns.some((a) => /利率|美元|殖利率|流動性|避險|外資|央行|Fed|聯準會|通膨|匯/.test(a))) {
    msgs.push('資金流向題建議：把「誰流出、誰流入」連到一個驅動因子（利率、美元、流動性、避險需求），推論才站得住。')
  }
  return msgs
}
