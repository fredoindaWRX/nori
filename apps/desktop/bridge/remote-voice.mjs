import { decodeNeuraleseSpeech } from './neuralese-speech.mjs'

const AUDIO_TYPES = new Set(['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/wav'])

async function boundedBody(response, limit) {
  if (!response.body) throw Error('Local speech service returned no body.')
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) throw Error('Local speech response exceeded its limit.')
      chunks.push(Buffer.from(value))
    }
    return Buffer.concat(chunks, size)
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  } finally { reader.releaseLock() }
}

// Transport only: the caller must authenticate the phone and obtain explicit
// microphone consent. A transcript never grants permission to execute a tool.
export function createLocalVoiceClient({ baseUrl, fetchImpl = fetch, timeoutMs = 60000 }) {
  const base = new URL(baseUrl)
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port
      || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw Error('Speech must use an explicit local loopback bridge.')
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw Error('Invalid speech deadline.')
  async function request(path, body, contentType, limit, expectedType, signal) {
    const deadline = AbortSignal.timeout(timeoutMs)
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline
    combined.throwIfAborted()
    const response = await fetchImpl(new URL(path, base), {
      method: 'POST', headers: { 'content-type': contentType }, body,
      redirect: 'error', signal: combined,
    })
    if (!response.ok || (response.headers.get('content-type') || '').split(';')[0].trim() !== expectedType) {
      await response.body?.cancel().catch(() => {})
      throw Error('Local speech service unavailable or returned an invalid response; no cloud fallback.')
    }
    const result = await boundedBody(response, limit)
    combined.throwIfAborted()
    return result
  }
  return Object.freeze({
    async transcribe(audio, { type = 'audio/webm', signal } = {}) {
      if (!(audio instanceof Uint8Array) || audio.byteLength < 1 || audio.byteLength > 8 * 1024 * 1024 || !AUDIO_TYPES.has(type)) {
        throw Error('Invalid or oversized voice recording.')
      }
      const bytes = await request('/stt-local', audio, type, 128 * 1024, 'application/json', signal)
      return decodeNeuraleseSpeech(JSON.parse(bytes.toString('utf8')))
    },
    async speak(text, { signal } = {}) {
      if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw Error('Speech text must contain 1..2000 characters.')
      const audio = await request('/tts', JSON.stringify({ text }), 'application/json', 16 * 1024 * 1024, 'audio/wav', signal)
      if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
        throw Error('Local voice returned invalid WAV audio.')
      }
      return audio
    },
  })
}
