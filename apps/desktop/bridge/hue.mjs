import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { scanHomeNetwork } from './network-watch.mjs'

// Philips Hue on the owner's own network. The host talks to the bridge's local
// API directly and writes the reply itself, so the model never invents a light
// state. Lights change only on an explicit command; questions go to the model.
// Pairing needs the physical link button; the bridge key stays in Nori's data
// folder and is never placed in chat or model context.
const PRIVATE_IP = /^(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}$/
const HUE_PREFIXES = ['00:17:88', 'ec:b5:fa']
const COLORS = Object.freeze({
  red: [0.675, 0.322], orange: [0.5916, 0.3824], yellow: [0.4432, 0.5154], green: [0.17, 0.7], cyan: [0.1607, 0.3423],
  blue: [0.153, 0.048], purple: [0.2725, 0.1096], pink: [0.3944, 0.1752], magenta: [0.3833, 0.1591],
  // Added 2026-11-10 at the owner's request; single words so the tool binding can match them.
  teal: [0.165, 0.38], turquoise: [0.17, 0.36], aqua: [0.1607, 0.3423], violet: [0.24, 0.09], indigo: [0.2, 0.07],
  lavender: [0.31, 0.24], gold: [0.49, 0.45], amber: [0.55, 0.41], lime: [0.3, 0.62],
})
export const HUE_COLOR_NAMES = Object.freeze(Object.keys(COLORS))
// "set the bedroom to green": a room plus a color is about the lights even without the word.
const ROOM_WORD = /\b(?:kitchen|bedroom|living\s*room|bathroom|office|hall(?:way)?|den|garage|dining\s*room|basement|nursery)\b/i
const COLOR_WORD = new RegExp(`\\b(?:${Object.keys(COLORS).join('|')})\\b`, 'i')
export const roomColor = text => ROOM_WORD.test(text) && COLOR_WORD.test(text)
const WHITES = Object.freeze({ warm: 454, 'warm white': 454, soft: 400, white: 250, daylight: 200, cool: 153, 'cool white': 153 })
const LEAD = String.raw`^\s*(?:(?:hey\s+)?nori[,:\s]+)?(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+)?`
const COMMAND = new RegExp(`${LEAD}(?:turn|switch|shut|set|dim|brighten|make|put|change)\\b`, 'i')
const LIGHT_WORD = /\b(?:lights?|lamps?|bulbs?)\b/i
const PAIRING = /\b(?:connect|pair|link|re-?pair|set\s*up|setup)\b.{0,30}\bhue\b|\bhue\b.{0,30}\b(?:connect|pair|link|set\s*up|setup)\b/i
const LISTING = new RegExp(`${LEAD}(?:list|show)\\b.{0,20}\\b(?:my\\s+)?(?:hue\\s+)?(?:lights|lamps|bulbs|rooms)\\b|${LEAD}(?:which|what)\\s+(?:hue\\s+)?(?:lights|lamps)\\s+are\\s+(?:on|off)\\b`, 'i')

/** True only for explicit light commands, light listings, or Hue pairing. */
export function requestsHue(text) {
  const value = String(text ?? '').trim()
  if (/\blight\s+(?:mode|theme|weight|year|reading)\b/i.test(value)) return false
  if (PAIRING.test(value) || LISTING.test(value)) return true
  if (COMMAND.test(value)) return LIGHT_WORD.test(value) || roomColor(value) || /\bhue\b.{0,15}\b(?:lights?|bridge)\b/i.test(value)
    || /^\s*(?:please\s+)?(?:dim|brighten)\b/i.test(value)
  // Short forms such as "lights off" or "kitchen lights on".
  return /^\s*(?:the\s+)?(?:[a-z]+\s+){0,2}(?:lights?|lamps?)\s+(?:on|off)\s*[.!]*$/i.test(value)
}

export function requestsHuePairing(text) { return PAIRING.test(String(text ?? '')) }

function assertActive(signal) { if (signal?.aborted) throw signal.reason || new Error('Nori request cancelled') }

