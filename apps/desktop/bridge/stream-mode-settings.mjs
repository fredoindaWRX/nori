import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// The owner's switch for stream mode (learning/stream-mode.json): while OBS runs, Nori prefers
// the faster 24B over the 35B. Read by the desktop's detector; written from chat here.
export const DEFAULTS = Object.freeze({ enabled: true })
const file = dataRoot => path.join(dataRoot, 'learning', 'stream-mode.json')

export function readStreamModeSettings(dataRoot) {
  try {
    const saved = JSON.parse(readFileSync(file(dataRoot), 'utf8'))
    return { enabled: typeof saved?.enabled === 'boolean' ? saved.enabled : DEFAULTS.enabled }
  } catch { return { ...DEFAULTS } }
}

export function writeStreamModeSettings(dataRoot, patch, { now = new Date() } = {}) {
  if (typeof dataRoot !== 'string' || !dataRoot) throw new TypeError('Stream mode settings need a data folder')
  const settings = { enabled: patch?.enabled === true, updatedAt: now.toISOString(), by: 'owner' }
  mkdirSync(path.join(dataRoot, 'learning'), { recursive: true })
  writeFileSync(`${file(dataRoot)}.tmp`, `${JSON.stringify(settings, null, 1)}\n`, 'utf8')
  renameSync(`${file(dataRoot)}.tmp`, file(dataRoot))
  return settings
}

// "turn off stream mode" / "use the big model while streaming" → 'off';
// "stream mode on" / "use the fast model when I stream" → 'on'; anything else null.
const STREAM = /\bstream(?:ing)?[- ]mode\b|\b(?:while|when|whenever) (?:i'?m |i am |i |we'?re |we are |we )?(?:stream(?:ing)?|live|on obs)\b/i
const OFF = /\b(?:off|disable|disabled|stop|don'?t|do not|no more|never)\b|\b(?:big|bigger|large|35 ?b|best|full) (?:model|brain)\b/i
const ON = /\b(?:on|enable|enabled|start|resume|keep|use)\b|\b(?:fast|faster|quick|small(?:er)?|24 ?b|freedom) (?:model|brain)\b/i
export function streamModeSetting(text) {
  const line = String(text ?? '')
  if (!STREAM.test(line)) return null
  if (OFF.test(line)) return 'off'
  if (ON.test(line)) return 'on'
  return null
}
