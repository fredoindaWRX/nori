import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const venv = join(root, '.venv-stt')
const python = process.platform === 'win32'
  ? join(venv, 'Scripts', 'python.exe')
  : join(venv, 'bin', 'python')

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (!existsSync(python)) {
  const launcher = process.platform === 'win32' ? 'python' : 'python3'
  console.log('[nori] Creating Nori\'s private speech environment…')
  run(launcher, ['-m', 'venv', venv])
}

console.log('[nori] Installing local speech and hand-input support…')
run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', 'faster-whisper', 'pyautogui'])
console.log('[nori] Local speech and hand-input support are installed. Restart N.O.R.I. to activate them.')
