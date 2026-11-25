import { BRIDGE_HTTP_URL } from '../config'

/** Speech capabilities are trusted only from a bridge declaring local-only mode. */
export type Capabilities = { stt: boolean; tts: boolean }
let current: Capabilities = { stt: false, tts: false }
let probed = false
export function caps(): Capabilities { return current }
export function capabilitiesProbed(): boolean { return probed }
export async function probeCapabilities(): Promise<Capabilities> {
  current = { stt: false, tts: false }
  try {
    const res = await fetch(`${BRIDGE_HTTP_URL}/health`, {
      signal: AbortSignal.timeout(3000), redirect: 'error',
    })
    if (res.ok) {
      const h = await res.json() as { localOnly?: boolean; stt?: boolean; tts?: boolean }
      if (h.localOnly === true) current = { stt: Boolean(h.stt), tts: Boolean(h.tts) }
    }
  } catch { /* Local service unavailable: stay disabled, never use cloud transcription. */ }
  probed = true
  return current
}
export function engineLabel(): string {
  return current.stt ? 'Local Whisper' : 'Local speech input unavailable'
}
