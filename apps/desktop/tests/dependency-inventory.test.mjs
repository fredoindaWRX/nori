import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import {
  scanImports,
  specifiersIn,
  packageNameOf,
  isBareSpecifier,
} from '../../../tools/nori_deps/inventory.mjs'
import {
  verifyRegistry,
  loadRegistry,
  declaredDesktopDependencies,
  NORI_ROOT,
} from '../../../tools/nori_deps/verify_registry.mjs'

const require = createRequire(import.meta.url)
const desktopRoot = resolve(NORI_ROOT, 'apps', 'desktop')

// ---------------------------------------------------------------------------
// The scanner itself
// ---------------------------------------------------------------------------

test('the scanner recognises every import syntax the desktop actually uses', () => {
  const source = [
    "import { createMcpToolServer, tool } from './nori-mcp.mjs'",
    "import { z } from 'zod'",
    "import ws from 'ws'",
    "import 'side-effect-only-package'",
    "export { thing } from '@scope/pkg/sub'",
    "const mod = require('cjs-package')",
    "const lazy = await import('dynamic-package/deep/path')",
    "import { fileURLToPath } from 'node:url'",
  ].join('\n')
  // specifiersIn returns raw specifiers; packageNameOf reduces them to the
  // package that provides them. Both steps are covered deliberately.
  assert.deepEqual(specifiersIn(source), [
    '@scope/pkg/sub',
    'cjs-package',
    'dynamic-package/deep/path',
    'side-effect-only-package',
    'ws',
    'zod',
  ])
  assert.deepEqual(
    [...new Set(specifiersIn(source).map(packageNameOf))].sort(),
    ['@scope/pkg', 'cjs-package', 'dynamic-package', 'side-effect-only-package', 'ws', 'zod'],
  )
})

test('relative, builtin and URL specifiers are never treated as packages', () => {
  for (const bad of ['./local', '../parent', '/absolute', 'node:fs', 'https://x.test/y', 'C:/win/path']) {
    assert.equal(isBareSpecifier(bad), false, bad)
  }
  assert.equal(isBareSpecifier('zod'), true)
  assert.equal(packageNameOf('@anthropic-ai/claude-agent-sdk/deep'), '@anthropic-ai/claude-agent-sdk')
  assert.equal(packageNameOf('ws/lib/websocket'), 'ws')
})

test('the scanner walks the real desktop tree', () => {
  const result = scanImports({ base: desktopRoot, directories: ['src', 'bridge'] })
  // src plus bridge is the whole shipped application surface.
  assert.ok(result.files.length > 50, 'should see the renderer and bridge sources')
  // zod really is imported by the Nori MCP builder and the four adapters.
  assert.ok(result.imports.zod.includes('bridge/nori-mcp.mjs'))
  // Node builtins and relative paths were never counted as packages.
  assert.equal(result.imports['node:url'], undefined)
})

// ---------------------------------------------------------------------------
// The registry gate
// ---------------------------------------------------------------------------

test('every declared dependency is classified and its import sites are accurate', () => {
  const result = verifyRegistry()
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.warnings, [])
  assert.equal(result.ok, true, result.errors.join('; '))
  assert.ok(result.stats.classifiedDesktop > 0)
})

test('nothing imports a removed alternative-provider dependency', () => {
  const registry = loadRegistry()
  const { imports } = scanImports({
    base: desktopRoot,
    directories: registry.desktop.sourceRoots,
  })
  for (const entry of registry.desktop.removed) {
    assert.equal(imports[entry.name], undefined, `${entry.name} is imported again`)
  }
})
test('the manifest and the lockfile agree with each other', () => {
  // A dependency present in one and absent from the other is how a stale tree
  // silently returns months later, so this is checked on every run.
  const manifest = JSON.parse(readFileSync(resolve(desktopRoot, 'package.json'), 'utf8'))
  const lock = JSON.parse(readFileSync(resolve(desktopRoot, 'package-lock.json'), 'utf8'))
  const fromManifest = Object.keys(manifest.dependencies ?? {}).sort()
  const fromLock = Object.keys(lock.packages[''].dependencies ?? {}).sort()
  assert.deepEqual(fromLock, fromManifest)
  // And each one resolves to a real, versioned lock entry.
  for (const name of fromManifest) {
    const entry = lock.packages[`node_modules/${name}`]
    assert.ok(entry, `${name} has no lock entry`)
    assert.ok(entry.version, `${name} has no resolved version`)
  }
})

