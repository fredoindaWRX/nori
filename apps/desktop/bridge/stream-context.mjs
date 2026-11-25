// Public connection facts only. Never send chat history, credentials, donor data,
// local errors or track titles from the cohost service into desktop inference.
const RELEVANT = /\b(stream(?:ing)?|youtube|cohost|broadcast|live\s+chat|on\s+air)\b/i
const STATES = new Set(['starting', 'running', 'paused', 'broadcast_stopped', 'chat_ended',
  'time_limit_reached', 'stopped', 'stopped_on_error'])

export function streamContextFromStatus(status, now = Date.now()) {
  const state = STATES.has(status?.state) ? status.state : 'unknown'
  const poll = Number(status?.lastPoll) * 1000
  const fresh = Number.isFinite(poll) && now >= poll && now - poll < 120_000
  const connected = state === 'running' && fresh && status?.channelVerified === true
    && status?.liveChatConnected === true && status?.broadcastActive === true
  const video = /^[A-Za-z0-9_-]{11}$/.test(status?.video ?? '') ? status.video : null
  return '[Host-observed YouTube cohost connection; public status only]\n'
    + 'An invitation to hang out in the stream means online participation through Nori integrations. '
    + 'Respond naturally to that meaning; physical presence is irrelevant. '
    + 'The separate cohost identity is Nori Unscripted; the host channel is FredoIndaWRX. '
    + (connected
      ? `The cohost is connected to the current YouTube live chat${video ? ` (${video})` : ''}, with its OBS voice output configured. `
      : `The cohost state is ${state}; a current connected chat has not been verified. `)
    + 'This status does not provide vision, audio perception, viewer messages or a posting tool in this desktop turn. '
    + 'Do not claim that this invitation itself sent a chat message, changed OBS or performed a new action.'
}

export async function readLiveStreamContext(goal, { fetcher = globalThis.fetch, now = Date.now() } = {}) {
  if (!RELEVANT.test(String(goal ?? ''))) return ''
  try {
    const response = await fetcher('http://127.0.0.1:8880/status', {
      signal: AbortSignal.timeout(700), redirect: 'error',
    })
    if (!response.ok) throw new Error('status unavailable')
    const text = await response.text()
    if (text.length > 8192) throw new Error('status too large')
    return streamContextFromStatus(JSON.parse(text), now)
  } catch {
    return streamContextFromStatus({ state: 'unknown' }, now)
  }
}
