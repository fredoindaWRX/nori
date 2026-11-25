import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { homedir } from 'node:os'
import { readFile, writeFile } from 'node:fs/promises'
import {assertRequiredFiles,assertNativeSuiteStager,suiteSourceFiles} from './suite-preflight.mjs'
import {verifiedCopy} from './verified-copy.mjs'
import {whisperSource,whisperFiles} from './whisper-payload.mjs'

// Direct stage:suite must obey the same native-only gate as package:windows.
// Keep this before any prerequisite reads, directory creation, or payload copy.
assertNativeSuiteStager(readFileSync(new URL(import.meta.url), 'utf8'))

const appRoot = resolve(import.meta.dirname, '..')
const sourceRoot = resolve(process.env.NORI_SUITE_SOURCE || 'C:/Nori')
const outputRoot = join(appRoot, 'release', 'suite-payload')
const suiteRoot = join(outputRoot, 'NoriSuite')
const modelStore = join(outputRoot, 'model-store')
const deepModelStore = join(outputRoot, 'deep-model-store')
const ollamaSource = process.env.NORI_OLLAMA_HOME || join(homedir(), '.ollama', 'models')
// Check indispensable source files before creating or changing a payload.
assertRequiredFiles(suiteSourceFiles(appRoot, sourceRoot))
const whisperModelSource=whisperSource(join(homedir(),'.cache','huggingface','hub'),process.env.NORI_WHISPER_SOURCE)
const resumeStage = existsSync(outputRoot)
if (resumeStage && !(
  existsSync(join(suiteRoot, 'nori', 'config.yaml')) &&
  existsSync(join(suiteRoot, 'tools', 'ComfyUI')) &&
  existsSync(join(suiteRoot, 'ollama', 'lib')) &&
  existsSync(modelStore)
)) throw new Error(`Refusing to reuse an unrecognized staging folder: ${outputRoot}`)
if (resumeStage) console.log('[suite] Resuming this script’s existing curated payload staging…')
mkdirSync(suiteRoot, { recursive: true })
mkdirSync(modelStore, { recursive: true })

const runtimeExtensions = new Set(['.py', '.json', '.yaml', '.yml', '.toml', '.txt', '.md'])
const runtimeExcluded = new Set([
  '.git', '.pytest_cache', '__pycache__', '.venv-architect', '.venv-mcp',
  'OS', 'runtime-data', 'data', 'backups', 'build', 'build-tools', 'android-client',
  'docs', 'Documentation', 'examples', 'References', 'tablet_ui', 'tests', 'tests_startup',
  'Logs', 'logs', 'output', 'node_modules',
])

function copyTree(source, destination, { excluded = new Set(), acceptFile = () => true } = {}) {
  if (!existsSync(source)) throw new Error(`Required suite source is missing: ${source}`)
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || excluded.has(entry.name)) continue
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) copyTree(from, to, { excluded, acceptFile })
    else if (entry.isFile() && acceptFile(from, relative(source, from))) {
      mkdirSync(dirname(to), { recursive: true })
      verifiedCopy(from, to)
    }
  }
}

function copyFile(source, destination) {
  if (!existsSync(source) || !statSync(source).isFile()) throw new Error(`Required suite file is missing: ${source}`)
  mkdirSync(dirname(destination), { recursive: true })
  verifiedCopy(source, destination)
}

function copyRuntimeTree(source, destination, excluded = runtimeExcluded) {
  copyTree(source, destination, {
    excluded,
    acceptFile: (file) => runtimeExtensions.has(extname(file).toLowerCase()),
  })
}

function copyPythonRuntime(source, destination) {
  copyTree(source, destination, {
    excluded: new Set(['__pycache__', 'site-packages']),
    acceptFile: () => true,
  })
}

