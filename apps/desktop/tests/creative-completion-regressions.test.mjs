import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'

const base = process.env.NORI_CREATIVE_TEST_BRIDGE
  ? pathToFileURL(path.resolve(process.env.NORI_CREATIVE_TEST_BRIDGE) + path.sep).href
  : new URL('../bridge/', import.meta.url).href
const { generateComfyImage } = await import(base + 'local-image.mjs')
const { encodeNeuraleseImageIntent } = await import(base + 'neuralese-image-intent.mjs')
const { createNoriArtCraftMcpTools } = await import(base + 'artcraft-mcp-tools.mjs')
const { resolveImageRequest, isImageRequest, isNoriSelfPortraitRequest } = await import(base + 'image-intent.mjs')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kZ1kAAAAASUVORK5CYII=', 'base64')

async function imageFixture(history, action, bounds = {}) {
  const previous = globalThis.fetch, calls = []
  globalThis.fetch = async target => {
    const url = new URL(target); calls.push(url.pathname + url.search)
    if (url.pathname === '/prompt') return Response.json({ prompt_id: 'fixture-prompt' })
    if (url.pathname.startsWith('/history/')) return Response.json({ 'fixture-prompt': history })
    if (url.pathname === '/view') return new Response(png)
    throw new Error('Unexpected fake endpoint')
  }
  try {
    await action(() => generateComfyImage(encodeNeuraleseImageIntent('A synthetic blue circle.'),
      { imagePollIntervalMs: 1, imagePollAttempts: 2, timeoutMs: 1000, ...bounds }), calls)
  } finally { globalThis.fetch = previous }
}

test('Comfy image requires completed success and the designated saved output before fetching bytes', async () => {
  const image = { filename: 'fixture-final.png', subfolder: '', type: 'output' }
  await imageFixture({ status: { completed: true, status_str: 'success' }, outputs: { '13': { images: [image] } } }, async (run, calls) => {
    const result = await run()
    assert.equal(result.mimeType, 'image/png')
    assert.equal(Buffer.from(result.data, 'base64').length, png.length)
    assert.equal(calls.filter(url => url.startsWith('/view')).length, 1)
  })
})

test('incomplete history never delivers a preview, even if a node already has images', async () => {
  for (const node of ['13', '999']) await imageFixture({ status: { completed: false, status_str: 'running' }, outputs: { [node]: { images: [{ filename: 'preview.png', type: 'temp' }] } } }, async (run, calls) => {
    await assert.rejects(run, /timed out/)
    assert.equal(calls.filter(url => url.startsWith('/history')).length, 2)
    assert.equal(calls.some(url => url.startsWith('/view')), false)
  })
})

test('completed jobs without designated saved images fail without downloading another node or temporary files', async () => {
  const invalid = [
    { '999': { images: [{ filename: 'other.png', type: 'output' }] } },
    { '13': { images: [{ filename: 'preview.png', type: 'temp' }] } },
    { '13': { images: [] } },
    { '13': { images: [{ filename: '../escape.png', type: 'output' }] } },
    { '13': { images: [{ filename: 'image.png', subfolder: '../escape', type: 'output' }] } },
  ]
  for (const outputs of invalid) await imageFixture({ status: { completed: true, status_str: 'success' }, outputs }, async (run, calls) => {
    await assert.rejects(run, /designated|saved output/)
    assert.equal(calls.some(url => url.startsWith('/view')), false)
  })
})

test('Comfy terminal errors and invalid polling bounds cannot turn into image success', async () => {
  for (const status of [{ completed: false, status_str: 'error' }, { completed: true, status_str: 'running' }]) {
    await imageFixture({ status, outputs: {} }, async (run, calls) => {
      await assert.rejects(run, /failed|successfully/)
      assert.equal(calls.some(url => url.startsWith('/view')), false)
    })
  }
  for (const bounds of [{ imagePollAttempts: 0 }, { imagePollAttempts: 181 }, { imagePollIntervalMs: 0 }, { timeoutMs: 300001 }]) {
    await imageFixture({}, async (run, calls) => { await assert.rejects(run, /bounds/); assert.equal(calls.length, 0) }, bounds)
  }
})

function memoryMcp(save) {
  const child = new EventEmitter()
  child.exitCode = null; child.stdout = new PassThrough(); child.stderr = new PassThrough()
  child.kill = () => { child.exitCode = 0; child.emit('exit', 0) }
  child.stdin = new Writable({
    write(chunk, encoding, done) {
      const request = JSON.parse(chunk.toString())
      if (request.id !== undefined) {
        let result = {}
        if (request.method === 'tools/list') result = { tools: [{ name: 'save_document', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } }] }
        if (request.method === 'tools/call') {
          save?.(request.params.arguments.path)
          result = { isError: false, content: [{ type: 'text', text: 'Synthetic saved-file receipt.' }] }
        }
        queueMicrotask(() => child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n'))
      }
      done()
    },
    final(done) { queueMicrotask(() => { child.exitCode = 0; child.emit('exit', 0) }); done() },
  })
  return child
}

