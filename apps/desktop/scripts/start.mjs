/**
 * Normal Windows startup: open the selected, already-installed N.O.R.I.
 * desktop package. Development remains explicit via `npm run start:dev`.
 */
import { spawn } from 'node:child_process'
import process from 'node:process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const appRoot = resolve(scriptPath, '..', '..')
const launcherPath = resolve(appRoot, 'scripts', 'launch-current-desktop.vbs')

const REMOVED_ENV_KEYS = new Set([
  'electron_run_as_node',
  'nori_allow_writes',
  'nori_inference_runtime',
  'nori_remote_control_only',
  'nori_gpt_oss_enabled',
  'nori_gpt_oss_heretic',
  'nori_codex_local_provider',
])
const ALLOWED_ARGS = new Set(['--writes', '--inspect', '--remote-control-only', '--nori-gpt-oss', '--nori-gpt-oss-heretic', '--nori-norllama', '--nori-codex-provider'])

/** Build a fresh, fail-closed environment for the current desktop launcher. */
export function selectedLauncherOptions(environment = process.env, args = []) {
  if (!environment || typeof environment !== 'object' || Array.isArray(environment)) {
    throw new Error('Launcher environment must be an object')
  }
  if (!Array.isArray(args)) throw new Error('Launcher arguments must be an array')
  const seen = new Set()
  for (const arg of args) {
    if (!ALLOWED_ARGS.has(arg)) throw new Error(`Unsupported Nori startup option: ${String(arg)}`)
    if (seen.has(arg)) throw new Error(`Repeated Nori startup option: ${arg}`)
    seen.add(arg)
  }
  const writes = seen.has('--writes')
  const inspect = seen.has('--inspect')
  const remoteControlOnly = seen.has('--remote-control-only')
  const gptOss = seen.has('--nori-gpt-oss')
  const heretic = seen.has('--nori-gpt-oss-heretic')
  const norllama = seen.has('--nori-norllama')
  const codexProvider = seen.has('--nori-codex-provider')
  if ((gptOss && heretic) || ((gptOss || heretic) && norllama)) throw new Error('Select only one Nori local model profile')
  if (codexProvider && (!gptOss || heretic)) throw new Error('The Codex provider requires the base GPT-OSS profile')
  if (writes && (inspect || remoteControlOnly || gptOss || heretic)) {
    throw new Error('Write mode cannot be combined with inspect, remote-control-only, or GPT-OSS mode')
  }
  if (remoteControlOnly && (gptOss || heretic)) {
    throw new Error('GPT-OSS mode cannot be combined with remote-control-only mode')
  }

  const env = { ...environment }
  for (const key of Object.keys(env)) {
    if (REMOVED_ENV_KEYS.has(key.toLowerCase())) delete env[key]
  }
  env.NORI_ALLOW_WRITES = writes ? '1' : '0'
  env.NORI_INFERENCE_RUNTIME = (gptOss || heretic) ? 'gpt-oss' : norllama ? 'norllama' : 'gpt-oss'
  env.NORI_REMOTE_CONTROL_ONLY = remoteControlOnly ? '1' : '0'
  if (env.NORI_INFERENCE_RUNTIME === 'gpt-oss') env.NORI_GPT_OSS_ENABLED = '1'
  else env.NORI_GPT_OSS_ENABLED = '0'
  if (heretic) env.NORI_GPT_OSS_HERETIC = '1'
  else env.NORI_GPT_OSS_HERETIC = '0'
  env.NORI_CODEX_LOCAL_PROVIDER = codexProvider ? '1' : '0'
  return { env, shell: false }
}

function launch() {
  if (process.platform !== 'win32') {
    throw new Error('The installed N.O.R.I. desktop launcher is Windows-only. Use `npm run start:dev` for development.')
  }
  const options = selectedLauncherOptions(process.env, process.argv.slice(2))
  const args = ['/nologo', launcherPath]
  if (process.argv.includes('--inspect')) args.push('--inspect')
  if (process.argv.includes('--nori-gpt-oss')) args.push('--nori-gpt-oss')
  if (process.argv.includes('--nori-gpt-oss-heretic')) args.push('--nori-gpt-oss-heretic')
  if (process.argv.includes('--nori-norllama')) args.push('--nori-norllama')
  if (process.argv.includes('--nori-codex-provider')) args.push('--nori-codex-provider')
  const child = spawn('cscript.exe', args, {
    cwd: appRoot,
    env: options.env,
    shell: options.shell,
    windowsHide: true,
    stdio: 'inherit',
  })
  child.once('error', error => {
    console.error(`N.O.R.I. launcher could not start: ${error.message}`)
    process.exitCode = 1
  })
  child.once('exit', (code, signal) => {
    if (signal) process.exitCode = 1
    else if (Number.isInteger(code) && code !== 0) process.exitCode = code
  })
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try { launch() }
  catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
