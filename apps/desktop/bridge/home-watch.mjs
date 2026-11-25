import { execFile } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { hueRequest } from './hue.mjs'
import { pcLocation } from './weather.mjs'

// Home habits (owner-requested 2026-11-09): Nori notices when the owner's own phone leaves or
// rejoins the home Wi-Fi and runs two light habits through the existing Hue module:
//   leave  - phone gone and this PC untouched for awayMinutes -> all lights off (if any were on)
//   arrive - phone back after being away, and it is dark       -> all lights on (if all were off)
// Only the owner's phone (one MAC he identified) is tracked; other devices are never logged.
// Read-only probes stay on the private /24 the PC is on. Every action is written to
// home/events.jsonl and the owner can pause either habit by voice or text.
const PRIVATE_IP = /^(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}$/
const MAC = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/
const SCHEMA = 'nori.home-watch.v1'
const MAX_EVENTS_BYTES = 256 * 1024

export const HOME_DEFAULTS = Object.freeze({
  schema: SCHEMA, enabled: true,
  owner: { mac: 'a6:c9:92:18:55:4c', label: "Wil's phone", last_ip: '10.0.0.46' },
  habits: { leave: { enabled: true, awayMinutes: 15 }, arrive: { enabled: true, quietFrom: 23, quietTo: 7 } },
})

// Quiet hours (owner, 2026-11-11): a phone that drops off the Wi-Fi at night is usually asleep, not out.
// Hours are local, 0-23; from === to switches quiet hours off. Bad values fall back to 23:00-07:00.
export function inQuietHours(at, arrive) {
  const hour = value => (Number.isInteger(value) && value >= 0 && value <= 23 ? value : null)
  const from = hour(arrive?.quietFrom) ?? 23, to = hour(arrive?.quietTo) ?? 7
  if (from === to || !Number.isFinite(at)) return false
  const now = new Date(at).getHours()
  return from < to ? now >= from && now < to : now >= from || now < to
}

const homeDir = dataRoot => path.join(dataRoot, 'home')
const settingsPath = dataRoot => path.join(homeDir(dataRoot), 'watch.json')
const eventsPath = dataRoot => path.join(homeDir(dataRoot), 'events.jsonl')

export function readHomeSettings(dataRoot) {
  try {
    const value = JSON.parse(readFileSync(settingsPath(dataRoot), 'utf8'))
    if (value?.schema === SCHEMA && MAC.test(value.owner?.mac)) {
      return { ...HOME_DEFAULTS, ...value, owner: { ...HOME_DEFAULTS.owner, ...value.owner },
        habits: { leave: { ...HOME_DEFAULTS.habits.leave, ...value.habits?.leave }, arrive: { ...HOME_DEFAULTS.habits.arrive, ...value.habits?.arrive } } }
    }
  } catch {}
  return structuredClone(HOME_DEFAULTS)
}

export function writeHomeSettings(dataRoot, value) {
  mkdirSync(homeDir(dataRoot), { recursive: true })
  const file = settingsPath(dataRoot), temporary = `${file}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 1)}\n`, 'utf8')
  renameSync(temporary, file)
}

export function logHomeEvent(dataRoot, event, now = Date.now()) {
  mkdirSync(homeDir(dataRoot), { recursive: true })
  const file = eventsPath(dataRoot)
  try { if (statSync(file).size > MAX_EVENTS_BYTES) renameSync(file, `${file}.old`) } catch {}
  appendFileSync(file, `${JSON.stringify({ at: new Date(now).toISOString(), ...event })}\n`, 'utf8')
}

