import { randomBytes, timingSafeEqual } from 'node:crypto'

// Called only behind the remote server's owner/origin authentication. This
// capability identifies an explicit call, not an approval to execute tools.
export function createVoiceSession({ voice, clock = Date.now, lifetimeMs = 30 * 60 * 1000 }) {
  if (typeof voice?.transcribe !== 'function' || typeof voice?.speak !== 'function') throw Error('Local voice client required.')
  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > 30 * 60 * 1000) throw Error('Invalid call lifetime.')
  let current = null
  function endCurrent() {
    current?.controller.abort()
    current = null
  }
  function authorize(token) {
    if (current && clock() >= current.expiresAt) endCurrent()
    if (!current || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)
        || !timingSafeEqual(Buffer.from(token), Buffer.from(current.token))) throw Error('Call is not active.')
    return current
  }
  async function run(token, operation) {
    const call = authorize(token)
    if (call.busy) throw Error('A voice operation is already running.')
    call.busy = true
    const remaining = Math.max(1, call.expiresAt - clock())
    const signal = AbortSignal.any([call.controller.signal, AbortSignal.timeout(remaining)])
    try {
      const result = await operation(signal)
      signal.throwIfAborted()
      if (authorize(token) !== call) throw Error('Call was replaced.')
      return result
    } finally { call.busy = false }
  }
  return Object.freeze({
    start() {
      endCurrent()
      current = { token: randomBytes(32).toString('hex'), expiresAt: clock() + lifetimeMs,
        controller: new AbortController(), busy: false }
      return { token: current.token, expiresAt: current.expiresAt }
    },
    end(token) { authorize(token); endCurrent(); return { ended: true } },
    stop() { endCurrent() },
    transcribe(token, audio, type) { return run(token, signal => voice.transcribe(audio, { type, signal })) },
    speak(token, text) { return run(token, signal => voice.speak(text, { signal })) },
  })
}