function requireFile(path) {
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Required suite file is missing: ${path}`)
}

function copyOllamaModel(library, tag, targetRoot, copiedBlobs) {
  const manifestPath = join(ollamaSource, 'manifests', 'registry.ollama.ai', 'library', library, tag)
  if (!existsSync(manifestPath)) throw new Error(`Missing Ollama model manifest: ${library}:${tag}`)
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  // Ollama needs the manifest's config blob in addition to each layer. Leaving
  // it out makes copied weights appear as zero installed models to /api/tags.
  const configFilename = String(manifest.config?.digest || '').replace(':', '-')
  if (!/^sha256-[a-f0-9]{64}$/i.test(configFilename)) throw new Error(`Invalid model config digest for ${library}:${tag}`)
  if (!copiedBlobs.has(configFilename)) {
    const configSource = join(ollamaSource, 'blobs', configFilename)
    const configTarget = join(targetRoot, 'blobs', configFilename)
    if (!existsSync(configSource)) throw new Error(`Missing Ollama model config blob: ${configFilename}`)
    {
      mkdirSync(dirname(configTarget), { recursive: true })
      verifiedCopy(configSource, configTarget, configFilename.slice(7))
    }
    copiedBlobs.add(configFilename)
  }
  for (const layer of manifest.layers || []) {
    const filename = String(layer.digest || '').replace(':', '-')
    if (!/^sha256-[a-f0-9]{64}$/i.test(filename)) throw new Error(`Invalid model blob digest for ${library}:${tag}`)
    if (!copiedBlobs.has(filename)) {
      const blobSource = join(ollamaSource, 'blobs', filename)
      const blobTarget = join(targetRoot, 'blobs', filename)
      if (!existsSync(blobSource)) throw new Error(`Missing Ollama model blob: ${filename}`)
      {
        mkdirSync(dirname(blobTarget), { recursive: true })
        verifiedCopy(blobSource, blobTarget, filename.slice(7))
      }
      copiedBlobs.add(filename)
    }
  }
  const manifestTarget = join(targetRoot, 'manifests', 'registry.ollama.ai', 'library', library, tag)
  mkdirSync(dirname(manifestTarget), { recursive: true })
  verifiedCopy(manifestPath, manifestTarget)
}

console.log('[suite] Staging Council source and configuration…')
const councilSource = join(sourceRoot, 'nori')
copyRuntimeTree(councilSource, join(suiteRoot, 'nori'))
// Always refresh this entry point when resuming a payload build so package-time
// endpoint fixes are reflected in the staged Council, even after an interrupted build.
copyFileSync(join(councilSource, 'main.py'), join(suiteRoot, 'nori', 'main.py'))
copyTree(join(councilSource, '.venv-architect'), join(suiteRoot, 'nori', '.venv-architect'), {
  excluded: new Set(['__pycache__']), acceptFile: () => true,
})

// Give the portable copy a self-consistent small-model Council profile. The
// developer checkout and its larger machine-specific model assignments remain untouched.
const configPath = join(suiteRoot, 'nori', 'config.yaml')
// Always derive the portable profile from the source config. Reading the
// already-staged file here makes each resumed packaging run add another
// 10,000 to every worker port, eventually leaving the desktop probing the
// wrong Council endpoint.
const config = JSON.parse(await readFile(join(councilSource, 'config.yaml'), 'utf8'))
const localOllama = 'http://127.0.0.1:11435'
config.ollama_url = localOllama
config.models.ollama_base = localOllama
for (const knight of Object.values(config.knights)) {
  knight.model = 'qwen3.5:4b'
  knight.port = Number(knight.port) + 10000
}
config.models.assignments = Object.fromEntries(Object.entries(config.knights).map(([name, knight]) => [name, knight.model]))
if (config.models.hierarchy?.tiers) {
  for (const key of ['fast', 'worker', 'deep']) config.models.hierarchy.tiers[key].model = 'qwen3.5:4b'
}
if (config.models.hierarchy?.worker_task_models) {
  config.models.hierarchy.worker_task_models = {
    general: 'qwen3.5:4b', coding: 'qwen3.5:4b', knowledge: 'qwen3.5:4b',
    embeddings: 'embeddinggemma', rerank: 'embeddinggemma', vision: 'qwen3.5:4b',
  }
}
// The installed suite is self-contained, so its compute inventory must point
// at its private Ollama instance rather than inheriting a developer machine's
// GPU/remote-node configuration. The node is CPU-safe and can still use any
// acceleration exposed by Ollama itself.
const computeTasks = [...new Set(Object.values(config.models.hierarchy.tiers).map(({ compute_task }) => compute_task))]
config.compute = {
  nodes: [{
    id: 'nori-bundled-ollama',
    endpoint: localOllama,
    backend: 'ollama',
    accelerators: ['cpu'],
    memory_gb: 1,
    capabilities: computeTasks,
    priority: 100,
    enabled: true,
    healthy: true,
    transport: 'loopback',
    transport_verified: true,
  }],
  routing: Object.fromEntries(computeTasks.map((task) => [task, {
    capability: task,
    minimum_memory_gb: 0,
    prefer: ['cpu'],
  }])),
}
await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)

console.log('[suite] Staging portable Python runtimes…')
copyPythonRuntime(
  'C:/Users/Studio/AppData/Local/Programs/Python/Python310',
  join(suiteRoot, 'python', 'Python310'),
)
copyPythonRuntime(
  'C:/Users/Studio/AppData/Local/Programs/Python/Python311',
  join(suiteRoot, 'python', 'Python311'),
)

console.log('[suite] Staging speech, voice, and hand-input runtimes…')
for(const name of whisperFiles)copyFile(join(whisperModelSource,name),join(suiteRoot,'data','whisper','base.en',name))
copyTree(join(appRoot, '.venv-stt'), join(suiteRoot, 'apps', 'NoriV2', '.venv-stt'), {
  excluded: new Set(['__pycache__']), acceptFile: () => true,
})
copyFile(join(appRoot, 'bridge', 'system_hand_input.py'), join(suiteRoot, 'apps', 'NoriV2', 'bridge', 'system_hand_input.py'))
copyFile(join(appRoot, 'bridge', 'kokoro_tts.py'), join(suiteRoot, 'apps', 'NoriV2', 'bridge', 'kokoro_tts.py'))
copyTree(join(sourceRoot, 'data', 'voice-runtime'), join(suiteRoot, 'data', 'voice-runtime'), {
  excluded: new Set(['__pycache__']), acceptFile: () => true,
})
copyTree(join(sourceRoot, 'data', 'voice-models'), join(suiteRoot, 'data', 'voice-models'), {
  excluded: new Set(['__pycache__']), acceptFile: () => true,
})

console.log('[suite] Staging ComfyUI and its SDXL Turbo checkpoint…')
copyTree(join(sourceRoot, 'tools', 'ComfyUI'), join(suiteRoot, 'tools', 'ComfyUI'), {
  excluded: new Set(['.git', '.ci', '__pycache__', '.pytest_cache', 'tests', 'tests-unit', 'input', 'output', 'temp', 'user']),
  acceptFile: () => true,
})

console.log('[suite] Staging Ollama runtime…')
const ollamaInstall = 'C:/Users/Studio/AppData/Local/Programs/Ollama'
copyTree(join(ollamaInstall, 'lib'), join(suiteRoot, 'ollama', 'lib'), {
  excluded: new Set(['__pycache__']), acceptFile: () => true,
})
copyFile(join(ollamaInstall, 'ollama.exe'), join(suiteRoot, 'ollama', 'ollama.exe'))

console.log('[suite] Collecting only Nori’s two Qwen models and the small embedding model…')
const modelSpecs = [
  ['qwen3.5', '4b'], ['qwen3.5', '9b'], ['embeddinggemma', 'latest'],
]
const copiedBlobs = new Set()
for (const [library, tag] of modelSpecs) {
  copyOllamaModel(library, tag, modelStore, copiedBlobs)
}

console.log('[suite] Preparing the optional deep-reasoning model component…')
const deepModelBlobs = new Set()
copyOllamaModel('gpt-oss', '20b', deepModelStore, deepModelBlobs)

for (const path of [
  join(suiteRoot, 'nori', 'main.py'),
  join(suiteRoot, 'nori', '.venv-architect', 'Scripts', 'python.exe'),
  join(suiteRoot, 'tools', 'ComfyUI', '.venv', 'Scripts', 'python.exe'),
  join(suiteRoot, 'apps', 'NoriV2', '.venv-stt', 'Scripts', 'python.exe'),
  join(suiteRoot, 'python', 'Python310', 'python.exe'),
  join(suiteRoot, 'python', 'Python311', 'python.exe'),
  join(suiteRoot, 'data', 'voice-runtime', 'Scripts', 'python.exe'),
  join(suiteRoot, 'data', 'voice-models', 'kokoro-v1', 'kokoro-v1.0.onnx'),
  join(suiteRoot, 'data', 'voice-models', 'kokoro-v1', 'voices-v1.0.bin'),
  join(suiteRoot, 'tools', 'ComfyUI', 'models', 'checkpoints', 'sd_xl_turbo_1.0_fp16.safetensors'),
  join(suiteRoot, 'ollama', 'ollama.exe'),
  join(modelStore, 'manifests', 'registry.ollama.ai', 'library', 'qwen3.5', '4b'),
  join(modelStore, 'manifests', 'registry.ollama.ai', 'library', 'qwen3.5', '9b'),
  join(modelStore, 'manifests', 'registry.ollama.ai', 'library', 'embeddinggemma', 'latest'),
  join(deepModelStore, 'manifests', 'registry.ollama.ai', 'library', 'gpt-oss', '20b'),
]) requireFile(path)

console.log(`[suite] Payload staged at ${outputRoot}`)
console.log(`[suite] Base models contain ${copiedBlobs.size} unique blobs; optional deep model contains ${deepModelBlobs.size}.`)