export function readHomeEvents(dataRoot, limit = 6) {
  try {
    return readFileSync(eventsPath(dataRoot), 'utf8').trim().split('\n').slice(-limit)
      .map(line => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
  } catch { return [] }
}

// --- Sun position (after the public-domain SunCalc formulas) ---------------------------------
const RAD = Math.PI / 180, DAY_MS = 86_400_000, J1970 = 2440588, J2000 = 2451545
/** Sunrise and sunset (ms) for the UTC day containing `at`, or null in polar day/night. */
export function sunTimes(at, latitude, longitude) {
  const d = at / DAY_MS - 0.5 + J1970 - J2000
  const lw = RAD * -longitude, phi = RAD * latitude
  const n = Math.round(d - 0.0009 - lw / (2 * Math.PI))
  const ds = 0.0009 + lw / (2 * Math.PI) + n
  const M = RAD * (357.5291 + 0.98560028 * ds)
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M))
  const L = M + C + RAD * 102.9372 + Math.PI
  const dec = Math.asin(Math.sin(RAD * 23.4397) * Math.sin(L))
  const cosW = (Math.sin(RAD * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec))
  if (cosW < -1 || cosW > 1) return null
  const w = Math.acos(cosW)
  const julian = x => J2000 + x + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L)
  const transit = julian(ds), set = julian(0.0009 + (w + lw) / (2 * Math.PI) + n)
  const ms = j => (j + 0.5 - J1970) * DAY_MS
  return { sunrise: ms(transit - (set - transit)), sunset: ms(set) }
}

/** Dark means from 30 minutes before sunset until 30 minutes after sunrise; fixed hours without a location. */
export function isDark(at, location) {
  if (location && Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) {
    const today = sunTimes(at, location.latitude, location.longitude)
    if (today) return at < today.sunrise + 30 * 60_000 || at > today.sunset - 30 * 60_000
  }
  const hour = new Date(at).getHours() + new Date(at).getMinutes() / 60
  return hour >= 17.5 || hour < 7
}

// --- Probes ------------------------------------------------------------------------------------
const run = (file, args, timeout) => new Promise(resolve => execFile(file, args, { windowsHide: true, timeout, encoding: 'utf8' },
  (error, stdout) => resolve(error && !stdout ? '' : String(stdout || ''))))

async function arpTable() {
  const table = new Map()
  for (const match of (await run('arp', ['-a'], 8000)).matchAll(/(\d{1,3}(?:\.\d{1,3}){3})\s+([0-9a-f]{2}(?:-[0-9a-f]{2}){5})/gi)) {
    if (PRIVATE_IP.test(match[1])) table.set(match[2].toLowerCase().replace(/-/g, ':'), match[1])
  }
  return table
}

const tcpOpen = (ip, port, ms = 1500) => new Promise(resolve => {
  const socket = net.connect({ host: ip, port })
  const done = value => { socket.destroy(); resolve(value) }
  socket.setTimeout(ms, () => done(false)); socket.once('connect', () => done(true)); socket.once('error', () => done(false))
})
const pings = async ip => /TTL=/i.test(await run('ping', ['-n', '1', '-w', '900', ip], 5000))

/** True when the owner's phone answers now. Finds it by MAC, so a new DHCP address is followed. */
export async function phonePresent(owner, { arp = arpTable, tcp = tcpOpen, ping = pings } = {}) {
  let table = await arp()
  let ip = table.get(owner.mac)
  if (!ip && PRIVATE_IP.test(owner.last_ip ?? '')) { await ping(owner.last_ip); table = await arp(); ip = table.get(owner.mac) }
  if (!ip || !PRIVATE_IP.test(ip)) return { present: false, ip: null }
  // iPhones keep the sync port open while on Wi-Fi even when the screen is off; ping is the fallback.
  for (let attempt = 0; attempt < 2; attempt++) {
    if (await tcp(ip, 62078) || await ping(ip)) return { present: true, ip }
  }
  return { present: false, ip }
}

