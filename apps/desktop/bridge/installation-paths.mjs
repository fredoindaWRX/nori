import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve from installed source, never the shell's current directory.
export function installationPaths(env = process.env, moduleUrl = import.meta.url) {
  const bridgeRoot = dirname(fileURLToPath(moduleUrl))
  return {
    noriRoot: env.NORI_ROOT ?? resolve(bridgeRoot, '..', '..', '..'),
    ttsWorker: env.NORI_TTS_WORKER ?? resolve(bridgeRoot, 'kokoro_tts.py'),
  }
}

export function bridgeSettingsRoot(env = process.env, moduleUrl = import.meta.url) {
  return env.NORI_SETTINGS_DIR || resolve(installationPaths(env, moduleUrl).noriRoot,
                                         'state', 'desktop', 'settings')
}

// Learning uses the same installation-owned settings location as the bridge.
// Explicit paths remain available for existing profiles and isolated tests.
export function bridgeLearningPath(env = process.env, moduleUrl = import.meta.url) {
  return env.NORI_LEARNING_FILE || join(bridgeSettingsRoot(env, moduleUrl), 'learned-guidance.json')
}
