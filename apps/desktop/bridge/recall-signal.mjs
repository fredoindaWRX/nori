// Notes which memories a message just brought back, so her face can light those nodes (vision doc part 4).
// Only 12-character hash prefixes and a time are written: no memory text, no scores, no request text.
// It is display-only and must never break a turn, so every failure is swallowed.
import { createHash } from 'node:crypto'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Same key as semantic-memory.mjs keyed(): sha256(id + NUL + text).
export const recallKey = match => createHash('sha256').update(match.id + '\0' + match.text).digest('hex').slice(0, 12)

export function noteRecall(matches, { dataRoot = process.env.NORI_APP_DATA_ROOT, now = Date.now() } = {}) {
  try {
    if (!dataRoot || !Array.isArray(matches)) return false
    const keys = [...new Set(matches.filter(m => typeof m?.id === 'string' && typeof m.text === 'string').map(recallKey))].slice(0, 12)
    if (!keys.length) return false
    const folder = join(dataRoot, 'learning'), file = join(folder, 'last-recall.json')
    mkdirSync(folder, { recursive: true })
    writeFileSync(file + '.tmp', JSON.stringify({ at: now, keys }))
    renameSync(file + '.tmp', file)
    return true
  } catch { return false }
}