function configPath(dataRoot) { return path.join(dataRoot, 'hue', 'bridge.json') }

function readConfig(dataRoot) {
  try {
    const value = JSON.parse(readFileSync(configPath(dataRoot), 'utf8'))
    if (value?.schema === 'nori.hue-bridge.v1' && PRIVATE_IP.test(value.ip)) return value
  } catch {}
  return null
}

function writeConfig(dataRoot, value, { signal } = {}) {
  assertActive(signal)
  const file = configPath(dataRoot)
  mkdirSync(path.dirname(file), { recursive: true })
  assertActive(signal)
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 1)}\n`, { encoding: 'utf8' })
  assertActive(signal)
  renameSync(temporary, file)
  assertActive(signal)
}

async function hueFetch(ip, route, { method = 'GET', body, fetcher = fetch, signal } = {}) {
  assertActive(signal)
  if (!PRIVATE_IP.test(ip)) throw new Error('the Hue bridge address is not on your private network')
  const response = await fetcher(`http://${ip}${route}`, { method, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000),
    headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  assertActive(signal)
  const text = await response.text()
  assertActive(signal)
  if (text.length > 2_000_000) throw new Error('the Hue bridge reply was too large')
  return JSON.parse(text)
}

async function bridgeAt(ip, fetcher, signal) {
  assertActive(signal)
  try {
    const config = await hueFetch(ip, '/api/config', { fetcher, signal })
    const looksLikeBridge = typeof config?.bridgeid === 'string'
      && (/hue/i.test(String(config.name)) || /^BSB/.test(String(config.modelid)))
    return looksLikeBridge ? config : null
  } catch (error) { assertActive(signal); return null }
}

/** Finds the bridge from saved config (same bridge id), then from Nori's network inventory or a scan. */
async function findBridge(dataRoot, fetcher, scan = scanHomeNetwork, signal) {
  assertActive(signal)
  const saved = readConfig(dataRoot)
  assertActive(signal)
  if (saved) {
    const config = await bridgeAt(saved.ip, fetcher, signal)
    assertActive(signal)
    // The key is only sent to the bridge it was issued by, even if DHCP reused the address.
    if (config && (!saved.bridgeid || config.bridgeid === saved.bridgeid)) return { ip: saved.ip, saved, bridgeid: config.bridgeid }
  }
  const isHue = device => HUE_PREFIXES.some(prefix => device.mac?.startsWith(prefix))
  let candidates = []
  try {
    const inventory = JSON.parse(readFileSync(path.join(dataRoot, 'network', 'inventory.json'), 'utf8'))
    candidates = Object.values(inventory.devices || {}).filter(isHue).map(device => device.last_ip)
  } catch {}
  if (!candidates.length) {
    try { candidates = (await scan({ signal })).devices.filter(isHue).map(device => device.ip); assertActive(signal) } catch (error) { assertActive(signal) }
  }
  for (const ip of [...new Set(candidates)].filter(ip => PRIVATE_IP.test(ip))) {
    const config = await bridgeAt(ip, fetcher, signal)
    assertActive(signal)
    if (config) {
      const sameBridge = saved?.bridgeid && saved.bridgeid === config.bridgeid
      if (sameBridge && saved.ip !== ip) writeConfig(dataRoot, { ...saved, ip }, { signal })
      return { ip, saved: sameBridge ? { ...saved, ip } : null, bridgeid: config.bridgeid }
    }
  }
  return null
}

async function keyWorks(ip, key, fetcher, signal) {
  assertActive(signal)
  try {
    // /config answers even for a revoked key; /lights reports an unauthorized-user error.
    const reply = await hueFetch(ip, `/api/${key}/lights`, { fetcher, signal })
    return !(Array.isArray(reply) && reply[0]?.error)
  } catch (error) { assertActive(signal); return true } // a network hiccup is not proof the key was revoked
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  assertActive(signal)
  const finish = () => { signal?.removeEventListener('abort', cancel); resolve() }
  const timer = setTimeout(finish, ms)
  const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(signal.reason || new Error('Nori request cancelled')) }
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
})

