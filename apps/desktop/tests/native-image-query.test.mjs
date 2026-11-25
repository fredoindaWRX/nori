import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('native image routing reports provider failure, generates an imagined self portrait, and recovers', async () => {
  const fixture = mkdtempSync(join(tmpdir(), 'nori-image-query-'))
  const keys = ['NORI_INFERENCE_RUNTIME', 'NORI_LEARNING_FILE', 'NORI_IMAGE_API', 'NORI_COMFY_URL']
  const previous = keys.map(key => process.env[key])
  const requests = []
  const imageBodies = []
  const server = createServer((request, response) => {
    requests.push(request.url)
    if (request.url === '/v1/images/generations') {
      const chunks = []
      request.on('data', chunk => chunks.push(chunk))
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        imageBodies.push(body)
        if (body.prompt.includes('original imagined portrait of N.O.R.I.')) {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8ioAAAAASUVORK5CYII=' }] }))
        } else {
          response.writeHead(503, { 'content-type': 'application/json' }); response.end('{}')
        }
      })
      return
    }
    response.writeHead(503, { 'content-type': 'application/json' }); response.end('{}')
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  try {
    process.env.NORI_INFERENCE_RUNTIME = 'norllama'
    process.env.NORI_LEARNING_FILE = join(fixture, 'unused-memory.json')
    process.env.NORI_IMAGE_API = process.env.NORI_COMFY_URL = `http://127.0.0.1:${server.address().port}`
    const { query } = await import('../bridge/nori-v2-query.mjs?native-image-query')
    async function* prompt() {
      yield { message: { content: 'Can you create pictures already?' } }
      yield { message: { content: 'Generate a picture of a red Subaru WRX with BBS wheels.' } }
      yield { message: { content: 'show me a picture of yourself' } }
      yield { message: { content: 'Turn the interface ghost purple.' } }
    }
    let delivered = 0; const results = [], ui = []
    for await (const frame of query({ prompt: prompt(), options: {
      nativeImage: () => { delivered++ }, nativeUi: (...args) => ui.push(args),
    } })) if (frame.type === 'result') results.push(frame)
    assert.equal(results.length, 4)
    assert.equal(results[0].subtype, 'success')
    assert.match(results[0].result, /not responding/)
    assert.equal(results[1].error_code, 'NORI_LOCAL_IMAGE_FAILED')
    assert.match(results[1].errors[0], /no image was delivered/)
    assert.match(imageBodies[0].prompt, /uniform red paint across every painted exterior body panel/)
    assert.match(imageBodies[0].prompt, /recognizable BBS mesh-style performance wheels/)
    assert.doesNotMatch(imageBodies[0].prompt, /World Rally Blue|gold multi-spoke rally wheels/)
    assert.match(imageBodies[1].prompt, /fictional feminine AI assistant/)
    assert.match(imageBodies[1].prompt, /clearly adult/)
    assert.match(imageBodies[1].prompt, /not a photograph of a real person/)
    assert.equal(results[2].subtype, 'success')
    assert.equal(results[2].result, 'I created an imagined portrait of Nori and put it on the display.')
    assert.equal(results[3].result, 'Done.')
    assert.equal(delivered, 1)
    assert.equal(ui.length, 1)
    assert.deepEqual(requests, ['/v1/models', '/system_stats', '/system_stats', '/v1/images/generations', '/system_stats', '/v1/images/generations'])
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index] })
    server.closeAllConnections(); await new Promise(done => server.close(done))
    rmSync(fixture, { recursive: true, force: true })
  }
})
