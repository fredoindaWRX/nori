import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const bridgeModule = process.env.NORI_ARTCRAFT_BRIDGE_MODULE
  ? pathToFileURL(process.env.NORI_ARTCRAFT_BRIDGE_MODULE).href
  : new URL('../bridge/artcraft-mcp-tools.mjs', import.meta.url).href
const { createNoriArtCraftMcpTools } = await import(bridgeModule)

test('WordCraft reports only a verified saved local artifact to the desktop sink', { timeout: 45_000 }, async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'nori-artifact-delivery-'))
  const artifacts = []
  const tools = await createNoriArtCraftMcpTools('wordcraft', {
    noriRoot: 'C:/Nori', workspaceRoot, goal: 'Create a short local report and save it',
    onArtifact: artifact => artifacts.push(artifact),
  })
  try {
    await tools.call('artcraft_wordcraft_new_document', {})
    await tools.call('artcraft_wordcraft_type_text', { text: 'Nori artifact delivery test.' })
    await assert.rejects(() => tools.call('artcraft_wordcraft_save_document', { path: '../escape.docx' }))
    assert.equal(artifacts.length, 0)
    await tools.call('artcraft_wordcraft_save_document', { path: 'delivery.docx' })
    assert.equal(artifacts.length, 1)
    assert.deepEqual(Object.keys(artifacts[0]).sort(), ['appId', 'name', 'path', 'tool'])
    assert.equal(artifacts[0].appId, 'wordcraft')
    assert.equal(artifacts[0].name, 'delivery.docx')
    assert.equal(artifacts[0].tool, 'artcraft_wordcraft_save_document')
    assert.ok(existsSync(artifacts[0].path))
    assert.match(artifacts[0].path, /app-sandboxes[\\/]wordcraft[\\/]outputs[\\/]delivery\.docx$/i)
  } finally {
    await tools.close()
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
})
