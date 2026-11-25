const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const url = require('node:url')
// Normal node --test must execute all VM cases in a bounded child, never skip.
if (!vm.SourceTextModule) {
  test('all twenty-six actual-provider cases execute in a VM-enabled child', t => {
    const environment = { ...process.env }; delete environment.NODE_TEST_CONTEXT
    const result = require('node:child_process').spawnSync(process.execPath,
      ['--experimental-vm-modules', '--test', '--test-reporter=tap', __filename],
      { env: environment, encoding: 'utf8', timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 })
    assert.ifError(result.error); assert.equal(result.status, 0, result.stdout + result.stderr)
    for (const summary of ['tests 26', 'pass 26', 'fail 0', 'skipped 0', 'cancelled 0'])
      assert.match(result.stdout, new RegExp('^# ' + summary + '\\s*$', 'm'), 'All child cases must execute: ' + result.stdout)
    assert.equal((result.stdout.match(/^ok \d+ - /gm) || []).length, 26)
    t.diagnostic('Verified actual child TAP:\n' + result.stdout)
  })
} else {
const modulePath = path.join(__dirname, '../bridge/active-own-code-reader.mjs')
const source = fs.readFileSync(modulePath, 'utf8')
const root = 'C:\\Tiny\\app.asar\\bridge'
const container = 'C:\\Tiny\\app.asar'
const hostUrl = url.pathToFileURL(path.join(root, 'local-chat.mjs')).href
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
async function fixture(options = {}) {
  const state = { reads: 0, streams: 0, io: 0, virtualStats: 0, physicalPaths: [] }
  const data = Buffer.from(Array.from({ length: 220 }, (_, i) => `line ${i + 1}`).join('\n'))
  const physical = Buffer.from('tiny synthetic physical archive')
  const stat = (directory, bytes, overrides = {}) => ({ dev: 1, ino: directory ? 2 : 3,
    size: bytes, nlink: 1, mtimeMs: 10, ctimeMs: 10,
    isFile: () => !directory, isDirectory: () => directory, isSymbolicLink: () => false, ...overrides })
  const virtualFs = {
    lstatSync(file) { state.io++; state.virtualStats++; return stat(file === root, file === root ? 0 : (options.entryBytes ?? (options.invalidUtf8 ? 1 : data.length)), { ...(options.link ? { isSymbolicLink: () => true } : {}), ...(options.varyingVirtualInode ? { ino: state.virtualStats } : {}) }) },
    realpathSync(file) { return options.redirect ? file + '.redirect' : file },
    readFileSync() { state.reads++; options.onRead?.(); return options.invalidUtf8 ? Buffer.from([255]) : options.changedSecondRead && state.reads === 2 ? Buffer.from('X' + data.toString().slice(1)) : data },
  }
  const originalFs = {
    lstatSync(file) {
      state.io++
      state.physicalPaths.push(file)
      if (file !== container) {
        if (options.sidecarError) throw Object.assign(new Error('Synthetic lookup failure'), { code: options.sidecarError })
        const active = options.sidecar || options.sidecarLink || options.sidecarRedirect || options.lateSidecar && state.streams >= 2
        if (!active) throw Object.assign(new Error('Synthetic absent sidecar'), { code: 'ENOENT' })
        if (file === container + '.unpacked' || file === path.join(container + '.unpacked', 'bridge')) {
          return stat(true, 0, options.sidecarLink ? { isSymbolicLink: () => true } : {})
        }
        return stat(options.sidecarKind === 'directory', 50, options.sidecarKind === 'link' ? { isSymbolicLink: () => true } : {})
      }
      return stat(false, physical.length, options.changedIdentity && state.reads ? { mtimeMs: 11 } : {})
    },
    realpathSync(file) { return options.sidecarRedirect && file !== container ? file + '.redirect' : file },
    async *createReadStream(file, streamOptions) {
      assert.equal(file, container); assert.equal(streamOptions.highWaterMark, 65536)
      state.streams++; options.onStream?.(state.streams)
      yield options.changedHash && state.streams > 1 ? Buffer.from('Tiny synthetic physical archive') : physical
    },
  }
  const values = { 'node:fs': { default: virtualFs }, 'node:path': { default: path },
    'node:crypto': { createHash: crypto.createHash }, 'node:url': { fileURLToPath: url.fileURLToPath },
    'node:module': { createRequire: () => name => { assert.equal(name, 'original-fs'); return originalFs } } }
  const context = vm.createContext({ Buffer, TextDecoder, URL })
  const module = new vm.SourceTextModule(source, { context, identifier: url.pathToFileURL(modulePath).href,
    initializeImportMeta(meta) { meta.url = url.pathToFileURL(modulePath).href } })
  await module.link(specifier => {
    assert.ok(Object.hasOwn(values, specifier), `Unreviewed import ${specifier}`)
    const bindings = values[specifier]
    return new vm.SyntheticModule(Object.keys(bindings), function () {
      for (const [key, value] of Object.entries(bindings)) this.setExport(key, value)
    }, { context })
  })
  await module.evaluate()
  return { state, data, physical, create: module.namespace.createActiveOwnCodeReader,
    reader: module.namespace.createActiveOwnCodeReader(hostUrl) }
}
const specs = [{ entry: 'project-tools.mjs', startLine: 198, maxLines: 20 }, { entry: 'local-chat.mjs', startLine: 1, maxLines: 3 }]
test('bounded acquisition returns actual bytes, line ranges and observed root/container hashes', async () => {
  const f = await fixture(); const result = await f.reader.readBatch(specs)
  assert.equal(result.root, root); assert.equal(result.container_sha256, sha(f.physical))
  assert.equal(result.release_attested, false); assert.equal(result.container_unchanged, true)
  assert.equal(result.results[0].content.split('\n')[0], 'line 198')
  assert.equal(result.results[0].returned_lines, 20); assert.equal(result.results[0].entry_sha256, sha(f.data))
  assert.equal(result.results[0].excerpt_sha256, sha(Buffer.from(result.results[0].content)))
  assert.equal(f.state.reads, 4); assert.equal(f.state.streams, 2)
})
for (const request of [[], [{ entry: '../secret', startLine: 1, maxLines: 3 }],
  [{ entry: 'local-chat.mjs', startLine: 1, maxLines: 91 }],
  [{ entry: 'local-chat.mjs', startLine: 1, maxLines: 3, root: 'C:\\Elsewhere' }], [specs[1], specs[1]]]) {
  test(`invalid model-controlled entry/list rejected before any I/O: ${JSON.stringify(request)}`, async () => {
    const f = await fixture(); await assert.rejects(f.reader.readBatch(request)); assert.equal(f.state.io, 0)
  })
}
for (const options of [{ link: true }, { redirect: true }, { entryBytes: 300000 }, { changedIdentity: true }, { changedHash: true }, { invalidUtf8: true }, { changedSecondRead: true }]) {
  test(`identity/content failure publishes no receipt: ${JSON.stringify(options)}`, async () => {
    const f = await fixture(options); await assert.rejects(f.reader.readBatch(specs))
  })
}
test('pre-aborted request performs no I/O', async () => {
  const f = await fixture(); const controller = new AbortController(); controller.abort()
  await assert.rejects(f.reader.readBatch(specs, { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(f.state.io, 0)
})
test('abort during physical hashing publishes no entry', async () => {
  const controller = new AbortController(); const f = await fixture({ onStream: () => controller.abort() })
  await assert.rejects(f.reader.readBatch(specs, { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(f.state.reads, 0)
})
test('abort after entry read publishes no late receipt', async () => {
  const controller = new AbortController(); const f = await fixture({ onRead: () => controller.abort() })
  await assert.rejects(f.reader.readBatch(specs, { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(f.state.reads, 1)
})
test('directory Source mode and untrusted host URLs are not silently accepted', async () => {
  const f = await fixture()
  for (const bad of ['file:///C:/Nori/apps/desktop/bridge/local-chat.mjs', 'https://example.test/bridge/local-chat.mjs', hostUrl + '?root=x', 'file://remote-host/share/app.asar/bridge/local-chat.mjs']) {
    assert.throws(() => f.create(bad))
  }
  assert.equal(f.state.io, 0)
})
test('observed Electron per-stat virtual inode changes do not pretend to be physical replacement', async () => {
  const f = await fixture({ varyingVirtualInode: true })
  const receipt = await f.reader.readBatch(specs)
  assert.equal(receipt.results.length, 2)
  assert.equal(receipt.container_unchanged, true)
  assert.ok(f.state.virtualStats > 4)
  assert.equal(f.state.reads, 4)
})
for (const options of [{ sidecar: true }, { sidecar: true, sidecarKind: 'directory' },
  { sidecar: true, sidecarKind: 'link' }, { sidecarLink: true }, { sidecarRedirect: true },
  { sidecarError: 'EACCES' }, { sidecarError: 'ENOTDIR' }, { lateSidecar: true }]) {
  test(`unpacked sidecar cannot escape physical container receipt: ${JSON.stringify(options)}`, async () => {
    const f = await fixture(options)
    await assert.rejects(f.reader.readBatch(specs))
    if (!options.lateSidecar) assert.equal(f.state.reads, 0)
    if (options.sidecarLink) assert.deepEqual(f.state.physicalPaths, [container + '.unpacked'])
  })
}

}
