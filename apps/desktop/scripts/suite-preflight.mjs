import {statSync} from 'node:fs'
import {join} from 'node:path'

export function assertRequiredFiles(paths){
  const missing=paths.filter(path=>{try{return !statSync(path).isFile()}catch{return true}})
  if(missing.length)throw new Error(`Suite build prerequisites missing (nothing staged):\n${missing.join('\n')}`)
}

export function assertNativeSuiteStager(source){
  if (/copyOllamaModel\s*\(|NORI_OLLAMA_HOME|suiteRoot\s*,\s*['"]ollama['"]/.test(source)) {
    throw new Error('Native suite packaging is not ready: recovered stager still bundles Ollama. Refusing to build a legacy suite under the native Nori name; nothing staged.')
  }
}

export function suiteSourceFiles(appRoot,sourceRoot){
  return [
    join(sourceRoot,'nori','main.py'),
    join(sourceRoot,'nori','config.yaml'),
    join(sourceRoot,'nori','.venv-architect','Scripts','python.exe'),
    join(appRoot,'.venv-stt','Scripts','python.exe'),
    join(appRoot,'bridge','system_hand_input.py'),
    join(appRoot,'bridge','kokoro_tts.py'),
    join(sourceRoot,'data','voice-runtime','Scripts','python.exe'),
    join(sourceRoot,'data','voice-models','kokoro-v1','kokoro-v1.0.onnx'),
    join(sourceRoot,'data','voice-models','kokoro-v1','voices-v1.0.bin'),
    join(sourceRoot,'tools','ComfyUI','.venv','Scripts','python.exe'),
    join(sourceRoot,'tools','ComfyUI','models','checkpoints','sd_xl_turbo_1.0_fp16.safetensors'),
  ]
}
