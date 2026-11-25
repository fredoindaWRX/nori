const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const vm = require('node:vm')
const { MANIFEST, SERVICE_WORKER, mobileAsset } = require('../desktop/mobile-app.cjs')
const { createRemoteControlServer } = require('../desktop/remote-control-service.cjs')

function fixture(t, options = {}) {
  const commands = [], captures = []
  const window = { isDestroyed: () => false, isVisible: () => false, isMinimized: () => true, getContentSize: () => [400, 800], webContents: {
    capturePage: async () => { captures.push(true); throw Error('Capture must remain blocked') },
    debugger: { attach() {}, detach() {}, isAttached: () => true, async sendCommand(method, params) {
      commands.push({ method, params })
      await options.beforeCommand?.(method, params)
      if (params?.expression?.includes("querySelectorAll('.log-line')")) return { result: { value: [{ id: 'synthetic-1', role: 'nori', text: 'Synthetic fixture only', complete: true }] } }
      if (options.draftPending && params?.expression?.includes('document.activeElement===i')) return { result: { value: 'draft_pending' } }
      return { result: { value: true } }
    } },
  } }
  const service = createRemoteControlServer({ window, ownerLogin: 'owner@example.test', origin: 'https://fixture.example.ts.net:8444', port: 0 })
  t.after(() => service.stop())
  return { service, commands, captures }
}
async function request(service, path, { owner = true, origin = false, method = 'GET', body } = {}) {
  await service.ready
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: service.server.address().port, path, method, headers: {
      'Tailscale-User-Login': owner ? 'owner@example.test' : 'someone@example.test',
      ...(origin ? { Origin: 'https://fixture.example.ts.net:8444' } : {}),
      ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
    } }, res => { const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })) })
    req.on('error', reject); req.end(body)
  })
}

test('mobile app has a same-origin standalone manifest and correctly sized local icons', () => {
  assert.equal(MANIFEST.display, 'standalone'); assert.equal(MANIFEST.start_url, '/'); assert.equal(MANIFEST.scope, '/')
  for (const size of [180, 192, 512]) {
    const image = mobileAsset(`/app/nori-${size}.png`)
    assert.equal(image.type, 'image/png'); assert.equal(image.body.readUInt32BE(16), size); assert.equal(image.body.readUInt32BE(20), size)
  }
  assert.equal(mobileAsset('/app/../conversation'), null)
  assert.equal(mobileAsset('/manifest.webmanifest?redirect=/conversation'), null)
})

test('installation assets retain owner authentication, including Safari requests without Origin', async t => {
  const { service } = fixture(t)
  for (const path of ['/manifest.webmanifest', '/service-worker.js', '/install', '/app/nori-180.png', '/app/nori-192.png', '/app/nori-512.png']) {
    assert.equal((await request(service, path, { owner: false })).status, 403)
    const result = await request(service, path)
    assert.equal(result.status, 200, path); assert.equal(result.headers['cache-control'], 'no-store')
    assert.equal(result.headers['x-content-type-options'], 'nosniff')
    if (path === '/service-worker.js') assert.match(result.headers['content-security-policy'], /connect-src 'self'/)
  }
  assert.equal((await request(service, '/conversation')).status, 403)
  assert.equal((await request(service, '/manifest.webmanifest/../conversation')).status, 403)
})

test('mobile document enables Home Screen installation while voice stays opt-in', async t => {
  const { service } = fixture(t); const result = await request(service, '/')
  const page = result.body.toString()
  assert.match(page, /apple-mobile-web-app-capable/); assert.match(page, /rel="manifest"/)
  assert.match(page, /id="install-help"/); assert.match(page, /serviceWorker.register/)
  assert.match(result.headers['content-security-policy'], /worker-src 'self'/)
  assert.match(result.headers['content-security-policy'], /manifest-src 'self'/)
  const help = (await request(service, '/install')).body.toString()
  assert.match(help, /Add to Home Screen/); assert.match(help, /approvals stay on the desktop/)
})

test('owner chat works while Nori is hidden but screenshot and pointer access remain blocked', async t => {
  const { service, commands, captures } = fixture(t)
  assert.equal((await request(service, '/conversation', { origin: true })).status, 200)
  assert.equal((await request(service, '/input', { origin: true, method: 'POST', body: JSON.stringify({ kind: 'send', text: 'Synthetic phone test' }) })).status, 200)
  assert.ok(commands.some(event => event.method === 'Input.insertText' && event.params.text === 'Synthetic phone test'))
  assert.equal((await request(service, '/screen', { origin: true })).status, 409)
  assert.equal((await request(service, '/input', { origin: true, method: 'POST', body: JSON.stringify({ kind: 'pointer', phase: 'move', x: 0.5, y: 0.5 }) })).status, 409)
  assert.equal(captures.length, 0)
  assert.equal((await request(service, '/input', { method: 'POST', body: JSON.stringify({ kind: 'send', text: 'Blocked cross-site' }) })).status, 403)
})