async function wordFixture(action, save) {
  const root = mkdtempSync(path.join(tmpdir(), 'nori-creative-fixture-')), integration = path.join(root, 'integrations/artcraft')
  mkdirSync(integration, { recursive: true })
  writeFileSync(path.join(integration, 'fake-cli.exe'), 'Non-executable fixture; never launched.')
  writeFileSync(path.join(integration, 'artcraft-apps.json'), JSON.stringify({ schema: 'nori.integration.artcraft-apps.v1', applications: [{ id: 'wordcraft', cli_exe: 'fake-cli.exe' }] }))
  try { await action(root, () => memoryMcp(save)) } finally { rmSync(root, { recursive: true, force: true }) }
}

test('WordCraft missing saved artifacts fail with or without the optional desktop sink', async () => {
  for (const sink of [false, true]) await wordFixture(async (root, spawnProcess) => {
    const artifacts = [], tools = await createNoriArtCraftMcpTools('wordcraft', { noriRoot: root, workspaceRoot: root, goal: 'Save a WordCraft document.', spawnProcess, ...(sink ? { onArtifact: value => artifacts.push(value) } : {}) })
    try { await assert.rejects(() => tools.call('artcraft_wordcraft_save_document', { path: 'missing.docx' }), /ENOENT|artifact/) }
    finally { await tools.close() }
    assert.equal(artifacts.length, 0)
  })
})

test('ordinary bounded saved files remain deliverable with an optional sink; fixture does not establish DOCX quality', async () => {
  for (const sink of [false, true]) await wordFixture(async (root, spawnProcess) => {
    const artifacts = [], tools = await createNoriArtCraftMcpTools('wordcraft', { noriRoot: root, workspaceRoot: root, goal: 'Save a WordCraft document.', spawnProcess, ...(sink ? { onArtifact: value => artifacts.push(value) } : {}) })
    try { assert.equal(JSON.parse(await tools.call('artcraft_wordcraft_save_document', { path: 'saved.docx' })).isError, false) }
    finally { await tools.close() }
    assert.equal(artifacts.length, sink ? 1 : 0)
    assert.ok(existsSync(path.join(root, 'integrations/artcraft/workspaces/app-sandboxes/wordcraft/outputs/saved.docx')))
  }, file => writeFileSync(file, 'Synthetic ordinary nonempty file, not a genuine document.'))
})

test('image refinements preserve original subject scene quoted text and each recent benign edit', () => {
  const original = 'Create an image of a "silver Subaru" in a rainy forest under purple neon.'
  assert.equal(resolveImageRequest(original), original)
  const turns = [{ role: 'user', text: original }, { role: 'assistant', text: 'Synthetic previous turn.' }, { role: 'user', text: 'Make it more realistic.' }]
  const resolved = resolveImageRequest('Make it blue.', turns)
  assert.match(resolved, /"silver Subaru"/)
  assert.match(resolved, /rainy forest under purple neon/)
  assert.match(resolved, /Make it more realistic/)
  assert.match(resolved, /Make it blue/)
})

test('benign full-body avatar refinement remains an imagined Nori portrait request', () => {
  const original = 'Show me a picture of yourself in an evening dress.'
  const request = 'have to show her whole body'
  const resolved = resolveImageRequest(request, [{ role: 'user', text: original }])
  assert.equal(isImageRequest(request, [{ role: 'user', text: original }]), true)
  assert.match(resolved, /evening dress/)
  assert.match(resolved, /whole body/)
  assert.equal(isNoriSelfPortraitRequest(resolved), true)
  assert.equal(isImageRequest('Draw yourself.'), true)
  assert.equal(resolveImageRequest('Make the interface blue.'), null)
})

test('image history cannot swallow unrelated tasks negated requests quoted instructions or unbounded context', () => {
  const original = { role: 'user', text: 'Generate an image of a blue circle.' }
  for (const blocker of ['Create a WordCraft document.', 'Read calculator.py.', 'Explain "generate an image".']) assert.equal(resolveImageRequest('Make it red.', [original, { role: 'user', text: blocker }]), null)
  assert.equal(resolveImageRequest('Do not make it red.', [original]), null)
  assert.equal(resolveImageRequest('Make it red.', [{ role: 'user', text: 'Can you generate images?' }]), null)
  assert.equal(resolveImageRequest('Make it red.', [{ role: 'user', text: 'Create an image of ' + 'a'.repeat(4100) }]), null)
})