/** Pairing generator: asks for the link button, then polls until the deadline. */
export async function* pairHue(dataRoot, { fetcher = fetch, waitMs = 30000, pollMs = 2000, signal } = {}) {
  assertActive(signal)
  const found = await findBridge(dataRoot, fetcher, undefined, signal)
  assertActive(signal)
  if (!found) { yield 'I couldn\'t find a Hue Bridge on your network. Ask me to scan the network first so I can locate it.'; return }
  const alreadyPaired = found.saved?.key && await keyWorks(found.ip, found.saved.key, fetcher, signal)
  assertActive(signal)
  if (alreadyPaired) { yield `I'm already paired with your Hue Bridge at ${found.ip}.`; return }
  yield `I found your Hue Bridge at ${found.ip}. Press the round button on top of the bridge now; I'll wait up to ${Math.round(waitMs / 1000)} seconds.\n\n`
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    assertActive(signal)
    const reply = await hueFetch(found.ip, '/api', { method: 'POST', body: { devicetype: 'nori#desktop' }, fetcher, signal })
    assertActive(signal)
    const key = reply?.[0]?.success?.username
    if (typeof key === 'string' && /^[A-Za-z0-9-]{20,80}$/.test(key)) {
      writeConfig(dataRoot, { schema: 'nori.hue-bridge.v1', ip: found.ip, bridgeid: found.bridgeid ?? null, key, paired_at: new Date().toISOString() }, { signal })
      yield 'Paired. I can control your Hue lights now; try "list my lights".'
      return
    }
    if (reply?.[0]?.error?.type !== 101) { yield `The bridge refused pairing: ${String(reply?.[0]?.error?.description || 'unknown reply').slice(0, 120)}.`; return }
    await sleep(pollMs, signal)
  }
  yield 'The button wasn\'t pressed in time, so nothing was paired. Say "connect my hue lights" to try again.'
}

function words(value) { return ` ${String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} ` }

export function parseAction(text) {
  const value = String(text).toLowerCase()
  // "Off" wins outright, so a color in a room name ("red room") cannot turn lights on.
  if (/\b(?:off|shut)\b/.test(value) && !/\boff\s+white\b/.test(value)) return { on: false }
  const action = {}
  if (/\bon\b|\bbrighten|\bbrighter\b/.test(value)) action.on = true
  const percent = value.match(/\b(\d{1,3})\s*(?:%|percent)/)
  if (percent) {
    const pct = Math.min(100, Number(percent[1]))
    if (pct === 0) return { on: false }
    action.on = true; action.bri = Math.max(1, Math.round(pct * 2.54))
  } else if (/\b(?:dim|darker|low)\b/.test(value)) { action.on = true; action.bri = 64 }
  else if (/\b(?:brighten|brighter|full|max)\b/.test(value)) { action.on = true; action.bri = 254 }
  const white = Object.keys(WHITES).sort((a, b) => b.length - a.length).find(name => new RegExp(`\\b${name}\\b`).test(value))
  if (white) { action.on = true; action.ct = WHITES[white]; action.white = white }
  const color = Object.keys(COLORS).find(name => new RegExp(`\\b${name}\\b`).test(value))
  if (color) { action.on = true; action.xy = COLORS[color]; action.color = color; delete action.ct; delete action.white }
  return action
}

function describeAction(action) {
  if (action.on === false) return 'off'
  const parts = [action.bri ? `${Math.round(action.bri / 2.54)}% brightness` : null, action.color ?? null,
    action.white ? (action.white.includes('white') ? action.white : `${action.white} white`) : null].filter(Boolean)
  return parts.length ? `on, ${parts.join(', ')}` : 'on'
}

