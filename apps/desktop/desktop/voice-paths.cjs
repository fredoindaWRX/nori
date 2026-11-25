const { join, resolve } = require('node:path')

// Canonical suite layout. These defaults never depend on shell cwd or USB.
function localVoicePaths(root, env = process.env) {
  root = resolve(root)
  const python = env.NORI_TTS_PYTHON || join(root, 'runtime', 'voice', 'python310', 'python.exe')
  const launcher = join(root, 'runtime', 'voice', 'launch_worker.py')
  const worker = env.NORI_TTS_WORKER || join(root, 'apps', 'desktop', 'bridge', 'kokoro_tts.py')
  const model = env.NORI_TTS_MODEL || join(root, 'models', 'voice', 'kokoro-v1', 'kokoro-v1.0.onnx')
  const voices = env.NORI_TTS_VOICES || join(root, 'models', 'voice', 'kokoro-v1', 'voices-v1.0.bin')
  return { python, launcher, worker, model, voices,
    args: ['-I', '-B', launcher, '--kokoro', worker, model, voices] }
}

module.exports = { localVoicePaths }
