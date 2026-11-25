import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import {assertRequiredFiles,assertNativeSuiteStager} from './suite-preflight.mjs'

const root = resolve(import.meta.dirname, '..')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const electronBuilder = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder')
const compiler = process.env.NORI_INNO_COMPILER || join(root, 'release', 'build-tools', 'innosetup-7', 'ISCC.exe')
assertRequiredFiles([join(root,'electron-builder.suite.yml'),join(root,'suite-installer.iss')])
// Recovered packaging must not silently reintroduce the retired runtime.
assertNativeSuiteStager(readFileSync(join(root,'scripts','stage-suite.mjs'),'utf8'))

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit', shell: process.platform === 'win32' && command.endsWith('.cmd') })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (!existsSync(compiler)) {
  throw new Error(`Inno Setup 7 compiler not found at ${compiler}. Install the signed x64 compiler from https://jrsoftware.org/isdl.php and choose this folder.`)
}

console.log('[suite] Creating the curated suite payload…')
run(process.execPath, ['scripts/stage-suite.mjs'])

console.log('[suite] Building the desktop app against its private local bridge…')
run(npm, ['run', 'build'], { ...process.env, VITE_BRIDGE_URL: 'ws://localhost:18787' })

console.log('[suite] Packaging the Windows desktop application and bundled suite…')
run(electronBuilder, ['--config', 'electron-builder.suite.yml', '--win', 'dir', '--x64'])

mkdirSync(join(root, 'release'), { recursive: true })
console.log('[suite] Building the transferable installer set…')
run(compiler, ['/Qp', 'suite-installer.iss'])
console.log('[suite] Installer created under release as Nori-Suite-Setup-x64.exe plus any .bin slices.')
