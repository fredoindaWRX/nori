import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const ts = createRequire(import.meta.url)('typescript')
const root = new URL('../../../', import.meta.url)
const read = path => readFileSync(new URL(path, root), 'utf8')
function initializer(path, name) {
  const tree = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  let value
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === name) value = node.initializer.getText(tree)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert.equal(typeof value, 'string', `${name} declaration exists`)
  return value
}
const script = 'apps/desktop/scripts/prepare-computer-control-update.mjs'
const bridgeFiles = [...vm.runInNewContext(initializer(script, 'bridgeFiles'))]
const expected = vm.runInNewContext(initializer(script, 'expected'), { bridgeFiles })
const newHelpers = ['video-duration.mjs', 'local-video-assembly.mjs', 'local-video-assembly.py']

test('maintenance preparation and installer share the same 18 bounded native bridge files', () => {
  assert.equal(new Set(bridgeFiles).size, 18)
  const installer = read('verification/vector-canvas-update.iss')
  const shipped = [...installer.matchAll(/^Source: "\.\.\\apps\\desktop\\bridge\\([^"\\]+)";/gm)].map(match => match[1])
  assert.deepEqual(shipped.sort(), [...bridgeFiles].sort())
  for (const name of bridgeFiles) assert.equal(expected.has(`bridge/${name}`), true)
  assert.equal(expected.has('bridge/server.mjs'), true, 'server progress code is checked in ASAR')
  assert.equal(bridgeFiles.includes('server.mjs'), false, 'server is not a new native-suite entrypoint')
  assert.equal(bridgeFiles.some(name => !/^[a-z0-9-]+\.(?:mjs|py|ps1)$/.test(name)), false)
})

test('future full native suites retain all three assembly/duration helpers', () => {
  const paths = [...vm.runInNewContext(initializer('apps/desktop/scripts/native-payload-plan.mjs', 'nativeDesktopModuleFiles'))]
  for (const name of newHelpers) assert.equal(paths.includes(`apps/desktop/bridge/${name}`), true)
  for (const name of ['generated-video-file.mjs', 'neuralese-video-intent.mjs']) {
    assert.equal(paths.includes(`apps/desktop/bridge/${name}`), true)
    assert.equal(bridgeFiles.includes(name), true)
  }
})

test('Python helper is loaded through Electron fs and passed as code, not launched by an ASAR pathname', () => {
  const assembly = read('apps/desktop/bridge/local-video-assembly.mjs')
  assert.match(assembly, /readFile\(new URL\('\.\/local-video-assembly\.py', import\.meta\.url\), 'utf8'\)/)
  assert.match(assembly, /spawn\(python, \['-I', '-B', '-c', source\]/)
  assert.equal(expected.has('bridge/local-video-assembly.py'), true)
  assert.equal(bridgeFiles.includes('local-video-assembly.py'), true)
})
