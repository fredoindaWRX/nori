import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// The owner's settings for Nori's idle-time self-tests (learning/idle-self-test.json) and the
// chat phrases that change them. Dependency-free so self-status and the scheduler can both use it.
export const DEFAULTS = Object.freeze({ enabled: true, idleMinutes: 30, everyHours: 24 })
const settingsFile = dataRoot => path.join(dataRoot, 'learning', 'idle-self-test.json')
const clamp = (value, low, high, fallback) => Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback

export function readIdleSettings(dataRoot) {
  let saved = {}
  try { if (dataRoot) saved = JSON.parse(readFileSync(settingsFile(dataRoot), 'utf8')) } catch {}
  if (!saved || typeof saved !== 'object') saved = {}
  return { enabled: typeof saved.enabled === 'boolean' ? saved.enabled : DEFAULTS.enabled,
    idleMinutes: clamp(saved.idleMinutes, 10, 720, DEFAULTS.idleMinutes), everyHours: clamp(saved.everyHours, 1, 168, DEFAULTS.everyHours) }
}

export function writeIdleSettings(dataRoot, patch, { now = new Date() } = {}) {
  if (typeof dataRoot !== 'string' || !dataRoot) throw new TypeError('Idle self-test settings need a data folder')
  const next = { ...readIdleSettings(dataRoot), ...patch }
  const settings = { enabled: next.enabled === true, idleMinutes: clamp(next.idleMinutes, 10, 720, DEFAULTS.idleMinutes),
    everyHours: clamp(next.everyHours, 1, 168, DEFAULTS.everyHours), updatedAt: now.toISOString(), by: 'owner' }
  mkdirSync(path.join(dataRoot, 'learning'), { recursive: true })
  const file = settingsFile(dataRoot)
  writeFileSync(`${file}.tmp`, `${JSON.stringify(settings, null, 1)}\n`, 'utf8')
  renameSync(`${file}.tmp`, file)
  return settings
}

// "stop testing yourself when I'm away" → 'off'; "test yourself on your own again" → 'on'.
// A plain "run a self-test" says nothing about idle time and returns null.
const IDLE = /\b(?:idle|in the background|background|automatic(?:ally)?|on your own|by yourself|when (?:i'?m|i am|you'?re|you are) (?:away|gone|idle|not (?:here|around|using you))|while (?:i'?m|i am) (?:away|gone|out|asleep))\b/i
const SELF_TEST = /\bself[- ]?tests?\b|\btest(?:ing)? (?:yourself|your ?self)\b/i
const OFF = /\b(?:stop|quit|don'?t|do not|no more|never|disable|turn off|switch off|pause)\b/i
const ON = /\b(?:start|resume|enable|turn on|switch on|keep|go ahead|allowed|can|may|please do|again)\b/i
export function idleSelfTestSetting(text) {
  const line = String(text ?? '')
  if (!SELF_TEST.test(line) || !IDLE.test(line)) return null
  if (OFF.test(line)) return 'off'
  if (ON.test(line)) return 'on'
  return null
}
