import { parseAction, requestsHue, roomColor } from './hue.mjs'
import { parseTvAction } from './samsung-tv.mjs'
import { targetOf } from './app-launcher.mjs'
import { networkLabelRequest } from './network-watch.mjs'
import { requestsWeather, weatherPlace } from './weather.mjs'

// Owner binding for model-chosen home tools. The detector below only routes a
// turn to the model with home tools; it never authorizes anything. Every value
// a model puts in a device call (verb, room, level, colour, app, query, label)
// must be present in the owner's own current message, and the canonical
// sentence built from those values must re-parse, through the same parser the
// exact-phrase route uses, to the same action. Anything else is refused.
const POLITE = /^\s*(?:(?:hey\s+)?nori[,:\s]+)?(?:(?:please|can you|could you|would you|will you)\s+)*/i
const NEGATIONS = new Set(['not', 'never', 'without', "don't", 'dont', "doesn't", "didn't", "shouldn't", "won't", "mustn't", "isn't", "aren't"])
const LIGHT_WORDS = ['light', 'lights', 'lamp', 'lamps', 'bulb', 'bulbs', 'hue']
const TV_WORDS = ['tv', 'television', 'telly', 'samsung']
const ALL_WORDS = ['all', 'every', 'everything', 'whole', 'house']
// "the kitchen is too bright, dim it": a room plus a brightness word is about the lights.
const ROOM = /\b(?:kitchen|bedroom|living\s*room|bathroom|office|hall(?:way)?|den|garage|dining\s*room|basement|nursery)\b/i
const BRIGHTNESS = /\b(?:dim|brighten|too\s+(?:bright|dark)|(?:so|very|kinda|kind\s+of|really|pretty)\s+(?:bright|dark)|dark\s+in|bright\s+in)\b/i
const roomLight = text => (ROOM.test(text) && BRIGHTNESS.test(text)) || roomColor(text)
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/
const MAC = /^[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}$/i
const SAFE_NAME = /^[a-z0-9][a-z0-9 '+.&-]{0,59}$/i

const DOMAINS = Object.freeze({
  hub: text => /\b(?:home hub|device hub|smartthings|home assistant|vacuum|robot vacuum)\b|\b(?:list|show|discover|see|use|control)\b[^.!?]{0,35}\bdevices\b|\b(?:light|switch|vacuum)\.[a-z0-9_]+/i.test(text),
  hue: text => (/\b(?:lights?|lamps?|bulbs?|hue)\b/i.test(text) || roomLight(text)) &&!/\blight\s+(?:mode|theme|weight|year|reading)\b/i.test(text),
  tv: text => /\b(?:tv|television|telly|netflix|youtube|volume|mute|unmute)\b/i.test(text),
  app: text => /(?:^|[,;.!?]\s*|\b(?:and|then)\s+)(?:(?:hey\s+)?nori[,:\s]+)?(?:please\s+|can you\s+|could you\s+)?(?:open|launch|fire\s+up)\s+(?:up\s+)?(?:the\s+|my\s+)?[a-z0-9]/i.test(text)
    && !/\b(?:files?|folders?|documents?|reports?|photos?|pictures?|websites?|site|page|tabs?|browser|door|window|settings|workspace|memory|camera)\b|https?:|www\.|\.com\b|\bopen\s+source\b/i.test(text),
  network: text => !/\bneural\s+network|\b(?:devtools|repo|repository|code|chrome|browser)\b/i.test(text)
    && (/\b(?:wi-?fi|router|lan)\b|\b(?:my|our|home|local|the)\s+(?:home\s+)?network\b|\bconnected\s+devices\b|\bdevices?\s+(?:are\s+)?(?:on|connected)\b/i.test(text)
      || /\b(?:label|name|call|rename)\s+(?:(?:\d{1,3}\.){3}\d{1,3}|[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5})\b/i.test(text)),
  weather: text => requestsWeather(text) || /\b(?:umbrella|forecast)\b/i.test(text),
})

/** Which home domains the owner's text mentions (routing only). */
export function homeDomains(text) {
  const value = String(text ?? '')
  if (!value.trim() || value.length > 4000) return new Set()
  return new Set(Object.entries(DOMAINS).filter(([, test]) => test(value)).map(([name]) => name))
}

/** Loose detector that routes a turn to the home tools; it never authorizes an action. */
export function mentionsHomeDevice(text) { return homeDomains(text).size > 0 }

/** Lower-case word list of the owner's text, digits kept, polite prefix removed. */
export function ownerTokens(text) {
  return String(text ?? '').toLowerCase().replace(/[’‘]/g, "'").replace(POLITE, '').replace(/(\d)\s*%/g, '$1 %')
    .split(/[^a-z0-9+%']+/).map(token => token.replace(/^'+|'+$/g, '')).filter(Boolean)
}

const same = (a, b) => a === b || a === `${b}s` || `${a}s` === b
const hasWord = (tokens, word) => tokens.some(token => same(token, word))
const hasAny = (tokens, words) => words.some(word => hasWord(tokens, word))
const wordsOf = value => ownerTokens(value).filter(token => token !== '%')
const allIn = (value, tokens) => { const list = wordsOf(value); return list.length > 0 && list.every(word => hasWord(tokens, word)) }

/** True when a negation sits within `distance` tokens of any of `words`. */
export function hasNegationNear(text, words, distance = 4) {
  const tokens = ownerTokens(text)
  const wanted = words.flatMap(wordsOf)
  const negations = tokens.map((token, index) => (NEGATIONS.has(token) ? index : -1)).filter(index => index >= 0)
  if (!negations.length) return false
  return tokens.some((token, index) => wanted.some(word => same(token, word)) && negations.some(at => Math.abs(at - index) <= distance))
}

/** A question, not a command ("what is a hue bridge?", "is it going to rain"). */
export function isPureQuestion(text) {
  const value = String(text ?? '').trim().toLowerCase().replace(POLITE, '')
  if (/^(?:what|which|who|why|how|when|where|is|are|was|were|does|did|do)\b/.test(value)) return true
  return /\?\s*$/.test(value) && !/^(?:turn|switch|set|put|make|dim|brighten|open|launch|start|mute|unmute|play|show|list|scan|call|name|label|rename)\b/.test(value)
}

const refuse = (error, hint) => ({ ok: false, error, hint })
const ok = (canonical, extra = {}) => ({ ok: true, canonical, ...extra })

function guarded(owner, words) {
  if (hasNegationNear(owner, words)) return refuse('The owner\'s message contains a negation near this request; nothing was sent.', 'Ask the owner to confirm what they want.')
  return null
}

const HUE_VERBS = { on: ['on', 'up'], off: ['off', 'out'], dim: ['dim', 'dimmer', 'darker', 'lower', 'down'], brighten: ['brighten', 'brighter'], list: ['list', 'show', 'which', 'what'] }

function hueProjection(action) {
  return Object.fromEntries(Object.entries({ on: action.on, bri: action.bri, color: action.color, white: action.white }).filter(([, value]) => value !== undefined))
}

function hueExpected(args) {
  if (args.command === 'off') return { on: false }
  if (args.command === 'dim') return { on: true, bri: 64 }
  if (args.command === 'brighten') return { on: true, bri: 254 }
  return hueProjection({ on: true, bri: args.brightness_pct ? Math.max(1, Math.round(Math.min(100, args.brightness_pct) * 2.54)) : undefined, color: args.color, white: args.white })
}

/** Binds hue_lights arguments to the owner's words and builds the canonical command. */
export function bindHue(args = {}, ownerText = '') {
  const tokens = ownerTokens(ownerText)
  const { command: action, target, brightness_pct: pct, color, white } = args
  if (!hasAny(tokens, LIGHT_WORDS) && !roomLight(String(ownerText))) return refuse('The owner did not mention lights in this message.', 'Do not use hue_lights unless the owner asks about lights.')
  if (action === 'list') {
    if (!hasAny(tokens, HUE_VERBS.list)) return refuse('The owner did not ask to list the lights.', 'Answer in text instead.')
    return ok('list my lights')
  }
  if (!['on', 'off', 'dim', 'brighten', 'set_brightness', 'set_color', 'set_white'].includes(action)) return refuse('Unknown light action.', 'Use one listed action.')
  if (isPureQuestion(ownerText)) return refuse('The owner asked a question, not for a light change; nothing was sent.', 'Answer the question in text.')
  const extrasAllowed = ['on', 'set_brightness', 'set_color', 'set_white'].includes(action)
  if (!extrasAllowed && (pct !== undefined || color !== undefined || white !== undefined)) return refuse('That light action takes no level or colour.', 'Remove the extra values.')
  if (color !== undefined && white !== undefined) return refuse('Choose a colour or a white, not both.', 'Use the one the owner said.')
  if (action === 'set_brightness' && pct === undefined) return refuse('set_brightness needs brightness_pct.', 'Use the number the owner said.')
  if (action === 'set_color' && color === undefined) return refuse('set_color needs color.', 'Use the colour the owner said.')
  if (action === 'set_white' && white === undefined) return refuse('set_white needs white.', 'Use the white the owner said.')
  if (pct !== undefined && !(Number.isSafeInteger(pct) && pct >= 1 && pct <= 100)) return refuse('brightness_pct must be a whole number from 1 to 100.', 'Use the owner\'s number.')
  const verbs = HUE_VERBS[action] ?? []
  if (verbs.length && !hasAny(tokens, verbs)) return refuse(`The owner did not ask to turn the lights ${action}.`, `The owner's words do not include ${verbs.map(word => `"${word}"`).join(' or ')}.`)
  if (pct !== undefined && !tokens.includes(String(pct))) return refuse(`The owner did not say ${pct}%.`, 'Use only a level the owner said.')
  if (color !== undefined && !tokens.includes(String(color))) return refuse(`The owner did not ask for ${color}.`, 'Use only a colour the owner said.')
  if (white !== undefined && !tokens.includes(String(white))) return refuse(`The owner did not ask for ${white}.`, 'Use only a white the owner said.')
  let place = 'the lights'
  if (target !== undefined && String(target).trim()) {
    const name = String(target).trim().toLowerCase()
    if (name.length > 40 || !SAFE_NAME.test(name)) return refuse('That room or light name is not usable.', 'Use the owner\'s exact room name.')
    if (ALL_WORDS.includes(name) || name === 'all lights') {
      if (!hasAny(tokens, ALL_WORDS)) return refuse('The owner did not say all lights.', 'Ask which room.')
      place = 'all the lights'
    } else {
      if (!allIn(name, tokens)) return refuse(`The owner did not name "${name}".`, 'Use only a room or light the owner named, or ask which lights.')
      place = /\b(?:lights?|lamps?|bulbs?)$/.test(name) ? `the ${name}` : `the ${name} lights`
    }
  } else if (hasAny(tokens, ALL_WORDS)) place = 'all the lights'
  const block = guarded(ownerText, [...verbs, ...LIGHT_WORDS, ...(target ? [String(target)] : [])])
  if (block) return block
  const suffix = [pct !== undefined ? `${pct}%` : '', color ?? '', white ?? ''].filter(Boolean).join(' ')
  const canonical = action === 'off' ? `turn off ${place}` : action === 'dim' ? `dim ${place}` : action === 'brighten' ? `brighten ${place}`
    : action === 'on' ? `turn on ${place}${suffix ? ` ${suffix}` : ''}` : `set ${place} to ${suffix}`
  if (!requestsHue(canonical) || JSON.stringify(hueProjection(parseAction(canonical))) !== JSON.stringify(hueExpected(args))) {
    return refuse('Those light values do not form a command Nori can verify.', 'Use the owner\'s own room and setting words.')
  }
  return ok(canonical)
}

const TV_APP_WORDS = { netflix: ['netflix'], youtube: ['youtube'], 'prime video': ['prime'], 'disney+': ['disney'], hulu: ['hulu'], spotify: ['spotify'] }

/** Binds tv_control arguments to the owner's words and builds the canonical command. */
export function bindTv(args = {}, ownerText = '') {
  const tokens = ownerTokens(ownerText)
  const { command: action, level, steps, app, query } = args
  if (!hasAny(tokens, TV_WORDS)) return refuse('The owner did not mention the TV in this message.', 'Do not use tv_control unless the owner asks about the TV.')
  if (isPureQuestion(ownerText)) return refuse('The owner asked a question, not for a TV command; nothing was sent.', 'Answer the question in text.')
  const need = (words, label) => (hasAny(tokens, words) ? null : refuse(`The owner did not ask to ${label}.`, `The owner's words do not include ${words.map(word => `"${word}"`).join(' or ')}.`))
  let canonical, check, words
  if (action === 'power_on') { words = ['on']; canonical = 'turn on the tv'; check = parsed => parsed.power === 'on' }
  else if (action === 'mute') { words = ['mute', 'muted']; canonical = 'mute the tv'; check = parsed => parsed.mute === true }
  else if (action === 'unmute') { words = ['unmute', 'unmuted']; canonical = 'unmute the tv'; check = parsed => parsed.mute === false }
  else if (action === 'set_volume') {
    if (!Number.isSafeInteger(level) || level < 0 || level > 100) return refuse('level must be a whole number from 0 to 100.', 'Use the owner\'s number.')
    if (!tokens.includes(String(level))) return refuse(`The owner did not say volume ${level}.`, 'Use only a level the owner said.')
    words = ['volume', 'sound']; canonical = `set the tv volume to ${level}`; check = parsed => parsed.setVolume === level
  } else if (action === 'volume_up' || action === 'volume_down') {
    const up = action === 'volume_up'
    if (steps !== undefined && !(Number.isSafeInteger(steps) && steps >= 1 && steps <= 10)) return refuse('steps must be 1 to 10.', 'Use the owner\'s number.')
    if (steps !== undefined && !tokens.includes(String(steps))) return refuse(`The owner did not say ${steps} steps.`, 'Omit steps unless the owner said a number.')
    words = up ? ['up', 'louder', 'raise', 'increase'] : ['down', 'quieter', 'lower', 'decrease', 'softer']
    canonical = `turn the tv volume ${up ? 'up' : 'down'}${steps !== undefined ? ` by ${steps}` : ''}`
    check = parsed => Array.isArray(parsed.keys) && parsed.keys.length === (steps ?? 2) && parsed.keys.every(key => key === (up ? 'KEY_VOLUP' : 'KEY_VOLDOWN'))
  } else if (action === 'open_app') {
    if (!Object.hasOwn(TV_APP_WORDS, app)) return refuse('open_app needs one listed TV app.', 'Use the app the owner named.')
    words = TV_APP_WORDS[app]; canonical = `open ${app} on the tv`; check = parsed => parsed.app === app
  } else if (action === 'input_menu') { words = ['input', 'source', 'hdmi']; canonical = 'open the input menu on the tv'; check = parsed => parsed.keys?.[0] === 'KEY_SOURCE' }
  else if (action === 'home') { words = ['home']; canonical = 'open the home screen on the tv'; check = parsed => parsed.keys?.[0] === 'KEY_HOME' }
  else if (action === 'play_youtube') {
    const text = String(query ?? '').trim().toLowerCase()
    if (!text || text.length > 80 || !SAFE_NAME.test(text)) return refuse('play_youtube needs a short plain search query.', 'Use the owner\'s words.')
    if (!allIn(text, tokens)) return refuse('The owner did not ask for that video.', 'Use only words the owner said for the search.')
    words = ['youtube']; canonical = `play ${text} on youtube on the tv`
    check = parsed => typeof parsed.youtube === 'string' && parsed.youtube.length > 0 && allIn(parsed.youtube, tokens)
  } else return refuse('Unknown TV action.', 'Use one listed action; the TV cannot be powered off.')
  const missing = need(words, action.replace(/_/g, ' '))
  if (missing) return missing
  const block = guarded(ownerText, [...words, ...TV_WORDS])
  if (block) return block
  const parsed = parseTvAction(canonical)
  if (parsed?.unsupported) return refuse(parsed.unsupported, 'Tell the owner plainly.')
  if (!parsed || parsed.pair || parsed.say !== undefined || !check(parsed)) return refuse('Those TV values do not form a command Nori can verify.', 'Use the owner\'s own words.')
  return ok(canonical)
}

/** Binds launch_app arguments: the app name must be the owner's own words. */
export function bindApp(args = {}, ownerText = '') {
  const tokens = ownerTokens(ownerText)
  const name = String(args.name ?? '').trim()
  const checkOnly = args.check_only === true
  if (!name || name.length > 60 || !SAFE_NAME.test(name)) return refuse('launch_app needs one plain app name.', 'Use the app name the owner said.')
  if (!allIn(name, tokens)) return refuse(`The owner did not name "${name}".`, 'Use only an app the owner named.')
  if (checkOnly) {
    if (!hasAny(tokens, ['have', 'installed', 'install'])) return refuse('The owner did not ask whether an app is installed.', 'Answer in text.')
  } else {
    if (!hasAny(tokens, ['open', 'launch', 'start', 'run', 'fire', 'bring'])) return refuse('The owner did not ask to open an app.', 'The owner\'s words do not include open or launch.')
    if (isPureQuestion(ownerText)) return refuse('The owner asked a question, not to open an app; nothing was launched.', 'Answer the question in text.')
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`${escaped}\\b[^.,;!?]{0,24}\\b(?:on|to)\\s+(?:the\\s+|my\\s+)?(?:tv|television|telly)\\b`, 'i').test(ownerText)) {
      return refuse('The owner asked for that app on the TV, not on this PC.', 'Use tv_control open_app instead.')
    }
    const block = guarded(ownerText, ['open', 'launch', 'start', 'run', name])
    if (block) return block
  }
  const canonical = checkOnly ? `do I have ${name} installed` : `open ${name}`
  const parsed = targetOf(canonical)
  if (!parsed || parsed.kind !== (checkOnly ? 'have' : 'open') || parsed.target.toLowerCase() !== name.toLowerCase()) {
    return refuse('That is not a Start-menu app request Nori can verify.', 'Files, websites, Nori panels and TV apps are not launch_app targets.')
  }
  return ok(canonical)
}

/** network_scan is read-only; the owner must be asking about their own network. */
export function bindNetwork(args = {}, ownerText = '') {
  if (Object.keys(args).length) return refuse('network_scan takes no arguments.', 'Call it with {}.')
  if (!/\b(?:network|wi-?fi|router|devices?|connected|lan)\b/i.test(String(ownerText))) return refuse('The owner did not ask about their network.', 'Do not scan unless asked.')
  return ok('scan my home network')
}

/** network_label_device: the address and every label word must come from the owner. */
export function bindLabel(args = {}, ownerText = '') {
  const tokens = ownerTokens(ownerText)
  const target = String(args.target ?? '').trim()
  const label = String(args.label ?? '').trim()
  if (!IPV4.test(target) && !MAC.test(target)) return refuse('target must be an IPv4 or MAC address.', 'Use the address the owner said.')
  const flat = value => value.toLowerCase().replace(/-/g, ':')
  const literal = new RegExp(`(?:^|[^0-9a-f:.])${flat(target).replace(/\./g, '\\.')}(?![0-9a-f]|[.:][0-9a-f])`)
  if (!literal.test(flat(String(ownerText)))) return refuse(`The owner did not mention ${target}.`, 'Use only an address the owner said.')
  if (!hasAny(tokens, ['label', 'name', 'call', 'rename'])) return refuse('The owner did not ask to name a device.', 'Answer in text.')
  if (label.length > 40) return refuse('That name is longer than 40 characters, so I didn\'t save it. Try a shorter name, like "garage camera".', 'Ask for a shorter name.')
  if (label.length < 2 || /[<>`{}[\]\\"“”\n]/.test(label)) return refuse('That label is not usable.', 'Use the owner\'s plain words.')
  if (!allIn(label, tokens)) return refuse(`The owner did not call it "${label}".`, 'Use only the owner\'s words for the label.')
  const block = guarded(ownerText, ['label', 'name', 'call', 'rename'])
  if (block) return block
  const canonical = `call ${target} ${label}`
  const parsed = networkLabelRequest(canonical)
  if (!parsed || parsed.target !== flat(target) || parsed.label !== label) return refuse('That label request could not be verified.', 'Use the owner\'s exact words.')
  return ok(canonical, { label: parsed })
}

/** get_weather: the place and day must come from the owner. */
export function bindWeather(args = {}, ownerText = '') {
  const tokens = ownerTokens(ownerText)
  const place = args.place === undefined ? '' : String(args.place).trim()
  const day = args.day ?? 'today'
  if (!requestsWeather(ownerText) && !/\b(?:umbrella|rain|snow|temperature|forecast|weather)\b/i.test(String(ownerText))) return refuse('The owner did not ask about the weather.', 'Do not look up weather unless asked.')
  if (!['today', 'tomorrow', 'day_after'].includes(day)) return refuse('day must be today, tomorrow or day_after.', 'Use the owner\'s day.')
  if (day === 'tomorrow' && !tokens.includes('tomorrow')) return refuse('The owner did not ask about tomorrow.', 'Use today unless the owner named a day.')
  if (day === 'day_after' && !/\bday\s+after\b/i.test(String(ownerText))) return refuse('The owner did not ask about the day after tomorrow.', 'Use the owner\'s day.')
  if (!place) return ok('weather today', { day })
  if (place.length > 60 || !/^[a-z0-9][a-z0-9 ,'.-]{0,59}$/i.test(place)) return refuse('That place name is not usable.', 'Use the owner\'s place name.')
  if (!allIn(place, tokens)) return refuse(`The owner did not name ${place}.`, 'Omit place unless the owner named one.')
  const canonical = `weather in ${place}`
  if (String(weatherPlace(canonical) ?? '').toLowerCase() !== place.toLowerCase()) return refuse('That place name could not be verified.', 'Omit place to use this PC\'s location, or ask the owner.')
  return ok(canonical, { day })
}

function hubInventoryRequested(ownerText) {
  // Topic mentions only select the catalog. They do not authorize network reads.
  // Remove quoted material before checking the owner's direct request.
  const text = String(ownerText ?? '').replace(/[’‘]/g, "'")
    .replace(/"[^\"]*"|“[^”]*”|`[^`]*`|(?<![a-z0-9])'[^']*'(?![a-z0-9])/gi, '[quoted]')
  if (/["“”`]/.test(text)) return false
  const clauses = text.split(/[;.!?\r\n]+|\b(?:but|and then|then)\b/i).map(value => value.trim()).filter(Boolean)
  for (const clause of clauses) {
    const negated = ownerTokens(clause).some(token => NEGATIONS.has(token) || token === 'no')
    if (!negated) continue
    const inventoryDenial = /\b(?:show(?:ing)?|list(?:ing)?|discover(?:ing)?|scan(?:ning)?|query(?:ing)?|read(?:ing)?|fetch(?:ing)?|retriev(?:e|ing)|check(?:ing)?)\b/i.test(clause)
      && /\b(?:devices|inventory|home hub|device hub)\b/i.test(clause)
    const providerDenial = /\b(?:us(?:e|ing)|call(?:s|ing)?|contact(?:ing)?|connect(?:ing)?|access(?:ing)?|poll(?:ing)?|query(?:ing)?|read(?:ing)?)\b/i.test(clause)
      && /\b(?:home assistant|hue|bridge|home hub|device hub|network)\b/i.test(clause)
    if (inventoryDenial || providerDenial) return false
  }
  return clauses.some(clause => {
    const direct = clause.replace(POLITE, '').replace(/\s+/g, ' ').trim()
    return /^(?:show|list|discover|check)(?: me)? (?:(?:all|my|our|the|connected) ){0,3}(?:(?:home hub|device hub|smart home|home) )?(?:devices|inventory|connections)(?: please)?$/i.test(direct)
      || /^(?:what|which) (?:(?:home hub|smart home|home|connected) )?devices (?:do i have|can you see|are connected|are available)$/i.test(direct)
  })
}

function bindHubInventory(args, ownerText) {
  if (Object.keys(args).length || !homeDomains(ownerText).has('hub') || !hubInventoryRequested(ownerText)) return refuse('Ask to list your home devices.', 'Inventory requires a direct request without a conflicting read restriction.')
  return ok('list my home hub devices')
}
function bindHubControl(args) {
  if (Object.keys(args).some(k => !['entity_id','command'].includes(k)) || !/^(light|switch|vacuum)\.[a-z0-9_]{1,120}$/.test(args.entity_id)
    || !['turn_on','turn_off','start','pause','stop','return_to_base'].includes(args.command)) return refuse('Unsupported home device command.', 'Use an entity and command from the inventory.')
  // Exact owner-request and unique-name validation occurs against fresh inventory before dispatch.
  return ok(`${args.command} ${args.entity_id}`)
}
const BINDERS = { home_device_inventory: bindHubInventory, home_device_control: bindHubControl, hue_lights: bindHue, tv_control: bindTv, launch_app: bindApp, network_scan: bindNetwork, network_label_device: bindLabel, get_weather: bindWeather }

export function bindHomeCall(name, args, ownerText) {
  const binder = Object.hasOwn(BINDERS, name) ? BINDERS[name] : null
  if (!binder) return refuse('Unknown home tool.', 'Use only the offered tools.')
  if (!args || typeof args !== 'object' || Array.isArray(args)) return refuse('Tool arguments must be an object.', 'Return a JSON object.')
  return binder(args, ownerText)
}
