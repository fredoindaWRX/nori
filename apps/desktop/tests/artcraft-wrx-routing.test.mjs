import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { deflateSync } from 'node:zlib'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveNoriArtCraftApp, requestsNoriArtCraftOperation } from '../bridge/artcraft-tools.mjs'
import { createNoriArtCraftMcpTools, scopedWorkspacePath } from '../bridge/artcraft-mcp-tools.mjs'
import { vehicleConceptOutputPath, vehicleConceptSvg } from '../bridge/vehicle-illustration.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))

function validTinyPngBase64() {
  const crc32 = bytes => {
    let crc = 0xffffffff
    for (const byte of bytes) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
    return (crc ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const kind = Buffer.from(type)
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length)
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([kind, data])))
    return Buffer.concat([size, kind, data, checksum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4)
  header[8] = 8; header[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 52, 112, 196, 255]))), chunk('IEND', Buffer.alloc(0))]).toString('base64')
}

test('vehicle photos use PhotoCraft while explicit vector requests use VectorCraft', () => {
  for (const goal of [
    'Have Nori create a WRX in her app with one of the apps.',
    'Make a Subaru WRX.',
    'Design a sports car.',
    'Have Nori generate me a red Honda del Sol with a J30 motor.',
  ]) {
    assert.equal(resolveNoriArtCraftApp(goal), 'photocraft', goal)
    assert.equal(requestsNoriArtCraftOperation(goal), true, goal)
  }
  assert.equal(resolveNoriArtCraftApp('Create an SVG illustration of a Subaru WRX.'), 'vectorcraft')
})

test('plain Subaru WRX task reaches the existing Nori ArtCraft MCP gate', () => {
  const localChat = readFileSync(path.join(here, '../bridge/local-chat.mjs'), 'utf8')
  assert.match(localChat, /const intentGoal = resolveNoriReaIntent\(splitNativeWorkspaceBackground\(goal\)\.request, turns\)/)
  assert.match(localChat, /requestsNoriArtCraft\(intentGoal\)\s*\|\|\s*requestsNoriArtCraftOperation\(intentGoal\)/)
  assert.match(localChat, /photoApp === 'photocraft' && requestedPhotoCreation\(intentGoal\)/)
  assert.match(localChat, /createLocalPhotoInPhotoCraft\(photoTools, intentGoal, \{ signal \}\)/)
  assert.match(localChat, /const artcraftEnabled = requestsNoriArtCraft\(intentGoal\)[\s\S]*?const appBuilderEnabled = !artcraftEnabled/)
  assert.match(localChat, /requestsNoriArtCraftOperation\(intentGoal\)\s*\?\s*resolveNoriArtCraftApp\(intentGoal\)/)
  assert.match(localChat, /isNoriArtCraftMcpScoped\(artcraftMcpApp\)/)
  assert.match(localChat, /Path checks are application-level, not an OS sandbox/)
  assert.match(localChat, /Use the single supplied create_artwork tool to produce polished, editable VectorCraft SVG/)
  assert.match(localChat, /Say done only if the tool confirms import and save/)
  assert.match(localChat, /tool_choice: projectTools\?\.definitions\?\.length && totalToolCalls === 0 \? 'required' : 'auto'/)
  assert.match(localChat, /returned without invoking the explicitly requested/)
  assert.match(localChat, /createLocalVehicleConcept\(projectTools, requestIntent\)/)
  assert.match(localChat, /localVehicleConceptReceipt\(receipt, requestIntent\)/)
})