function worker(fetch) {
  const listeners = new Map()
  vm.runInNewContext(SERVICE_WORKER, { self: { location: { origin: 'https://fixture.example.ts.net:8444' }, addEventListener: (kind, callback) => listeners.set(kind, callback) }, fetch, Response, URL })
  return async ({ path = '/', method = 'GET', mode = 'navigate', remote = false } = {}) => {
    let response
    listeners.get('fetch')({ request: { url: `${remote ? 'https://other.example' : 'https://fixture.example.ts.net:8444'}${path}`, method, mode }, respondWith: value => { response = value } })
    return response === undefined ? null : await response
  }
}

test('offline fallback saves no private data and intercepts only same-origin navigation', async () => {
  const fetch = worker(async () => { throw Error('Offline') })
  const result = await fetch()
  assert.equal(result.status, 503); assert.match(await result.text(), /Waiting for your PC/)
  assert.equal(result.headers.get('cache-control'), 'no-store')
  assert.equal(await fetch({ path: '/conversation', mode: 'cors' }), null)
  assert.equal(await fetch({ path: '/voice/transcribe', mode: 'cors', method: 'POST' }), null)
  assert.equal(await fetch({ remote: true }), null)
  assert.doesNotMatch(SERVICE_WORKER, /caches\.|localStorage|indexedDB/)
})

test('service worker never substitutes offline content for a live authentication rejection', async () => {
  const fetch = worker(async () => new Response('owner_identity_required', { status: 403 }))
  const result = await fetch(); assert.equal(result.status, 403); assert.equal(await result.text(), 'owner_identity_required')
})

test('upstream gateway outages show reconnect instructions without hiding other HTTP errors', async () => {
  for (const status of [502, 503, 504]) {
    const fetch = worker(async () => new Response('Synthetic upstream outage', { status }))
    const result = await fetch()
    assert.equal(result.status, 503)
    assert.equal(result.headers.get('retry-after'), '10')
    assert.match(await result.text(), /Waiting for your PC/)
    assert.equal(await fetch({ path: '/conversation', mode: 'cors' }), null)
  }
  for (const status of [401, 403, 404, 429, 500]) {
    const fetch = worker(async () => new Response('Preserve the actual status', { status }))
    const result = await fetch()
    assert.equal(result.status, status)
    assert.equal(await result.text(), 'Preserve the actual status')
  }
})

test('concurrent phone sends cannot interleave text in the desktop composer', async t => {
  let release, reached
  const entered = new Promise(resolve => { reached = resolve })
  const gate = new Promise(resolve => { release = resolve })
  t.after(() => release())
  const { service, commands } = fixture(t, { beforeCommand: async method => {
    if (method === 'Input.insertText') { reached(); await gate }
  } })
  const first = request(service, '/input', { origin: true, method: 'POST', body: JSON.stringify({ kind: 'send', text: 'First synthetic message' }) })
  await entered
  const second = await request(service, '/input', { origin: true, method: 'POST', body: JSON.stringify({ kind: 'send', text: 'Second synthetic message' }) })
  assert.equal(second.status, 409)
  assert.equal(JSON.parse(second.body).error, 'nori_chat_submission_pending')
  release()
  assert.equal((await first).status, 200)
  assert.deepEqual(commands.filter(event => event.method === 'Input.insertText').map(event => event.params.text), ['First synthetic message'])
})

test('an existing desktop draft is rejected before text insertion or submission', async t => {
  const { service, commands } = fixture(t, { draftPending: true })
  const result = await request(service, '/input', { origin: true, method: 'POST', body: JSON.stringify({ kind: 'send', text: 'Keep separate' }) })
  assert.equal(result.status, 409)
  assert.equal(JSON.parse(result.body).error, 'nori_desktop_draft_pending')
  assert.equal(commands.some(event => event.method === 'Input.insertText'), false)
  assert.equal(commands.some(event => event.params?.expression?.includes('f.requestSubmit()')), false)
})

test('a failed desktop input command releases the submission guard for the next request', async t => {
  let failOnce = true
  const { service, commands } = fixture(t, { beforeCommand: async method => {
    if (failOnce && method === 'Runtime.evaluate') { failOnce = false; throw Error('Synthetic renderer failure') }
  } })
  const options = { origin: true, method: 'POST', body: JSON.stringify({ kind: 'send', text: 'Synthetic recovery' }) }
  assert.equal((await request(service, '/input', options)).status, 503)
  assert.equal((await request(service, '/input', options)).status, 200)
  assert.equal(commands.filter(event => event.method === 'Input.insertText').length, 1)
})
