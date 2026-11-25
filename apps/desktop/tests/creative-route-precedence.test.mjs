import test from 'node:test'
import assert from 'node:assert/strict'
import { isImageRequest, isImageCapabilityQuestion } from '../bridge/image-intent.mjs'
import { resolveVideoRequest } from '../bridge/video-intent.mjs'
import { resolveNoriArtCraftApp, requestsNoriArtCraftOperation } from '../bridge/artcraft-tools.mjs'

test('outer still-image shortcut preserves the selected artifact tool', () => {
  const cases = [
    ['Create a CAD drawing of a WRX', 'cadcraft'],
    ['Create a DXF of the red Honda', 'cadcraft'],
    ['Draw a technical drawing of a WRX', 'cadcraft'],
    ['Create an XLSX file of Honda maintenance costs', 'gridcraft'],
    ['Create a UI design for Honda', 'figcraft'],
    ['Create a photo library for Honda photos', 'lightcraft'],
    ['Create an SVG illustration of a Honda', 'vectorcraft'],
    ['Create a spreadsheet listing Honda maintenance costs', 'gridcraft'],
    ['Write a report about a Honda', 'wordcraft'],
    ['Create a motion graphic', 'effectcraft'],
    ['Create a brochure', 'designcraft'],
    ['Create a presentation', 'deckcraft'],
    ['Mix audio', 'soundcraft'],
    ['Read and summarize a PDF', 'pdfcraft'],
    ['Retouch this photo', 'photocraft'],
    ['Edit a video timeline', 'filmcraft'],
  ]
  for (const [goal, app] of cases) {
    assert.equal(resolveNoriArtCraftApp(goal), app, goal)
    assert.equal(requestsNoriArtCraftOperation(goal), true, goal)
    assert.equal(isImageRequest(goal), false, goal)
    assert.equal(resolveVideoRequest(goal), null, goal)
  }
  const ambiguous = 'Create a CAD drawing and an XLSX file of a Honda'
  assert.equal(resolveNoriArtCraftApp(ambiguous), null)
  assert.equal(isImageRequest(ambiguous), false)
})

test('quoted instructions and negated requests do not start image generation', () => {
  for (const goal of [
    'Don’t create an image of a cat', "Don't create an image of a cat",
    'Explain this example: "Create an image of a cat"',
    'Summarize this example: `Create an image of a cat`',
    'Explain this example:\n```\nCreate an image of a cat\n```',
  ]) assert.equal(isImageRequest(goal), false, goal)
  assert.equal(isImageCapabilityQuestion('Explain "Can you create images?"'), false)
})

test('valid image generation, capability questions and scoped follow-ups remain supported', () => {
  for (const goal of ['Create an image of a red Honda', 'Draw a purple galaxy',
    'Make me a blue WRX', 'Can you create a picture of a purple galaxy?']) {
    assert.equal(isImageRequest(goal), true, goal)
  }
  assert.equal(isImageCapabilityQuestion('Can you create pictures already?'), true)
  assert.equal(isImageRequest('Can you create pictures already?'), false)
  const imageHistory = [{ role: 'user', text: 'Generate a picture of a car.' }]
  assert.equal(isImageRequest('Make it red.', imageHistory), true)
  for (const text of ['Create a CAD drawing of an image of a car.',
    'Create a document in WordCraft.', 'Explain "Generate a picture of a car"']) {
    assert.equal(isImageRequest('Make it red.', [...imageHistory, { role: 'user', text }]), false, text)
  }
  for (const goal of ['Create a website', 'Make an image-generation plugin', 'Go create the skill that you do that.']) {
    assert.equal(isImageRequest(goal, imageHistory), false, goal)
  }
})
