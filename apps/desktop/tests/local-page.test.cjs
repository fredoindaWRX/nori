const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, createReadStream } = require('node:fs')
const { join, extname } = require('node:path')
const { createServer } = require('node:http')
const vm = require('node:vm')
const { tmpdir } = require('node:os')
const { localPage } = require('../desktop/local-page.cjs')
const { speechPagePolicy } = require('../desktop/speech-page-policy.cjs')

test('actual desktop HTTP handler survives malformed and escaping requests', async () => {
  const temporary = mkdtempSync(join(tmpdir(), 'nori-face-http-test-'))
  let server
  try {
    const root = join(temporary, 'dist'), sibling = join(temporary, 'dist-private')
    mkdirSync(root); mkdirSync(sibling)
    const html = readFileSync(join(__dirname, '../index.html'), 'utf8')
    const bridgeOrigin = 'http://127.0.0.1:55324'
    const expected = speechPagePolicy(html, bridgeOrigin)
    writeFileSync(join(root, 'index.html'), html)
    writeFileSync(join(root, 'asset.js'), 'safe asset')
    writeFileSync(join(sibling, 'secret.txt'), 'private secret')
    const source = readFileSync(join(__dirname, '../desktop/main.cjs'), 'utf8')
    const implementation = source.slice(source.indexOf('function localFile('), source.indexOf('async function bridgeIsUp('))
    assert.ok(implementation.includes('function startFace()'))
    const context = vm.createContext({ localPage, speechPagePolicy, readFileSync, URL,
      join, extname, existsSync, createReadStream, createServer,
      DIST: root, FACE_ORIGIN: 'http://127.0.0.1', FACE_PORT: 0, HOST: '127.0.0.1',
      BRIDGE_URL: bridgeOrigin,
      MIME: { '.html': 'text/html', '.js': 'text/javascript' }, face: null })
    vm.runInContext(implementation, context)
    await vm.runInContext('startFace()', context)
    server = context.face
    const origin = `http://127.0.0.1:${server.address().port}`
    for (const path of ['/%ZZ', '/%2e%2e%2fdist-private/secret.txt', '/absent']) {
      const response = await fetch(origin + path)
      assert.equal(response.status, 200)
      assert.equal(await response.text(), expected)
      assert.equal(response.headers.get('cache-control'), 'no-store')
    }
    const asset = await fetch(origin + '/asset.js')
    assert.equal(await asset.text(), 'safe asset')
    assert.equal(asset.headers.get('content-type'), 'text/javascript')
    // Fail closed when a generated page no longer has its CSP template.
    writeFileSync(join(root, 'index.html'), '<html>drifted policy</html>')
    const refused = await fetch(origin + '/')
    assert.equal(refused.status, 500)
    assert.equal(await refused.text(), 'Local desktop speech policy is unavailable.')
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('desktop page resolver contains files and handles malformed escaping', () => {
  const temporary = mkdtempSync(join(tmpdir(), 'nori-page-test-'))
  try {
    const root = join(temporary, 'dist'), sibling = join(temporary, 'dist-private')
    mkdirSync(root); mkdirSync(sibling)
    writeFileSync(join(root, 'index.html'), 'index')
    writeFileSync(join(root, 'asset.js'), 'asset')
    writeFileSync(join(sibling, 'secret.txt'), 'not public')
    const origin = 'http://127.0.0.1:5188'
    const index = join(root, 'index.html')
    assert.equal(localPage('/asset.js', root, origin), join(root, 'asset.js'))
    assert.equal(localPage('/%2e%2e%2fdist-private/secret.txt', root, origin), index)
    assert.equal(localPage('/%ZZ', root, origin), index)
    assert.equal(localPage('/absent', root, origin), index)
    assert.equal(localPage('/', root, origin), index)
  } finally { rmSync(temporary, { recursive: true, force: true }) }
})