// Only bridge fields go to the bridge; color/white names are for the reply.
const bridgeBody = ({ on, bri, ct, xy }) => Object.fromEntries(Object.entries({ on, bri, ct, xy }).filter(([, value]) => value !== undefined))
const entriesOf = value => (value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value) : [])
const memberIds = group => (Array.isArray(group?.lights) ? group.lights : [])

/** Longest whole-word name match; empty or symbol-only names never match. */
function bestMatch(entries, wanted) {
  return entries
    .map(([id, item]) => [id, item, words(item?.name)])
    .filter(([, , name]) => name.trim() && wanted.includes(name))
    .sort((a, b) => b[2].length - a[2].length)[0] ?? null
}

/** Handles one Hue request end to end and returns the reply text (null means: run pairing). */
export async function hueRequest(text, { dataRoot, fetcher = fetch, signal } = {}) {
  assertActive(signal)
  const value = String(text ?? '')
  if (requestsHuePairing(value)) return null
  // Defense in depth: never change lights for a question, whoever calls this.
  if (!requestsHue(value)) return 'I only change the lights on a direct request, like "turn off the kitchen lights".'
  const found = await findBridge(dataRoot, fetcher, undefined, signal)
  assertActive(signal)
  if (!found) return 'I couldn\'t find a Hue Bridge on your network. Ask me to scan the network first so I can locate it.'
  const key = found.saved?.key
  if (!key) return `I can see your Hue Bridge at ${found.ip}, but I'm not paired with it yet. Say "connect my hue lights" and press the button on the bridge when I ask.`
  const groups = await hueFetch(found.ip, `/api/${key}/groups`, { fetcher, signal })
  assertActive(signal)
  if (Array.isArray(groups) && groups[0]?.error) return 'The Hue Bridge no longer accepts my key. Say "pair my hue lights" and press the bridge button to pair again.'
  const lights = await hueFetch(found.ip, `/api/${key}/lights`, { fetcher, signal })
  assertActive(signal)
  const rooms = entriesOf(groups).filter(([, group]) => ['Room', 'Zone'].includes(group?.type))
  const lightList = entriesOf(lights)
  if (LISTING.test(value)) {
    const roomLines = rooms.map(([, group]) => `- **${group.name}**: ${memberIds(group).length} light(s), ${group.state?.any_on ? 'on' : 'off'}`)
    const loose = lightList.filter(([id]) => !rooms.some(([, group]) => memberIds(group).includes(id)))
    return [`Your Hue Bridge has ${lightList.length} light(s) in ${rooms.length} room(s)/zone(s).`, ...roomLines,
      ...(loose.length ? [`Not in a room: ${loose.map(([, light]) => light?.name).join(', ')}`] : [])].join('\n')
  }
  const action = parseAction(value)
  if (!Object.keys(action).length) return 'Tell me what to do with the lights, for example "turn off the kitchen lights" or "dim the bedroom to 30%".'
  const wanted = words(value)
  const room = bestMatch(rooms, wanted)
  const light = !room && bestMatch(lightList, wanted)
  const target = room ? { route: `/groups/${room[0]}/action`, name: `${room[1].name} lights`, plural: true }
    : light ? { route: `/lights/${light[0]}/state`, name: light[1].name, plural: false }
      : /\b(?:all|every|house|home|everything)\b/i.test(value) || rooms.length <= 1
        ? { route: '/groups/0/action', name: 'All lights', plural: true } : null
  if (!target) return `Which room? I have ${rooms.map(([, group]) => group.name).join(', ') || 'no rooms'}. You can also say "all lights".`
  const result = await hueFetch(found.ip, `/api/${key}${target.route}`, { method: 'PUT', body: bridgeBody(action), fetcher, signal })
  assertActive(signal)
  const failed = Array.isArray(result) ? result.filter(item => item?.error) : [result]
  if (failed.length) return `The bridge didn't accept that: ${String(failed[0]?.error?.description || 'unknown error').slice(0, 120)}.`
  return `Done: ${target.name} ${target.plural ? 'are' : 'is'} ${describeAction(action)}.`
}
