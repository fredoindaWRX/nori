import test from 'node:test'
import assert from 'node:assert/strict'
import { isVideoCapabilityQuestion, isVideoRequest, resolveVideoRequest, videoCapabilityAnswer } from '../bridge/video-intent.mjs'
import { resolveNoriArtCraftApp, requestsNoriArtCraftOperation } from '../bridge/artcraft-tools.mjs'

test('video generation, editing, and capability questions select different routes', () => {
  assert.equal(isVideoCapabilityQuestion('Can you generate videos?'), true)
  assert.equal(isVideoRequest('Can you generate videos?'), false)
  assert.equal(isVideoRequest('Create a short video of a red WRX driving through Lawrence.'), true)
  assert.equal(isVideoRequest('Make it a short clip.', [{ role: 'user', text: 'Generate a video of a car.' }]), true)
  assert.equal(isVideoRequest('Edit the video in FilmCraft and trim the opening.'), false)
  assert.equal(isVideoRequest('Generate a video script for me.'), false)
  assert.equal(isVideoRequest('Create a 2-second blue circle animation.'), false)
  assert.equal(isVideoRequest('Use EffectCraft to create a 2-second blue circle animation.'), false)
  assert.match(videoCapabilityAnswer(true), /local video generator/)
  assert.match(videoCapabilityAnswer(false), /not contacted a cloud service/)
})

test('animated scenes preserve the subject across refinements and explicit confirmation',()=>{
  const scene='create me an animated Hallows Eve themed view looking through a window at rain and leaves falling'
  assert.equal(isVideoRequest(scene),true)
  const turns=[{role:'user',text:scene},{role:'nori',text:'I made it and put it on the display.'},
    {role:'user',text:'make it more realistic'},{role:'nori',text:'Use diffused streetlamp light and raindrop reflections.'}]
  const resolved=resolveVideoRequest('yes do it exactly like that',turns)
  assert.match(resolved,/Hallows Eve/)
  assert.match(resolved,/make it more realistic/)
  assert.match(resolved,/diffused streetlamp light/)
  assert.equal(resolveVideoRequest('yes do it exactly like that',[...turns,{role:'user',text:'What time is it?'}]),null)
  assert.equal(resolveVideoRequest('make it more realistic',[]),null)
  assert.equal(isVideoRequest('Create an animated SVG logo'),false)
  assert.match(resolveVideoRequest('i want you to do it',[...turns,
    {role:'user',text:'did you finish that picture'},
    {role:'nori',text:'I did not generate it.'}]),/Hallows Eve/)
})

test('ArtCraft task router retains domain-specific app selection for non-generation work', () => {
  const cases = [
    ['Create a photorealistic image of a red Del Sol.', 'photocraft'],
    ['Create an SVG logo for Nori.', 'vectorcraft'],
    ['Edit this video in FilmCraft and trim the opening.', 'filmcraft'],
    ['Make a PDF and redact the phone number.', 'pdfcraft'],
    ['Build a spreadsheet with formulas.', 'gridcraft'],
    ['Create a presentation deck.', 'deckcraft'],
    ['Write a DOCX report.', 'wordcraft'],
    ['Create a CAD blueprint.', 'cadcraft'],
    ['Make a UI wireframe prototype.', 'figcraft'],
    ['Compose a podcast soundtrack.', 'soundcraft'],
    ['Create motion graphics with keyframes.', 'effectcraft'],
    ['Develop and organize a raw photo library.', 'lightcraft'],
    ['Create a magazine page layout.', 'designcraft'],
  ]
  for (const [goal, expected] of cases) {
    assert.equal(resolveNoriArtCraftApp(goal), expected, goal)
    assert.equal(requestsNoriArtCraftOperation(goal), true, goal)
  }
  const generated = 'Create a short video of a red WRX driving through Lawrence.'
  assert.equal(isVideoRequest(generated), true)
  // Generated video is intercepted by the local Wan route before the broader
  // content-app resolver gets a chance to interpret the word "video".
  assert.equal(isVideoRequest('Edit the video in FilmCraft and trim the opening.'), false)
  assert.equal(resolveNoriArtCraftApp('Edit this video in FilmCraft and trim the opening.'), 'filmcraft')
})

test('video follow-ups do not capture another tool domain or cancelled requests', () => {
  const turns = [{ role: 'user', text: 'Generate a video of a car.' }]
  for (const goal of ['Create a document', 'Make a PDF', 'Create a presentation', 'Generate an image', 'Make a soundtrack', 'Build a spreadsheet']) {
    assert.equal(isVideoRequest(goal, turns), false, goal)
  }
  for (const goal of ["Don't generate a video", 'Do not create a clip', 'Cancel the video', 'Stop making that video']) {
    assert.equal(isVideoRequest(goal, turns), false, goal)
  }
  assert.equal(isVideoRequest('Make it shorter', turns), true)
  assert.equal(isVideoRequest('Make it shorter', [{ role: 'user', text: 'Create a video script' }]), false)
  assert.equal(isVideoRequest('Make it shorter', [{ role: 'user', text: 'Can you generate videos?' }]), false)
})

