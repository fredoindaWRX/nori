/** Recovery reads may use USB; all generated evidence stays under Nori. */
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

export const desktopRoot = fileURLToPath(new URL('../', import.meta.url))
export const noriRoot = fileURLToPath(new URL('../../../', import.meta.url))
export const voiceProbeRoot = join(noriRoot, 'verification', 'voice-probes')
export const syntheticVoiceClip = join(voiceProbeRoot, 'kokoro-readonly-probe-001.wav')
export const voiceBridge = name => {
  if (!['kokoro_tts.py', 'whisper_stt.py'].includes(name)) throw new Error('Unknown voice probe bridge')
  return join(desktopRoot, 'bridge', name)
}
