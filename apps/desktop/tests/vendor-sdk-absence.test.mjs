import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { verifyNativeSdkIsolation } from '../scripts/native-sdk-package-policy.mjs'

const require = createRequire(import.meta.url)
const desktopRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

const read = (relative) => readFileSync(join(desktopRoot, relative), 'utf8')

/**
 * Packages that must never come back into the native path.
 *
 * Each was removed only after its actual use was traced, and each is paired
 * with the Nori-owned thing that does the job now. Keeping the pairing here is
 * deliberate: a bare list of forbidden names invites someone to re-add them
 * without noticing what they replaced.
 */
const REMOVED = {
  '@anthropic-ai/claude-agent-sdk': 'bridge/nori-mcp.mjs',
  '@anthropic-ai/sdk': '(nothing imported it)',
  '@picovoice/porcupine-web': 'src/lib/wake.ts',
  '@picovoice/web-voice-processor': 'src/lib/vad.ts',
  'kokoro-js': 'bridge/kokoro_tts.py',
}

/** Every source file the desktop build can compile. */
function desktopSourceFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx|mjs|cjs|js|jsx)$/.test(entry.name)) out.push(full)
    }
  }
  for (const sub of ['src', 'bridge', 'desktop', 'scripts', 'tests']) {
    const dir = join(desktopRoot, sub)
    if (existsSync(dir)) walk(dir)
  }
  return out
}

test('no desktop source file imports a removed vendor package', () => {
  const offenders = []
  for (const file of desktopSourceFiles()) {
    const source = readFileSync(file, 'utf8')
    for (const [name, replacement] of Object.entries(REMOVED)) {
      // An import statement is what matters; a guard test that merely *names*
      // the package in order to forbid it is legitimate and must not trip this.
      const importPattern = new RegExp(
        `(?:from|require\\(|import\\()\\s*['"]${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:['"/])`,
      )
      if (importPattern.test(source)) {
        offenders.push(`${file.replace(desktopRoot, '.')} imports ${name} (replaced by ${replacement})`)
      }
    }
  }
  assert.deepEqual(offenders, [])
})

test('the manifest declares none of the removed packages', () => {
  const manifest = JSON.parse(read('package.json'))
  const declared = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) }
  for (const name of Object.keys(REMOVED)) {
    assert.equal(declared[name], undefined, `${name} is declared again`)
  }
})

test('the Nori MCP replacement exists and is what the adapters import', () => {
  assert.ok(existsSync(join(desktopRoot, 'bridge', 'nori-mcp.mjs')), 'nori-mcp.mjs must exist')
  for (const adapter of ['chrome.mjs', 'panels.mjs', 'ui.mjs', 'vision.mjs']) {
    const source = read(join('bridge', adapter))
    assert.match(source, /from '\.\/nori-mcp\.mjs'/, `${adapter} should use the Nori MCP module`)
    assert.doesNotMatch(source, /@anthropic-ai/, `${adapter} still references the vendor SDK`)
    assert.doesNotMatch(source, /createSdkMcpServer/, `${adapter} still calls the vendor factory`)
  }
})

test('the native build excludes the vendor SDK and the adapters that used it', () => {
  // Both builder variants must exclude them. Only fixing the native one would
  // leave the suite variant shipping a package the source no longer uses.
  for (const config of ['electron-builder.native.yml', 'electron-builder.suite.yml']) {
    const files = read(config)
    assert.ok(
      files.includes('!node_modules/@anthropic-ai/**/*'),
      `${config} should exclude the vendor SDK`,
    )
    assert.ok(
      files.includes('!bridge/{chrome,panels,ui,vision}.mjs'),
      `${config} should exclude the unused adapters`,
    )
  }
})

test('the packaged-artifact gate still refuses the vendor SDK if it reappears', () => {
  // The pre-existing gate is the last line of defence and must keep working.
  // It reads a real packaged layout, so a temporary fixture stands in for it.
  const root = mkdtempSync(join(tmpdir(), 'nori vendor sdk '))
  mkdirSync(join(root, 'resources'))
  writeFileSync(join(root, 'resources', 'app.asar'), 'fixture')
  try {
    const listed = { listPackage: () => ['/node_modules/@anthropic-ai/sdk/package.json'] }
    assert.throws(() => verifyNativeSdkIsolation(root, { reader: listed }), /reappeared/)
    // A clean archive still passes.
    const clean = verifyNativeSdkIsolation(root, { reader: { listPackage: () => ['/bridge/server.mjs'] } })
    assert.equal(clean.nativeSdkIsolated, true)
    assert.equal(clean.releaseVerified, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('Nori remains local: no cloud provider is reachable from the speech path', () => {
  // Removing local packages must not have quietly re-enabled a cloud fallback.
  for (const file of ['bridge/server.mjs', 'bridge/whisper.mjs', 'bridge/nori-wake.mjs', 'src/lib/tts.ts']) {
    const source = read(file)
    assert.doesNotMatch(source, /api\.anthropic\.com|api\.elevenlabs\.io|api\.fish\.audio/, file)
  }
  const config = read('src/config.ts')
  assert.match(config, /export const USE_ELEVENLABS = false/)
  // The wake engine is local Whisper, and the dead Picovoice key is gone.
  assert.match(config, /WAKE_ENGINE = 'local-whisper'/)
  assert.doesNotMatch(config, /porcupineKey/, 'the dead Picovoice AccessKey field should be gone')
})

test('the STT worker stays pinned to locally cached model files', () => {
  // local_files_only is what guarantees no model is ever fetched at runtime.
  assert.match(read('bridge/whisper_stt.py'), /local_files_only=True/)
})