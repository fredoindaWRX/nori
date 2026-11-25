import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createNoriArtCraftMcpTools } from '../bridge/artcraft-mcp-tools.mjs'
import { callThroughNeuralese } from '../bridge/neuralese-project-tools.mjs'

const NORI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
let neuraleseCallNumber = 0

function selectedPackageRoot() {
  const installedSuiteRoot = process.env.NORI_TEST_NORI_SUITE_ROOT
  if (installedSuiteRoot) {
    const root = path.resolve(installedSuiteRoot)
    if (!existsSync(path.join(root, 'integrations/artcraft/artcraft-apps.json'))) {
      throw new Error(`Explicit installed Nori suite has no ArtCraft integration manifest: ${root}`)
    }
    return root
  }
  const candidate = process.env.NORI_TEST_DESKTOP_CANDIDATE
    || readFileSync(path.join(NORI_ROOT, 'apps/desktop/release/current-desktop.txt'), 'utf8').trim()
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(candidate)) {
    throw new Error(`Invalid Nori desktop package candidate: ${candidate || '(empty)'}`)
  }
  const root = path.join(NORI_ROOT, 'apps/desktop/release', `native-desktop-${candidate}`,
    'win-unpacked/resources/NoriSuite')
  if (!candidate || !existsSync(path.join(root, 'integrations/artcraft/artcraft-apps.json'))) {
    throw new Error(`Selected Nori desktop package has no ArtCraft integration: ${candidate || '(empty pointer)'}`)
  }
  return root
}

function pdfFixture() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 180] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    '<< /Length 58 >>\nstream\nBT /F1 16 Tf 30 100 Td (Nori PDF workflow smoke test) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets = [0]
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(body, 'ascii'))
    body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(body, 'ascii')
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(body, 'ascii')
}

function wavFixture() {
  const sampleRate = 8000
  const samples = 800
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVE', 8)
  buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36)
  buffer.writeUInt32LE(samples * 2, 40)
  return buffer
}

function parseCall(raw, label) {
  const result = JSON.parse(raw)
  assert.equal(result.isError, false, `${label}: ${result.content?.map(item => item.text).join('\n') || raw}`)
  return result
}

async function withApp(appId, goal, callback) {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), `nori-${appId}-packaged-`))
  const artifacts = []
  const session = await createNoriArtCraftMcpTools(appId, {
    noriRoot: selectedPackageRoot(), workspaceRoot, goal, timeoutMs: 60_000,
    onArtifact: artifact => artifacts.push(artifact),
  })
  try {
    const call = async (tool, args = {}) => {
      assert.ok(session.definitions.some(item => item.function.name === tool), `${appId} exposes ${tool} for this task`)
      const callId = `artcraft_${appId}_${++neuraleseCallNumber}`
      return parseCall(await callThroughNeuralese(session, tool, args, { maxBytes: 8192 }, callId, goal), `${appId}.${tool}`)
    }
    await callback({ call, workspaceRoot })
    if (appId !== 'lightcraft') {
      assert.ok(artifacts.length > 0, `${appId} reports its saved file to Nori Outputs`)
    }
    const outputRoot = path.join(workspaceRoot, 'integrations/artcraft/workspaces/app-sandboxes', appId, 'outputs')
    for (const artifact of artifacts) {
      assert.equal(artifact.appId, appId)
      assert.equal(path.dirname(artifact.path), outputRoot)
      assert.equal(artifact.name, path.basename(artifact.path))
      assert.ok(statSync(artifact.path).isFile() && statSync(artifact.path).size > 0)
    }
  } finally {
    await session.close()
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
}

function output(workspaceRoot, appId, name) {
  const root = path.join(workspaceRoot, 'integrations/artcraft/workspaces/app-sandboxes', appId, 'outputs')
  const file = path.join(root, name)
  assert.ok(existsSync(file), `${appId} output exists: ${name}`)
  assert.ok(statSync(file).size > 0, `${appId} output is non-empty: ${name}`)
  return file
}

