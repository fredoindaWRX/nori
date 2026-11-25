/**
 * Explicit development mode: the bridge (brain) and the Vite dev server (face)
 * together, so a student types `npm start` and nothing else.
 *
 * Two long-running processes normally mean two terminals. This launcher spawns
 * both as children, tags their output so you can tell them apart, and shuts
 * them down together on Ctrl-C — no extra dependency, just Node.
 *
 * Pass --writes to allow N.O.R.I. to take real actions (drive the phone, the
 * browser, send things): `npm start -- --writes`.
 */

import { spawn } from 'node:child_process'
import process from 'node:process'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { vendorMediaPipe } from './mediapipe-assets.mjs'
const { nativeRuntimeMode } = createRequire(import.meta.url)('../desktop/native-service.cjs')
const { startNativeStack } = createRequire(import.meta.url)('../desktop/native-stack.cjs')
const appRoot = resolve(import.meta.dirname, '..')
const noriRoot = resolve(appRoot, '..', '..')

/**
 * Put MediaPipe's WebAssembly where the page can actually load it.
 *
 * Hand tracking needs a WASM runtime, and the usual recipe fetches it from a
 * CDN. That fails here twice over. The page's CSP names no CDN in `script-src`,
 * and the runtime arrives as a script — so it is blocked, and the failure
 * surfaces as gesture control simply never starting. And a CDN import is a live
 * supply-chain dependency: executable code, re-resolved on every load, that we
 * do not control and cannot pin against being changed under us.
 *
 * Copying it out of node_modules solves both. It is served from our own origin,
 * so `'self'` covers it; and it is the exact bytes of the version in the
 * lockfile. It stays out of git — 34 MB of build output does not belong in a
 * repository — and is re-copied whenever it is missing, which costs nothing
 * after the first run.
 */
function vendorWasm() {
  const from = resolve(appRoot, 'node_modules/@mediapipe/tasks-vision/wasm')
  const to = resolve(appRoot, 'public/mediapipe')
  if (!existsSync(from)) return // gesture control is optional; carry on without it
  if (existsSync(`${to}/vision_wasm_internal.wasm`)) return
  try {
    mkdirSync(to, { recursive: true })
    cpSync(from, to, { recursive: true })
    console.log('  vendored the hand-tracking runtime into public/mediapipe.')
  } catch (err) {
    console.warn(`  could not vendor the hand-tracking runtime: ${err.message}`)
  }
}

const writes = process.argv.includes('--writes')

// A dim label per process, so the interleaved logs stay readable.
const paint = (tag, colour) => (line) =>
  line
    .toString()
    .split('\n')
    .filter((l) => l.length)
    .map((l) => `\x1b[${colour}m${tag}\x1b[0m ${l}`)
    .join('\n')

const children = []
const startupAbort = new AbortController()
let nativeService, nativeStarting

function run(name, command, args, colour, env) {
  const label = paint(name, colour)
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    shell: false,
    cwd: appRoot, windowsHide: true,
  })
  child.stdout.on('data', (d) => process.stdout.write(label(d) + '\n'))
  child.stderr.on('data', (d) => process.stderr.write(label(d) + '\n'))
  child.on('exit', (code) => {
    // If either half dies the other is useless, so take the whole thing down
    // rather than leave a half-running app that looks alive but cannot answer.
    if (!stopping) {
      console.log(`\x1b[${colour}m${name}\x1b[0m exited (${code}); stopping the rest.`)
      void shutdown(code ?? 1)
    }
  })
  child.once('error', () => { console.error(`${name} could not start`); void shutdown(1) })
  children.push(child)
  return child
}

let stopping = false
async function shutdown(code) {
  if (stopping) return
  stopping = true
  startupAbort.abort()
  for (const c of children) {
    try {
      c.kill('SIGTERM')
    } catch {
      /* already gone */
    }
  }
  try {
    if (nativeStarting) await nativeStarting.catch(() => {})
    if (nativeService) await nativeService.stop()
  } catch { console.error('Own Nori runtime cleanup failed'); code = 1 }
  process.exit(code)
}

process.on('SIGINT', () => { void shutdown(0) })
process.on('SIGTERM', () => { void shutdown(0) })

/**
 * Tell the bridge which port the face will actually be on.
 *
 * The bridge only trusts WebSocket origins on localhost:5173-5199 and
 * 4173-4199, which is the right default — a socket that any local page can open
 * is a socket that drives every MCP server on the machine. But a launcher that
 * assigns a port outside that range produces the single most confusing failure
 * this project has: the interface loads, the reactor spins, the microphone
 * hears you, and the brain answers nothing, because the handshake is being 403'd
 * somewhere neither half reports. Passing the port through closes that gap
 * without widening what the bridge trusts by default.
 */
const port = process.env.PORT
const bridgeEnv = writes ? { NORI_ALLOW_WRITES: '1' } : {}
if (port) {
  bridgeEnv.NORI_ALLOWED_ORIGINS = `http://localhost:${port},http://127.0.0.1:${port}`
  console.log(`  serving the face on port ${port}; the bridge will accept it.\n`)
}

vendorWasm()
try {
  const assets = vendorMediaPipe(appRoot)
  console.log(`  local hand model ready (${assets.modelBytes} bytes).`)
} catch (error) {
  console.warn(`  hand tracking will be unavailable: ${error.message}`)
}

console.log('\nN.O.R.I. starting — the brain and the face.\n')
try {
  if (nativeRuntimeMode() === 'norllama') {
    nativeStarting = startNativeStack({ root: noriRoot, signal: startupAbort.signal })
    nativeService = await nativeStarting
    Object.assign(bridgeEnv, nativeService.environment)
    nativeService.exited.then(() => {
      if (!stopping) { console.error('Own Nori Core/runtime stopped;no fallback used'); void shutdown(1) }
    })
    console.log(`  Nori Core + NorLlama / Norama.cpp ready — imported ${nativeService.status.modelId}.\n`)
  }
} catch (error) {
  if (!stopping) { console.error(error.message); await shutdown(1) }
}
if (stopping) process.exit(0)
run('bridge', process.execPath, [resolve(appRoot, 'bridge/server.mjs')], '36', bridgeEnv)
// npm is a shell script on most systems; call the vite binary directly so we do
// not need shell:true (which would break the argument handling above).
run('face', process.execPath, [resolve(appRoot, 'node_modules/vite/bin/vite.js')], '35', {})

console.log(
  '\nWhen it says the dev server is ready, open the URL it prints in Chrome,\n' +
    'click INITIALISE, and say "Hey Nori". Ctrl-C stops everything.\n',
)
