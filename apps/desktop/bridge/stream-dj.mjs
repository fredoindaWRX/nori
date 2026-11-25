// Explicit owner intent only; no model-selected tools, arbitrary URLs or commands.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'

async function readDjToken() {
  // Packaged launches may inherit a redirected LOCALAPPDATA. Both candidates
  // stay within this Windows user's profile; never search other users or models.
  const candidates = [...new Set([
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA,'NoriCohost','dj-control.token'),
    join(homedir(),'AppData','Local','NoriCohost','dj-control.token'),
  ].filter(Boolean))]
  let failure
  for (const path of candidates) {
    try { return await readFile(path,'utf8') } catch (error) {
      if (error.code!=='ENOENT') throw error
      failure=error
    }
  }
  throw failure
}

export function requestsStreamDj(goal) {
  return /^(?:hey\s+)?(?:nori[, ]+)?(?:please\s+)?(?:dj(?:\s+the)?\s+stream|start\s+(?:the\s+)?(?:stream\s+music|music\s+(?:on|for)\s+(?:the\s+)?stream))(?:\s+(?:please|for me))?[.! ]*$/i.test(String(goal).trim())
}

export async function readStreamDjContext(goal, { fetcher = fetch } = {}) {
  if (!/\b(?:stream|streaming|youtube|dj|cohost|chat)\b/i.test(String(goal))) return ''
  try {
    const response = await fetcher('http://127.0.0.1:8880/status', {signal:AbortSignal.timeout(1500),redirect:'error'})
    if (!response.ok) throw Error('unavailable')
    const state = await response.json()
    const fresh = Math.abs(Date.now()-Number(state.lastPoll)*1000)<120000
    const connected = fresh && state.state==='running' && state.liveChatConnected===true
    return '[Host-observed stream integration facts]\n'
      + `The local stream service is reachable. Nori Unscripted live chat is ${connected?'connected':'not verified connected'}. `
      + 'A separate two-deck electronic music player performs automatic blends in OBS. '
      + 'The desktop has one bounded music action: the explicit request "Nori, DJ the stream" checks live OBS music output and enables the existing player. '
      + 'YouTube replies require !nori <question>; ordinary conversation does not trigger chat posts. '
      + 'Explain these available integrations accurately. Do not describe yourself as only a text model with no integrations. '
      + 'These facts provide no screen vision, audio perception, general media controls, arbitrary browsing, or proof this turn changed anything.'
  } catch { return '[Stream integration unavailable]\nNori has a configured local cohost and music bridge, but current connectivity could not be verified. Do not claim a new action succeeded.' }
}

export async function startStreamDj(goal, { fetcher = fetch, tokenReader } = {}) {
  if (!requestsStreamDj(goal)) return null
  try {
    const token = tokenReader ? await tokenReader() : await readDjToken()
    const response = await fetcher('http://127.0.0.1:8880/dj-start', {
      method: 'POST', headers: { Origin: 'http://127.0.0.1:8880', 'X-Nori-DJ-Token': token.trim() },
      signal: AbortSignal.timeout(12000), redirect: 'error',
    })
    const result = await response.json()
    if (!response.ok || result.playing !== true || result.broadcastActive !== true)
      return 'I could not verify music going to the live stream. Please check the stream music player in OBS.'
    return 'I am Nori. The electronic mix is playing on the live stream. The two-deck player is handling continuous blends, and chat stays command-only.'
  } catch (error) {
    const reason = error?.code==='ENOENT' ? 'The local DJ connection token is missing.'
      : error?.name==='TimeoutError' ? 'The local DJ output check timed out.'
      : error?.code==='EACCES'||error?.code==='EPERM' ? 'Windows denied access to the local DJ connection.'
      : 'The local DJ connection failed.'
    return `${reason} I have not confirmed the mix is playing.`
  }
}
