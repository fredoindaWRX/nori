/** Nori frontend configuration: local inference and local speech only. */
function str(raw: unknown): string | undefined {
  const value = typeof raw === 'string' ? raw.trim() : ''
  return value || undefined
}

export const BACKEND = 'bridge' as const
declare global {
  interface Window { noriWake?: { reveal: () => Promise<boolean>; consume: () => Promise<boolean> } }
  interface Window {
    noriConnection?: { bridgeUrl: string; handInputUrl?: string; workspaceProbe: boolean }
  }
}
const bridgeUrl = new URL(str(window.noriConnection?.bridgeUrl) ?? str(import.meta.env.VITE_BRIDGE_URL) ?? 'ws://localhost:8787')
if (bridgeUrl.protocol !== 'ws:' || !['localhost', '127.0.0.1', '[::1]'].includes(bridgeUrl.hostname) ||
    bridgeUrl.username || bridgeUrl.password || bridgeUrl.search || bridgeUrl.hash) {
  throw new Error('VITE_BRIDGE_URL must be a local loopback WebSocket in free/local mode')
}
export const BRIDGE_WS_URL = bridgeUrl.href.replace(/\/$/, '')
export const BRIDGE_HTTP_URL = BRIDGE_WS_URL.replace(/^ws/, 'http')

// Historical names remain source-compatible, but cannot enable cloud output.
// The keys are permanently empty: Nori makes no provider calls from the
// renderer, so no credential is read, stored or forwarded from here.
export const USE_ELEVENLABS = false
export const TTS_ENGINE = 'system' as const
export const WAKE_ENGINE = 'local-whisper' as const
export const env = { anthropicKey: '', elevenKey: '', elevenVoiceId: '' }
