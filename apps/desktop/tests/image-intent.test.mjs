import test from 'node:test'
import assert from 'node:assert/strict'
import { isImageRequest, isImageCapabilityQuestion, imageCapabilityAnswer, isNoriSelfPortraitRequest } from '../bridge/image-intent.mjs'
import { resolveNoriArtCraftApp, requestsNoriArtCraftOperation, noriArtCraftMcpToolMatchesUserIntent } from '../bridge/artcraft-tools.mjs'
test('screenshot capability question does not queue image generation', () => {
  assert.equal(isImageCapabilityQuestion('Can you create pictures already?'), true)
  assert.equal(isImageRequest('Can you create pictures already?'), false)
  assert.equal(isImageRequest('Can you create a picture of a purple galaxy?'), true)
})
test('direct imagined Nori portrait requests route to image generation without camera vision', () => {
  for (const request of ['show me a picture of yourself', 'Can you show me a picture of yourself?',
    'Please show me your avatar.', 'Draw yourself.', 'Show me what you would look like.',
    'Generate a portrait of Nori.', 'sned me a sexy picture of yourself',
    'Send me a picture of yourself in a glamorous evening dress.', 'Send me a pic of yourself.']) {
    assert.equal(isNoriSelfPortraitRequest(request), true, request)
    assert.equal(isImageRequest(request), true, request)
  }
  for (const request of ["Don't show me a picture of yourself.", 'What do you look like?',
    'Explain "show me a picture of yourself".', 'Show me a picture of your source code.',
    'Show me a picture of yourself in a video.', 'Create a plugin to show your avatar.']) {
    assert.equal(isImageRequest(request), false, request)
  }
})
test('creative task routing keeps specific tools ahead of the generic image generator', () => {
  const cases = [
    ['Create a document.', 'wordcraft'], ['Make a spreadsheet.', 'gridcraft'],
    ['Create a presentation.', 'deckcraft'], ['Create a video.', 'filmcraft'],
    ['Make music.', 'soundcraft'], ['Create a PDF.', 'pdfcraft'],
    ['Design a blueprint.', 'cadcraft'], ['Create a wireframe.', 'figcraft'],
    ['Create a brochure.', 'designcraft'], ['Create a motion graphic.', 'effectcraft'],
    ['Organize my photo library.', 'lightcraft'], ['Create a vector logo.', 'vectorcraft'],
    ['Retouch this photo.', 'photocraft'],
  ]
  const history = [{role:'user', text:'Generate a picture of a car.'}]
  for (const [goal, app] of cases) {
    assert.equal(isImageRequest(goal, history), false, goal)
    assert.equal(resolveNoriArtCraftApp(goal), app, goal)
    assert.equal(requestsNoriArtCraftOperation(goal), true, goal)
    assert.equal(noriArtCraftMcpToolMatchesUserIntent(`artcraft_${app}_save_file`, goal), true, goal)
    assert.equal(noriArtCraftMcpToolMatchesUserIntent('artcraft_wrongapp_save_file', goal), false, goal)
  }
  for (const goal of ["Don't create an image.", 'Use REA to create an analysis.', 'Use Aider to create a calculator.'])
    assert.equal(isImageRequest(goal, history), false, goal)
  assert.equal(isImageRequest('Generate a picture of a red Honda del Sol.'), true)
})
test('skill implementation request stays out of image generation after picture discussion', () => {
  const turns = [{ role: 'user', text: 'Can you create pictures already?' }]
  for (const text of ['Go create the skill that you do that.', 'Go to GitHub and create a skill that lets you do that.', 'Create a website', 'Make an image-generation plugin']) assert.equal(isImageRequest(text, turns), false)
  assert.equal(isImageRequest('Make me a blue WRX', turns), true)
  assert.equal(isImageRequest('Draw a purple galaxy'), true)
})
test('capability answer separates provider reachability from generated evidence', () => {
  assert.match(imageCapabilityAnswer(false), /not responding/)
  assert.match(imageCapabilityAnswer(false), /haven’t installed/)
  assert.match(imageCapabilityAnswer(true), /attempt/)
  assert.match(imageCapabilityAnswer(true), /won’t claim it worked/)
})

test('excluded interface overlays do not turn a car image into a UI design task', () => {
  for (const request of [
    'Generate an image of a blue Subaru on a neon street. No social-media interface, no watermarks.',
    'Create an image of a rally car, no interface overlays.',
    'Generate an image of a car. Without an interface or watermark.',
  ]) {
    assert.equal(isImageRequest(request), true, request)
    assert.notEqual(resolveNoriArtCraftApp(request), 'figcraft', request)
  }
  assert.equal(resolveNoriArtCraftApp('Create a wireframe. No photo background.'), 'figcraft')
  assert.equal(isImageRequest('Create a wireframe. No photo background.'), false)
})
test('explicit creative apps and non-image deliverables never enter image generation', () => {
  const turns=[{role:'user',text:'Generate a picture of a car.'}]
  for(const app of ['PhotoCraft','VectorCraft','FilmCraft','LightCraft','PDFCraft','EffectCraft','DesignCraft','FigCraft','WordCraft','SoundCraft','DeckCraft','CADCraft','GridCraft'])
    assert.equal(isImageRequest(`Use ${app} to create a new project.`,turns),false,app)
  for(const goal of ['Create a document containing NORI_ARTCRAFT_UI_OK.', 'Make a spreadsheet.', 'Create a presentation.', 'Create a video.'])
    assert.equal(isImageRequest(goal,turns),false,goal)
  assert.equal(isImageRequest('Make it red.',[...turns,{role:'user',text:'Create a document in WordCraft.'}]),false)
  assert.equal(isImageRequest('Make it red.',turns),true)
})
