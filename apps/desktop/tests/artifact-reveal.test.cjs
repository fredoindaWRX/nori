const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const modulePath = process.env.NORI_ARTIFACT_REVEAL_MODULE || '../desktop/artifact-reveal.cjs'
const { revealArtCraftArtifact } = require(modulePath)

test('only the owning renderer can reveal an ordinary ArtCraft output file', () => {
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nori-reveal-'))
  const output = path.join(dataRoot, 'integrations', 'artcraft', 'workspaces', 'app-sandboxes', 'wordcraft', 'outputs')
  const outside = path.join(dataRoot, 'outside.docx')
  const saved = path.join(output, 'saved.docx')
  const shown = []
  fs.mkdirSync(output, { recursive: true })
  fs.writeFileSync(saved, 'synthetic document')
  fs.writeFileSync(outside, 'private fixture')
  const reveal = revealArtCraftArtifact({ dataRoot, owns: event => event === 'owned', showItemInFolder: file => shown.push(file) })
  try {
    assert.equal(reveal('foreign', { appId: 'wordcraft', path: saved }), false)
    assert.equal(reveal('owned', { appId: 'wordcraft', path: outside }), false)
    assert.equal(reveal('owned', { appId: 'unknown', path: saved }), false)
    assert.equal(reveal('owned', { appId: 'wordcraft', path: saved, extra: true }), false)
    assert.equal(reveal('owned', { appId: 'wordcraft', path: saved }), true)
    assert.deepEqual(shown, [saved])
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true })
  }
})