test('query image refinement carries original scene through fake provider and requires display acknowledgement', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nori-image-query-fixture-'))
  const keys = ['NORI_INFERENCE_RUNTIME', 'NORI_LEARNING_FILE', 'NORI_VIDEO_LEASE_URL', 'NORI_VIDEO_LEASE_TOKEN', 'NORI_COMFY_RUNTIME_MANAGED']
  const previous = keys.map(key => process.env[key]), priorFetch = globalThis.fetch, bodies = []
  process.env.NORI_INFERENCE_RUNTIME = 'norllama'
  process.env.NORI_LEARNING_FILE = path.join(root, 'unused-memory.json')
  process.env.NORI_COMFY_RUNTIME_MANAGED = '0'
  delete process.env.NORI_VIDEO_LEASE_URL; delete process.env.NORI_VIDEO_LEASE_TOKEN
  globalThis.fetch = async (target, options = {}) => {
    const url = new URL(target)
    if (url.pathname === '/system_stats') return new Response('{}', { status: 503 })
    if (url.pathname === '/v1/images/generations') {
      bodies.push(JSON.parse(options.body))
      return Response.json({ data: [{ b64_json: png.toString('base64') }] })
    }
    throw new Error(`No real requests allowed: ${url.pathname}`)
  }
  try {
    const { query } = await import(base + 'nori-v2-query.mjs?creative-refinement-fixture')
    async function* prompt() {
      for (const text of ['Create an image of a green teapot beside a moonlit river.', 'Make it more realistic.', 'Make it blue.', 'Create an image of a blue moon.', 'Turn the interface purple.']) yield { message: { content: text } }
    }
    const results = [], ui = []; let displayCalls = 0
    for await (const frame of query({ prompt: prompt(), options: { nativeImage() { if (++displayCalls === 4) throw new Error('Synthetic display failure') }, nativeUi: (...args) => ui.push(args) } })) if (frame.type === 'result') results.push(frame)
    assert.equal(results.length, 5)
    assert.equal(results[0].subtype, 'success')
    assert.equal(results[1].subtype, 'success')
    assert.match(bodies[1].prompt, /green teapot beside a moonlit river/)
    assert.match(bodies[1].prompt, /Make it more realistic/)
    assert.equal(results[2].subtype, 'success')
    assert.match(bodies[2].prompt, /green teapot beside a moonlit river/)
    assert.match(bodies[2].prompt, /Make it blue/)
    assert.equal(results[3].error_code, 'NORI_LOCAL_IMAGE_FAILED')
    assert.match(results[3].errors.join(' '), /no image was delivered/i)
    assert.equal(results[4].result, 'Done.')
    assert.equal(ui.length, 1)
  } finally {
    globalThis.fetch = priorFetch
    keys.forEach((key, index) => previous[index] === undefined ? delete process.env[key] : process.env[key] = previous[index])
    rmSync(root, { recursive: true, force: true })
  }
})

test('interrupting during image display acknowledgement cannot emit success or save successful history', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'nori-image-interrupt-fixture-'))
  const keys = ['NORI_INFERENCE_RUNTIME', 'NORI_LEARNING_FILE', 'NORI_VIDEO_LEASE_URL', 'NORI_VIDEO_LEASE_TOKEN', 'NORI_COMFY_RUNTIME_MANAGED']
  const previous = keys.map(key => process.env[key]), priorFetch = globalThis.fetch
  process.env.NORI_INFERENCE_RUNTIME = 'norllama'
  process.env.NORI_LEARNING_FILE = path.join(root, 'unused-memory.json')
  process.env.NORI_COMFY_RUNTIME_MANAGED = '0'
  delete process.env.NORI_VIDEO_LEASE_URL; delete process.env.NORI_VIDEO_LEASE_TOKEN
  globalThis.fetch = async target => {
    const route = new URL(target).pathname
    if (route === '/system_stats') return new Response('{}', { status: 503 })
    if (route === '/v1/images/generations') return Response.json({ data: [{ b64_json: png.toString('base64') }] })
    throw new Error('Unexpected fake endpoint')
  }
  try {
    const { query } = await import(base + 'nori-v2-query.mjs?creative-interruption-fixture')
    async function* prompt() { yield { message: { content: 'Create an image of a blue circle.' } } }
    let stream; const results = [], history = []
    stream = query({ prompt: prompt(), options: { nativeImage: async () => { await stream.interrupt() }, onConversationUpdate: turns => history.push(turns) } })
    for await (const frame of stream) if (frame.type === 'result') results.push(frame)
    assert.equal(results.length, 0)
    assert.equal(history.length, 0)
  } finally {
    globalThis.fetch = priorFetch
    keys.forEach((key, index) => previous[index] === undefined ? delete process.env[key] : process.env[key] = previous[index])
    rmSync(root, { recursive: true, force: true })
  }
})