const IDLE = `Add-Type -Namespace NoriIdle -Name Input -MemberDefinition '[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] public struct LII { public uint cbSize; public uint dwTime; } [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LII p); [System.Runtime.InteropServices.DllImport("kernel32.dll")] public static extern uint GetTickCount();'
$i = New-Object NoriIdle.Input+LII; $i.cbSize = 8
if (-not [NoriIdle.Input]::GetLastInputInfo([ref]$i)) { exit 1 }
"$([NoriIdle.Input]::GetTickCount()) $($i.dwTime)"`
/** Seconds since the last keyboard or mouse input on this PC, or null if Windows did not say. */
export async function pcIdleSeconds() {
  const [now, last] = (await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', IDLE], 20000)).trim().split(/\s+/).map(Number)
  if (!Number.isFinite(now) || !Number.isFinite(last)) return null
  return ((now - last + 4294967296) % 4294967296) / 1000
}

// --- Watcher -----------------------------------------------------------------------------------
const anyLightOn = listing => /, on$/m.test(listing)
const allLightsOff = listing => /^Your Hue Bridge has /.test(listing) && !anyLightOn(listing)

export function createHomeWatch({ dataRoot, now = Date.now, present = phonePresent, idleSeconds = pcIdleSeconds,
  hue = (text, options) => hueRequest(text, options), locate = pcLocation, log = () => {} } = {}) {
  if (typeof dataRoot !== 'string' || !dataRoot) throw new TypeError('Home watch needs a data folder')
  let state = 'unknown', lastSeen = 0, since = 0, location = null, locatedAt = -Infinity, ticking = false

  async function where() {
    if (now() - locatedAt > 12 * 3_600_000) {
      locatedAt = now()
      try { const found = await locate(); if (Number.isFinite(found?.latitude)) location = found } catch {}
    }
    return location
  }

  async function act(habit, text, settings) {
    const listing = await hue('list my lights', { dataRoot })
    const wanted = habit === 'leave' ? anyLightOn(listing) : allLightsOff(listing)
    if (!wanted) { logHomeEvent(dataRoot, { habit, action: 'none', why: habit === 'leave' ? 'no lights were on' : 'lights were already on' }, now()); return null }
    const reply = await hue(text, { dataRoot })
    const ok = /^Done: /.test(reply)
    logHomeEvent(dataRoot, { habit, action: text, ok, reply: String(reply).slice(0, 160) }, now())
    log(`[nori-home] ${settings.owner.label} ${habit === 'leave' ? 'left' : 'came home'}: ${ok ? reply : `light change not confirmed: ${String(reply).slice(0, 120)}`}`)
    return reply
  }

  async function tick() {
    if (ticking) return 'busy'
    ticking = true
    try {
      const settings = readHomeSettings(dataRoot)
      if (!settings.enabled) return 'paused'
      const at = now()
      const probe = await present(settings.owner)
      if (probe.ip && probe.ip !== settings.owner.last_ip) writeHomeSettings(dataRoot, { ...settings, owner: { ...settings.owner, last_ip: probe.ip } })
      if (probe.present) {
        lastSeen = at
        if (state === 'away') {
          const awayBegan = since
          state = 'home'; since = at
          logHomeEvent(dataRoot, { presence: 'home' }, at)
          if (settings.habits.arrive.enabled && isDark(at, await where())) {
            // Never light the house for a phone that went quiet and woke up again during the night.
            if (inQuietHours(at, settings.habits.arrive) && inQuietHours(awayBegan, settings.habits.arrive)) logHomeEvent(dataRoot, { habit: 'arrive', action: 'none', why: 'quiet hours: the phone dropped off the Wi-Fi during the night, which usually means it was asleep' }, at)
            else await act('arrive', 'turn on all lights', settings)
          }
          return 'arrived'
        }
        if (state === 'unknown') { state = 'home'; since = at }
        return 'home'
      }
      const awayMs = settings.habits.leave.awayMinutes * 60_000
      if (state === 'unknown' && lastSeen === 0) lastSeen = at // first look: give the phone the full window before deciding
      if (state !== 'away' && at - lastSeen >= awayMs) {
        // Someone at the keyboard means the owner is home with a sleeping or dead phone.
        const idle = await idleSeconds()
        // No idle reading means no evidence either way: hold, do not declare the owner away.
        if (idle === null) return 'idle-unknown'
        if (idle * 1000 < awayMs) return 'pc-in-use'
        state = 'away'; since = at
        logHomeEvent(dataRoot, { presence: 'away' }, at)
        if (settings.habits.leave.enabled) await act('leave', 'turn off all lights', settings)
        return 'left'
      }
      return state === 'away' ? 'away' : 'not-seen'
    } finally { ticking = false }
  }

  return Object.freeze({ tick, get state() { return state }, get since() { return since }, get lastSeen() { return lastSeen } })
}

let active = null
export function startHomeWatch({ everyMs = 60_000, ...options } = {}) {
  const watch = createHomeWatch(options)
  const timer = setInterval(() => { watch.tick().catch(error => options.log?.(`[nori-home] ${String(error?.message ?? error).slice(0, 160)}`)) }, everyMs)
  timer.unref?.()
  active = watch
  options.log?.('[nori-home] home habits watching the owner\'s phone')
  return { watch, stop: () => { clearInterval(timer); if (active === watch) active = null } }
}

// --- Owner commands ----------------------------------------------------------------------------
const HABITS = String.raw`(?:home\s+(?:habits?|watch|automation)|automatic\s+lights|auto\s+lights)`
const NEG = String.raw`(?:stop|quit|don'?t|do\s+not|never)`
/** The owner's words for the home habits, or null. Checked before light commands. */
export function homeWatchCommand(text) {
  const value = String(text ?? '').trim().toLowerCase().replace(/[’]/g, "'")
  const phone = value.match(/\bmy\s+phone\s+is\s+(?:at\s+)?((?:\d{1,3}\.){3}\d{1,3})\b/)
  if (phone) return PRIVATE_IP.test(phone[1]) ? { kind: 'phone', ip: phone[1] } : null
  if (new RegExp(`${NEG}\\s+(?:turning|turn|switching|switch)\\s+(?:the\\s+|my\\s+)?(?:lights?\\s+)?off\\s+(?:the\\s+lights?\\s+)?when\\s+i\\s+(?:leave|go|head out)`).test(value)) return { kind: 'leave', enabled: false }
  if (new RegExp(`${NEG}\\s+(?:turning|turn|switching|switch)\\s+(?:the\\s+|my\\s+)?(?:lights?\\s+)?on\\s+(?:the\\s+lights?\\s+)?when\\s+i\\s+(?:get|come|am)\\s+(?:home|back)`).test(value)) return { kind: 'arrive', enabled: false }
  if (/\b(?:turn|switch|shut)\s+(?:the\s+|my\s+)?lights?\s+off\s+when\s+i\s+(?:leave|go|head out)\b/.test(value)) return { kind: 'leave', enabled: true }
  if (/\b(?:turn|switch)\s+(?:the\s+|my\s+)?lights?\s+on\s+when\s+i\s+(?:get|come)\s+(?:home|back)\b/.test(value)) return { kind: 'arrive', enabled: true }
  if (new RegExp(`\\b(?:pause|stop|disable|turn\\s+off|switch\\s+off)\\s+(?:the\\s+|my\\s+)?${HABITS}`).test(value)) return { kind: 'all', enabled: false }
  if (new RegExp(`\\b(?:resume|start|enable|turn\\s+on|switch\\s+on|restart)\\s+(?:the\\s+|my\\s+)?${HABITS}`).test(value)) return { kind: 'all', enabled: true }
  if (new RegExp(`\\b${HABITS}\\b|\\bhome\\s+status\\b|\\bam\\s+i\\s+(?:home|away)\\b|\\bwhat\\s+did\\s+you\\s+do\\s+(?:with|to)\\s+(?:the\\s+|my\\s+)?lights\\b|\\bwhy\\s+did\\s+(?:the|my)\\s+lights\\s+(?:go|turn)\\s+(?:on|off)\\b`).test(value)) return { kind: 'status' }
  return null
}
export const requestsHomeWatch = text => homeWatchCommand(text) !== null

const ago = (ms, at) => { const m = Math.round((at - ms) / 60_000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago` }
const clock = iso => new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
function describeEvent(event) {
  if (event.presence) return `${clock(event.at)}: your phone ${event.presence === 'home' ? 'came back on the Wi-Fi' : 'left the Wi-Fi'}`
  if (event.action === 'none') return `${clock(event.at)}: nothing to do (${event.why})`
  if (event.setting) return `${clock(event.at)}: you changed a setting (${event.setting})`
  return `${clock(event.at)}: ${event.ok ? event.reply : `tried "${event.action}" but the bridge didn't confirm it`}`
}

const hourLabel = hour => `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`
function quietNote(arrive) {
  const ok = value => Number.isInteger(value) && value >= 0 && value <= 23
  const from = ok(arrive?.quietFrom) ? arrive.quietFrom : 23, to = ok(arrive?.quietTo) ? arrive.quietTo : 7
  return from === to ? '' : ` (never between ${hourLabel(from)} and ${hourLabel(to)} when your phone dropped off the Wi-Fi during those hours)`
}

/** Host-written reply to an owner home-habit command; never model text. */
export async function homeWatchReply(text, { dataRoot, now = Date.now, arp = arpTable, watch = active } = {}) {
  const command = homeWatchCommand(text)
  if (!command) return null
  const settings = readHomeSettings(dataRoot)
  if (command.kind === 'phone') {
    const table = await arp()
    const mac = [...table].find(([, ip]) => ip === command.ip)?.[0]
    if (!mac) return `I don't see ${command.ip} on the network right now, so I kept your phone as it was. Make sure the phone is on Wi-Fi and try again.`
    writeHomeSettings(dataRoot, { ...settings, owner: { ...settings.owner, mac, last_ip: command.ip } })
    logHomeEvent(dataRoot, { setting: `owner phone set to ${command.ip}` }, now())
    return `Got it. I'll treat ${command.ip} as your phone from now on.`
  }
  if (command.kind !== 'status') {
    const next = structuredClone(settings)
    if (command.kind === 'all') next.enabled = command.enabled
    else next.habits[command.kind].enabled = command.enabled
    writeHomeSettings(dataRoot, next)
    const what = command.kind === 'all' ? `home habits ${command.enabled ? 'on' : 'paused'}`
      : `${command.kind === 'leave' ? 'lights off when you leave' : 'lights on when you get home after dark'}: ${command.enabled ? 'on' : 'off'}`
    logHomeEvent(dataRoot, { setting: what }, now())
    return command.kind === 'all'
      ? command.enabled ? 'Home habits are back on. I\'m watching for your phone again.' : 'Home habits are paused. I won\'t touch the lights on my own until you say "resume home habits".'
      : `Done. ${command.kind === 'leave' ? 'Turning the lights off when you leave' : 'Turning the lights on when you get home after dark'} is now ${command.enabled ? 'on' : 'off'}.`
  }
  const at = now()
  const lines = [`**Home habits are ${settings.enabled ? 'on' : 'paused'}.**`,
    `- Lights off when you leave (phone gone ${settings.habits.leave.awayMinutes} min and this PC idle): ${settings.habits.leave.enabled ? 'on' : 'off'}`,
    `- Lights on when you get home after dark: ${settings.habits.arrive.enabled ? 'on' : 'off'}${quietNote(settings.habits.arrive)}`]
  if (!watch) lines.push('', 'The watcher is not running right now.')
  else if (watch.state === 'unknown') lines.push('', 'I haven\'t seen your phone on the Wi-Fi since I started, so I don\'t know yet whether you\'re home.')
  else lines.push('', `Right now I think you're **${watch.state}**${watch.lastSeen ? `; I last saw your phone ${ago(watch.lastSeen, at)}` : ''}.`)
  const events = readHomeEvents(dataRoot)
  lines.push('', events.length ? '**Recent:**' : 'Nothing has happened yet.', ...events.map(event => `- ${describeEvent(event)}`))
  lines.push('', 'Say "pause home habits", "stop turning the lights off when I leave", or "my phone is 10.0.0.x" to change this.')
  return lines.join('\n')
}