test('local WRX fallback produces bounded, safe, editable vector artwork and scoped filename', () => {
  const svg = vehicleConceptSvg('Create a blue Subaru WRX with a rally side profile.')
  assert.equal(vehicleConceptOutputPath('Create a Subaru WRX'), 'nori-wrx-concept-20261015.svg')
  assert.match(svg, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(svg, /SUBARU WRX/)
  assert.match(svg, /RALLY SPEC/)
  assert.match(svg, /front three-quarter Subaru WRX rally illustration/i)
  assert.match(svg, /fill="#1769c2"/)
  assert.match(svg, /<path\b/)
  assert.match(svg, /FOUR-DOOR SPORT SEDAN/)
  assert.match(svg, /hood scoop/i)
  assert.match(svg, /angular hexagonal grille/i)
  assert.match(svg, /rally wing/i)
  assert.match(svg, /M355 421 L342 523 M566 414 L560 523 M824 414 L838 523/)
  assert.match(svg, /ORIGINAL CONCEPT ART/)
  assert.doesNotMatch(svg, /<script\b|\bonload\s*=|\bhref\s*=/i)
  assert.doesNotMatch(svg, /url\(https?:/i)
  assert.ok(Buffer.byteLength(svg, 'utf8') < 30_000)
})

test('local concept fallback reports its actual quality boundary instead of claiming a faithful WRX', async () => {
  const localChat = readFileSync(path.join(here, '../bridge/local-chat.mjs'), 'utf8')
  assert.match(localChat, /stylized editable fallback, not a factory-accurate WRX rendering/)
  assert.match(localChat, /localVehicleConceptReceipt\(receipt, requestIntent\)/)
  assert.doesNotMatch(localChat, /created and verified an editable vehicle concept/)
})

test('Nori chat locally generates a WRX image and saves it through Neuralese into PhotoCraft', { timeout: 120_000 }, async () => {
  const png = validTinyPngBase64()
  const imageRequests = []
  let generationCount = 0
  let observeCancelledGeneration
  const cancelledGenerationSeen = new Promise(resolve => { observeCancelledGeneration = resolve })
  const provider = createServer((req, res) => {
    res.setHeader('content-type', 'application/json')
    if (req.url === '/system_stats') { res.writeHead(503); res.end('{}'); return }
    if (req.url === '/v1/images/generations') {
      const chunks = []
      req.on('data', chunk => chunks.push(chunk))
      req.on('end', () => {
        imageRequests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        generationCount++
        if (generationCount > 3) { observeCancelledGeneration(); return }
        res.end(JSON.stringify({ data: [{ b64_json: png }] }))
      })
      return
    }
    res.writeHead(404); res.end('{}')
  })
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'nori-wrx-chat-e2e-'))
  const previous = Object.fromEntries(['NORI_IMAGE_API', 'NORI_COMFY_URL', 'NORI_APP_DATA_ROOT', 'NORI_ROOT']
    .map(key => [key, process.env[key]]))
  try {
    process.env.NORI_IMAGE_API = `http://127.0.0.1:${provider.address().port}`
    process.env.NORI_COMFY_URL = 'http://127.0.0.1:1'
    process.env.NORI_APP_DATA_ROOT = workspaceRoot
    process.env.NORI_ROOT = 'C:/Nori'
    const { localChat } = await import(`../bridge/local-chat.mjs?wrx-e2e=${Date.now()}`)
    const chunks = []
    for await (const chunk of localChat({ goal: 'Create an image of a Subaru WRX in PhotoCraft.' })) chunks.push(chunk)
    assert.match(chunks.join(''), /saved it as a native PhotoCraft document/)
    assert.match(imageRequests[0].prompt, /Subaru WRX/)
    assert.match(imageRequests[0].prompt, /2004[\s\S]*blobeye[\s\S]*WRX STI/)
    assert.match(imageRequests[0].prompt, /rounded oval headlights/)
    assert.match(imageRequests[0].prompt, /hood scoop/)
    assert.match(imageRequests[0].prompt, /hexagonal Subaru grille/)
    assert.match(imageRequests[0].prompt, /gold multi-spoke rally wheels/)
    const redBbsChunks = []
    for await (const chunk of localChat({ goal: 'Create an image of a red Subaru WRX with BBS wheels in PhotoCraft.' })) redBbsChunks.push(chunk)
    assert.match(redBbsChunks.join(''), /saved it as a native PhotoCraft document/)
    assert.match(imageRequests[1].prompt, /uniform red paint across every painted exterior body panel/)
    assert.match(imageRequests[1].prompt, /recognizable BBS mesh-style performance wheels/)
    assert.doesNotMatch(imageRequests[1].prompt, /World Rally Blue|gold multi-spoke rally wheels/)
    const photos = path.join(workspaceRoot, 'integrations', 'artcraft', 'workspaces', 'app-sandboxes', 'photocraft')
    const inputs = path.join(photos, 'inputs')
    const outputs = path.join(photos, 'outputs')
    assert.ok(readdirSync(inputs).some(file => file.endsWith('.png')), 'generated PNG was written into PhotoCraft inputs')
    const savedName = readdirSync(outputs).find(file => file.endsWith('.pcraft'))
    assert.ok(savedName, 'PhotoCraft native project was written')
    assert.ok(existsSync(path.join(outputs, savedName)))
    const hondaChunks = []
    for await (const chunk of localChat({ goal: 'Have Nori generate me a red Honda del Sol with a J30 motor.' })) hondaChunks.push(chunk)
    assert.match(hondaChunks.join(''), /saved it as a native PhotoCraft document/)
    assert.match(imageRequests[2].prompt, /1994 Honda CR-X del Sol/)
    assert.match(imageRequests[2].prompt, /Honda J30-family 3\.0-liter V6 custom engine swap/)
    assert.match(imageRequests[2].prompt, /aftermarket conversion, not a factory del Sol engine option/)
    assert.equal(readdirSync(outputs).filter(file => file.endsWith('.pcraft')).length, 3,
      'all successful local generations should be saved as native PhotoCraft documents')
    const controller = new AbortController()
    const cancelled = (async () => {
      for await (const chunk of localChat({ goal: 'Create an image of a Subaru WRX in PhotoCraft.', signal: controller.signal })) void chunk
    })()
    await Promise.race([cancelledGenerationSeen, new Promise((_, reject) => setTimeout(() => reject(new Error('Cancelled image request never reached the local provider.')), 15_000))])
    controller.abort()
    await assert.rejects(cancelled, { name: 'AbortError' })
    assert.equal(readdirSync(inputs).filter(file => /\.(?:png|jpe?g|webp)$/i.test(file)).length, 3,
      'cancelled image generation must not create a fourth input or document')
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    provider.closeAllConnections()
    await new Promise(resolve => provider.close(resolve))
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('new VectorCraft artwork keeps the command and save tools without catalog prompt bloat', async () => {
  const session = await createNoriArtCraftMcpTools('vectorcraft', { goal: 'Create a Subaru WRX illustration' })
  try {
    assert.deepEqual(session.definitions.map(item => item.function.name), [
      'artcraft_vectorcraft_create_artwork',
    ])
    assert.ok(Buffer.byteLength(JSON.stringify(session.definitions), 'utf8') < 700)
  } finally {
    await session.close()
  }
})

test('a clear request for each installed creative app resolves to one operational route', () => {
  const cases = [
    ['photocraft', 'Retouch a photo'],
    ['vectorcraft', 'Create an SVG illustration of a Subaru WRX'],
    ['filmcraft', 'Create a video project'],
    ['lightcraft', 'Edit a RAW photo'],
    ['pdfcraft', 'Read and summarize a PDF'],
    ['effectcraft', 'Create a motion graphic'],
    ['designcraft', 'Create a brochure'],
    ['figcraft', 'Create a UI wireframe'],
    ['wordcraft', 'Write a Word report'],
    ['soundcraft', 'Mix audio'],
    ['deckcraft', 'Create a slide presentation'],
    ['cadcraft', 'Draw a CAD blueprint'],
    ['gridcraft', 'Create a spreadsheet'],
  ]

  for (const [expectedApp, goal] of cases) {
    assert.equal(resolveNoriArtCraftApp(goal), expectedApp, goal)
    assert.equal(requestsNoriArtCraftOperation(goal), true, goal)
  }
})

test('safe web and file-scope constraints do not suppress an explicit local ArtCraft action', () => {
  const goal = 'For a local integration smoke test only: use VectorCraft to create an SVG with one blue circle. Do not use the web or modify any other files.'
  assert.equal(resolveNoriArtCraftApp(goal), 'vectorcraft')
  assert.equal(requestsNoriArtCraftOperation(goal), true)
  assert.equal(requestsNoriArtCraftOperation('Do not use VectorCraft to create an SVG.'), false)
  assert.equal(requestsNoriArtCraftOperation('How can I use VectorCraft to create an SVG?'), false)
})

test('ArtCraft workspace paths accept scoped outputs and reject traversal or outside paths', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'nori-artcraft-scope-'))
  try {
    assert.equal(scopedWorkspacePath('design.svg', root, 'vectorcraft', 'outputs'), path.join(root, 'design.svg'))
    assert.equal(scopedWorkspacePath('app-sandboxes/vectorcraft/outputs/design.svg', root, 'vectorcraft', 'outputs'),
      path.join(root, 'design.svg'))
    assert.throws(() => scopedWorkspacePath('../outside.svg', root, 'vectorcraft', 'outputs'), /invalid path component/)
    assert.throws(() => scopedWorkspacePath(path.join(os.tmpdir(), 'outside.svg'), root, 'vectorcraft', 'outputs'), /outside its Nori workspace/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