test('selected packaged ArtCraft CLIs complete isolated create/read/edit/save workflows', { timeout: 360_000 }, async t => {
  const packageRoot = selectedPackageRoot()
  t.diagnostic(`Package under test: ${path.relative(NORI_ROOT, packageRoot)}`)

  await t.test('FilmCraft creates a project and sequence, then saves it inside its Nori output root', async () => {
    await withApp('filmcraft', 'Create a short video project and sequence, then save it', async ({ call, workspaceRoot }) => {
      await call('artcraft_filmcraft_command_run', { id: 'file.newProject', params: { name: 'Nori packaged smoke' } })
      await call('artcraft_filmcraft_command_run', { id: 'file.newSequence', params: {
        name: 'Smoke sequence', width: 320, height: 180, fps: 24, sampleRate: 48000,
      } })
      await call('artcraft_filmcraft_project_inspect')
      await call('artcraft_filmcraft_command_run', { id: 'file.saveAs', params: { path: 'nori-filmcraft-smoke.project' } })
      output(workspaceRoot, 'filmcraft', 'nori-filmcraft-smoke.project')
    })
  })

  await t.test('PDFCraft opens a synthetic PDF, extracts its text, and saves a copy', async () => {
    await withApp('pdfcraft', 'Read and extract text from a PDF, then save a copy', async ({ call, workspaceRoot }) => {
      const base = path.join(workspaceRoot, 'integrations/artcraft/workspaces/app-sandboxes/pdfcraft/inputs')
      mkdirSync(base, { recursive: true })
      writeFileSync(path.join(base, 'nori-smoke.pdf'), pdfFixture())
      const opened = await call('artcraft_pdfcraft_doc_open', { path: 'nori-smoke.pdf' })
      const text = opened.content.map(item => item.text || '').join('\n')
      const doc = Number(text.match(/\b(?:doc|document|id)\D+(\d+)/i)?.[1])
      assert.ok(Number.isSafeInteger(doc) && doc > 0, `PDFCraft returned a document id: ${text}`)
      await call('artcraft_pdfcraft_doc_info', { doc })
      const extracted = await call('artcraft_pdfcraft_text_extract', { doc, pages: [1] })
      assert.match(extracted.content.map(item => item.text || '').join('\n'), /Nori PDF workflow smoke test/i)
      await call('artcraft_pdfcraft_doc_save', { doc, path: 'nori-pdfcraft-smoke.pdf' })
      output(workspaceRoot, 'pdfcraft', 'nori-pdfcraft-smoke.pdf')
    })
  })

  await t.test('FigCraft creates editable nodes, inspects the document, and saves it', async () => {
    await withApp('figcraft', 'Create a simple interface frame and save the design', async ({ call, workspaceRoot }) => {
      await call('artcraft_figcraft_create_node', { type: 'frame', name: 'Nori smoke frame', x: 0, y: 0, width: 360, height: 240 })
      await call('artcraft_figcraft_create_node', { type: 'text', name: 'Title', text: 'Nori FigCraft smoke', x: 24, y: 24, width: 260, height: 40 })
      await call('artcraft_figcraft_inspect_document', { depth: 4 })
      await call('artcraft_figcraft_save_file', { path: 'nori-figcraft-smoke.figcraft' })
      output(workspaceRoot, 'figcraft', 'nori-figcraft-smoke.figcraft')
    })
  })

  await t.test('PhotoCraft creates and saves a native raster document', async () => {
    await withApp('photocraft', 'Create a blank raster document and save it', async ({ call, workspaceRoot }) => {
      await call('artcraft_photocraft_doc_new', { width: 128, height: 96 })
      await call('artcraft_photocraft_doc_save', { path: 'nori-photocraft-smoke.pcraft' })
      output(workspaceRoot, 'photocraft', 'nori-photocraft-smoke.pcraft')
    })
  })

  await t.test('VectorCraft imports safe SVG, verifies visible artwork, and saves an editable document', async () => {
    await withApp('vectorcraft', 'Create a vector illustration and save it', async ({ call, workspaceRoot }) => {
      const result = await call('artcraft_vectorcraft_create_artwork', {
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect x="20" y="20" width="200" height="120" fill="#224466"/><circle cx="120" cy="80" r="32" fill="#f0b429"/></svg>',
        path: 'nori-vectorcraft-smoke.svg',
      })
      assert.match(result.content.map(item => item.text || '').join('\n'), /verified editable SVG/i)
      const saved = readFileSync(output(workspaceRoot, 'vectorcraft', 'nori-vectorcraft-smoke.svg'), 'utf8')
      assert.match(saved, /<svg\b[^>]*width="240"[^>]*height="160"/)
    })
  })

  await t.test('EffectCraft creates a composition and shape, then saves its project', async () => {
    await withApp('effectcraft', 'Create a motion graphic and save it', async ({ call, workspaceRoot }) => {
      await call('artcraft_effectcraft_open_project', { new: true })
      await call('artcraft_effectcraft_execute_command', { command: 'comp.new', params: {
        name: 'Nori packaged smoke', width: 320, height: 240, duration: 1,
      } })
      await call('artcraft_effectcraft_execute_command', { command: 'shape.newShape', params: {
        kind: 'ellipse', size: [120, 80], position: [160, 120], fill: '#7c3aed',
      } })
      await call('artcraft_effectcraft_save_project', { path: 'nori-effectcraft-smoke.project' })
      output(workspaceRoot, 'effectcraft', 'nori-effectcraft-smoke.project')
    })
  })

  await t.test('DesignCraft creates a brochure text frame, verifies its story, and saves it', async () => {
    await withApp('designcraft', 'Create a brochure with a text story, inspect it, and save it', async ({ call, workspaceRoot }) => {
      await call('artcraft_designcraft_new_document', { title: 'Nori packaged smoke', preset: 'A4' })
      const created = await call('artcraft_designcraft_execute', { command: 'frame.create', params: {
        rect: [36, 36, 420, 180], content: 'text', text: 'Nori DesignCraft packaged workflow smoke test',
      } })
      const frame = JSON.parse(created.content[0].text)
      const story = await call('artcraft_designcraft_get_story', { story: frame.story })
      assert.match(story.content.map(item => item.text || '').join('\n'), /Nori DesignCraft packaged workflow smoke test/)
      await call('artcraft_designcraft_save_document', { path: 'nori-designcraft-smoke.designcraft' })
      output(workspaceRoot, 'designcraft', 'nori-designcraft-smoke.designcraft')
    })
  })

  await t.test('WordCraft creates, reads back, and saves a document', async () => {
    await withApp('wordcraft', 'Write and save a short document', async ({ call, workspaceRoot }) => {
      await call('artcraft_wordcraft_new_document')
      await call('artcraft_wordcraft_type_text', { text: 'Nori WordCraft packaged workflow smoke test.' })
      const text = await call('artcraft_wordcraft_get_text')
      assert.match(text.content.map(item => item.text || '').join('\n'), /Nori WordCraft packaged workflow smoke test/)
      await call('artcraft_wordcraft_save_document', { path: 'nori-wordcraft-smoke.docx' })
      output(workspaceRoot, 'wordcraft', 'nori-wordcraft-smoke.docx')
    })
  })

  await t.test('SoundCraft imports a local synthetic track, opens a session, and bounces audio', async () => {
    await withApp('soundcraft', 'Create an audio session, import a local clip, and bounce a mix', async ({ call, workspaceRoot }) => {
      const base = path.join(workspaceRoot, 'integrations/artcraft/workspaces/app-sandboxes/soundcraft/inputs')
      mkdirSync(base, { recursive: true })
      writeFileSync(path.join(base, 'nori-silence.wav'), wavFixture())
      await call('artcraft_soundcraft_new_session')
      await call('artcraft_soundcraft_import_audio', { path: 'nori-silence.wav' })
      await call('artcraft_soundcraft_save_session', { path: 'nori-soundcraft-smoke.session' })
      await call('artcraft_soundcraft_bounce_mix', { path: 'nori-soundcraft-smoke.wav' })
      output(workspaceRoot, 'soundcraft', 'nori-soundcraft-smoke.session')
      output(workspaceRoot, 'soundcraft', 'nori-soundcraft-smoke.wav')
    })
  })

  await t.test('DeckCraft creates and saves a presentation with a content-bearing slide', async () => {
    await withApp('deckcraft', 'Create a slide presentation and save it', async ({ call, workspaceRoot }) => {
      await call('artcraft_deckcraft_new_presentation', { blank: true })
      await call('artcraft_deckcraft_add_slide', { title: 'Nori packaged smoke', body: 'A locally created slide.', layout: 'title-and-content' })
      await call('artcraft_deckcraft_inspect_document')
      await call('artcraft_deckcraft_save_presentation', { path: 'nori-deckcraft-smoke.deckcraft' })
      output(workspaceRoot, 'deckcraft', 'nori-deckcraft-smoke.deckcraft')
    })
  })

  await t.test('CADCraft creates a drawing, adds geometry, inspects, and saves it', async () => {
    await withApp('cadcraft', 'Draw a simple CAD rectangle and save the drawing', async ({ call, workspaceRoot }) => {
      await call('artcraft_cadcraft_new_drawing', { metric: true })
      await call('artcraft_cadcraft_execute', { command: 'rectang', params: { p1: [0, 0], p2: [100, 60] } })
      const inspected = await call('artcraft_cadcraft_inspect_drawing', { entities: true, limit: 20 })
      assert.match(inspected.content.map(item => item.text || '').join('\n'), /rectangle|entities|drawing/i)
      await call('artcraft_cadcraft_save', { path: 'nori-cadcraft-smoke.dxf' })
      output(workspaceRoot, 'cadcraft', 'nori-cadcraft-smoke.dxf')
    })
  })

  await t.test('GridCraft writes a small range, reads it back, and saves a workbook', async () => {
    await withApp('gridcraft', 'Create a spreadsheet, write and verify cells, and save it', async ({ call, workspaceRoot }) => {
      await call('artcraft_gridcraft_new_workbook', { sample: 'budget' })
      await call('artcraft_gridcraft_write_range', { range: 'A1:B2', values: [['Item', 'Value'], ['Nori smoke', 1]] })
      const read = await call('artcraft_gridcraft_read_range', { range: 'A1:B2' })
      assert.match(read.content.map(item => item.text || '').join('\n'), /Nori smoke/i)
      await call('artcraft_gridcraft_save_workbook', { path: 'nori-gridcraft-smoke.xlsx' })
      output(workspaceRoot, 'gridcraft', 'nori-gridcraft-smoke.xlsx')
    })
  })

  await t.test('LightCraft imports a synthetic image and exposes it to the photo library query', async () => {
    await withApp('lightcraft', 'Import a photo into the library and show it', async ({ call, workspaceRoot }) => {
      const base = path.join(workspaceRoot, 'integrations/artcraft/workspaces/app-sandboxes/lightcraft/inputs')
      mkdirSync(base, { recursive: true })
      writeFileSync(path.join(base, 'nori-smoke.png'), Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p7sAAAAASUVORK5CYII=', 'base64'))
      await call('artcraft_lightcraft_import', { paths: ['nori-smoke.png'] })
      const photos = await call('artcraft_lightcraft_query_photos', { limit: 20 })
      assert.match(photos.content.map(item => item.text || '').join('\n'), /nori-smoke\.png|photo|asset/i)
    })
  })
})