test('legitimate standard dependencies are retained, not swept away', () => {
  const declared = declaredDesktopDependencies()
  // These are real imports and must survive the removal work. Zustand in
  // particular was restored deliberately after an earlier slip.
  for (const keep of ['zustand', 'react', 'react-dom', 'three', 'ws', 'zod']) {
    assert.ok(declared.includes(keep), `${keep} should still be declared`)
  }
})

test('the removed packages are absent from the lock, not merely undeclared', () => {
  const lock = JSON.parse(readFileSync(resolve(desktopRoot, 'package-lock.json'), 'utf8'))
  const gone = ['@anthropic-ai/claude-agent-sdk', '@anthropic-ai/sdk', 'kokoro-js',
    '@picovoice/porcupine-web', '@picovoice/web-voice-processor']
  for (const name of gone) {
    assert.equal(lock.packages[`node_modules/${name}`], undefined, `${name} still in the lockfile`)
    assert.equal(lock.packages['']?.dependencies?.[name], undefined, `${name} still in the lock root`)
  }
})

// ---------------------------------------------------------------------------
// The Nori MCP replacement
// ---------------------------------------------------------------------------

test('the four preserved adapters build on the Nori MCP module, not a vendor SDK', async () => {
  const builders = {
    panels: (await import('../bridge/panels.mjs')).displayServer(() => {}, () => {}, () => {}),
    ui: (await import('../bridge/ui.mjs')).uiServer(() => {}),
    vision: (await import('../bridge/vision.mjs')).visionServer(async () => ({})),
    chrome: (await import('../bridge/chrome.mjs')).chromeServer({ allowWrites: false }),
  }
  let total = 0
  for (const [name, server] of Object.entries(builders)) {
    assert.equal(server.schema, 'nori.mcp-tool-server.v1', name)
    assert.ok(server.tools.length > 0, `${name} declares no tools`)
    for (const entry of server.tools) {
      assert.equal(entry.inputSchema.type, 'object', `${name}/${entry.name} schema`)
      assert.ok(entry.description.length > 0, `${name}/${entry.name} description`)
      assert.equal(typeof entry.call, 'function', `${name}/${entry.name} handler`)
    }
    total += server.tools.length
  }
  // A regression that silently dropped tools would still "pass" a >0 check.
  assert.equal(total, 23)
})

test('Nori MCP validates arguments and refuses malformed definitions', async () => {
  const { tool, createMcpToolServer, NoriMcpDefinitionError } = await import('../bridge/nori-mcp.mjs')
  const { z } = require('zod')
  const good = tool('probe', 'A probe.', { count: z.number().optional() }, async (args) => args.count ?? 0)
  const server = createMcpToolServer({ name: 'n', version: '1', tools: [good] })
  assert.equal(await server.callTool('probe', { count: 5 }), 5)
  // Unknown tool names are refused rather than guessed at.
  await assert.rejects(() => server.callTool('absent', {}), NoriMcpDefinitionError)
  // Bad arguments never reach the handler.
  await assert.rejects(() => good.call({ count: 'lots' }))
  // Malformed definitions are refused at construction.
  assert.throws(() => tool('Bad Name', 'x', {}, async () => {}), NoriMcpDefinitionError)
  assert.throws(() => tool('probe', '', {}, async () => {}), NoriMcpDefinitionError)
  assert.throws(() => tool('probe', 'x', {}, 'not a function'), NoriMcpDefinitionError)
  assert.throws(() => createMcpToolServer({ name: 'n', version: '1', tools: [] }), NoriMcpDefinitionError)
  assert.throws(() => createMcpToolServer({ name: 'n', version: '1', tools: [good, good] }), NoriMcpDefinitionError)
})
