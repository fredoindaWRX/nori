import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveNoriArtCraftLaunch, artCraftLabel } from '../bridge/artcraft-tools.mjs'

test('plain launch resolves one named creative app without authorizing document work', () => {
  assert.deepEqual(resolveNoriArtCraftLaunch('start PDFCraft'), { name: 'launch_artcraft_app', args: { app_id: 'pdfcraft' } })
  assert.deepEqual(resolveNoriArtCraftLaunch('fire up WordCraft'), { name: 'launch_artcraft_app', args: { app_id: 'wordcraft' } })
  for (const text of ['Why did WordCraft start?', 'Do not start PDFCraft', 'start WordCraft and create a document', 'start PDFCraft and WordCraft']) assert.equal(resolveNoriArtCraftLaunch(text), null, text)
})

test('app display labels preserve acronyms', () => {
  assert.equal(artCraftLabel('pdfcraft'), 'PDFCraft')
  assert.equal(artCraftLabel('cadcraft'), 'CADCraft')
  assert.equal(artCraftLabel('wordcraft'), 'WordCraft')
})
