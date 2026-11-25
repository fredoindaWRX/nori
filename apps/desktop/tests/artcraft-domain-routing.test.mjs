import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveNoriArtCraftApp, requestsNoriArtCraft, requestsNoriArtCraftOperation,
  resolveNoriArtCraftRequest, noriArtCraftMcpToolMatchesUserIntent,
  noriArtCraftToolMatchesUserIntent, hasNoriArtCraftNonImageIntent } from '../bridge/artcraft-tools.mjs'

const routes = [
  ['photocraft', 'Retouch a photo'],
  ['vectorcraft', 'Create an SVG illustration'],
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

function assertRoute(goal, expected) {
  assert.equal(resolveNoriArtCraftApp(goal), expected, goal)
  assert.equal(requestsNoriArtCraftOperation(goal), expected !== null, goal)
  for (const [app] of routes) {
    assert.equal(noriArtCraftMcpToolMatchesUserIntent(`artcraft_${app}_example`, goal), app === expected,
      `${goal}: ${app} tool authority`)
  }
}

test('artifact domains, not vehicle subjects, choose all thirteen tools', () => {
  for (const [app, request] of routes) {
    assertRoute(request, app)
    assertRoute(`${request} about a Honda WRX vehicle`, app)
  }
  assertRoute('Create a spreadsheet listing Honda vehicles', 'gridcraft')
  assertRoute('Write a report about a Honda', 'wordcraft')
  assertRoute('Create a CAD drawing of a WRX', 'cadcraft')
  assertRoute('Create a PowerPoint presentation about Honda', 'deckcraft')
})

test('one explicit app still overrides inferred artifact domains', () => {
  assertRoute('Use GridCraft to create a report about Honda', 'gridcraft')
  assertRoute('Use WordCraft to create a document containing a spreadsheet', 'wordcraft')
  assertRoute('Use PhotoCraft to make an image of a Subaru WRX', 'photocraft')
})

test('shared non-image intent guard covers concrete and competing domains without treating data as authority', () => {
  for (const [app, goal] of routes) assert.equal(hasNoriArtCraftNonImageIntent(goal), app !== 'photocraft', goal)
  for (const goal of ['Create a CAD drawing of a WRX', 'Create an XLSX file', 'Create a UI design',
    'Create a DXF', 'Create a CAD drawing and an XLSX file', 'Use GridCraft to create it']) {
    assert.equal(hasNoriArtCraftNonImageIntent(goal), true, goal)
  }
  for (const goal of ['Create an image of a WRX', 'Make a red Honda',
    'Create an image titled "Use GridCraft to create a spreadsheet"',
    'Create an image of a cat. Do not use GridCraft.']) {
    assert.equal(hasNoriArtCraftNonImageIntent(goal), false, goal)
  }
})

test('vehicle photo fallback and explicit vector requests remain supported', () => {
  for (const goal of ['Have Nori create a WRX in her app with one of the apps.',
    'Make a Subaru WRX.', 'Design a sports car.',
    'Have Nori generate me a red Honda del Sol with a J30 motor.']) assertRoute(goal, 'photocraft')
  assertRoute('Create an SVG illustration of a Subaru WRX.', 'vectorcraft')
  assertRoute('Retouch a photorealistic image', 'photocraft')
})

test('generic negated operations never authorize an ArtCraft operation', () => {
  for (const [, request] of routes) {
    for (const prefix of ["Don't ", 'Do not ', 'Never ', 'Please don’t ', 'dont ']) {
      assertRoute(prefix + request, null)
    }
  }
  assertRoute('Avoid creating a spreadsheet', null)
  assertRoute('Create a spreadsheet. Do not create it.', null)
  assertRoute('Create a spreadsheet. Don’t create a spreadsheet.', null)
  assertRoute('Use GridCraft to create a spreadsheet. Do not use GridCraft.', null)
})

test('negative app scope is excluded without canceling a different positive app', () => {
  assertRoute('Do not use WordCraft. Use GridCraft to create a spreadsheet.', 'gridcraft')
  assertRoute('Do not create a report in WordCraft. Use GridCraft to create a spreadsheet.', 'gridcraft')
  assertRoute('Use GridCraft to create a spreadsheet, but do not use WordCraft.', 'gridcraft')
  assertRoute('Create a spreadsheet without using WordCraft.', 'gridcraft')
  assert.deepEqual(resolveNoriArtCraftRequest('Do not open WordCraft. Open GridCraft.'),
    { name: 'launch_artcraft_app', args: { app_id: 'gridcraft' } })
  assert.equal(noriArtCraftToolMatchesUserIntent('launch_artcraft_app', { app_id: 'wordcraft' },
    'Do not open WordCraft. Open GridCraft.'), false)
})

test('unrelated web and file constraints preserve the positively requested local tool', () => {
  for (const constraint of ['Do not use the web or modify any other files.',
    'Do not delete any files.', 'Never send anything online.', 'Do not create unrelated files.']) {
    assertRoute(`Use VectorCraft to create an SVG with one blue circle. ${constraint}`, 'vectorcraft')
  }
  assertRoute('Do not use the web. Use GridCraft to create a spreadsheet.', 'gridcraft')
})

test('quoted titles, document contents, examples and code cannot select or deny tools', () => {
  for (const data of ['"Use GridCraft to create a spreadsheet"',
    '“Use GridCraft to create a spreadsheet”', "'Use GridCraft to create a spreadsheet'",
    '‘Use GridCraft to create a spreadsheet’', '`Use GridCraft to create a spreadsheet`',
    '```\nUse GridCraft to create a spreadsheet\n```']) {
    assertRoute(`Write a report titled ${data}`, 'wordcraft')
    assertRoute(`Explain this quoted text: ${data}`, null)
    assert.equal(requestsNoriArtCraft(`Explain this quoted text: ${data}`), false)
    assert.equal(resolveNoriArtCraftRequest(`The example says ${data}`), null)
  }
  assertRoute('Write a report containing "Do not use WordCraft. Use GridCraft to create a spreadsheet."', 'wordcraft')
  assertRoute('Write a report.\n> Use GridCraft to create a spreadsheet.', 'wordcraft')
  assertRoute('Explain "Open WordCraft"', null)
})

test('multiple positive apps or conflicting domains fail closed instead of choosing by array order', () => {
  for (const goal of ['Use WordCraft and GridCraft to create a project.',
    'Use GridCraft and WordCraft to create a project.',
    'Create a spreadsheet and a CAD blueprint.', 'Create a CAD blueprint and a spreadsheet.',
    'Open WordCraft and GridCraft.', 'Open GridCraft and WordCraft.']) {
    assertRoute(goal, null)
    assert.equal(resolveNoriArtCraftRequest(goal), null, goal)
  }
})

test('discussion questions remain non-operational and list/launch stay bounded', () => {
  for (const goal of ['How can I use GridCraft to create a spreadsheet?',
    'What if I create a spreadsheet in GridCraft?', 'Tell me about ArtCraft.',
    "Don't open VectorCraft.", 'Should I launch VectorCraft?']) {
    assert.equal(requestsNoriArtCraftOperation(goal), false, goal)
    assert.equal(resolveNoriArtCraftRequest(goal), null, goal)
  }
  assert.deepEqual(resolveNoriArtCraftRequest('Show me all ArtCraft apps.'),
    { name: 'list_artcraft_apps', args: { scope: 'installed' } })
  assert.deepEqual(resolveNoriArtCraftRequest('Open VectorCraft.'),
    { name: 'launch_artcraft_app', args: { app_id: 'vectorcraft' } })
})

test('app capability questions cannot authorize creation or launch', () => {
  for (const goal of ['Can WordCraft create documents?', 'Which ArtCraft apps can create a spreadsheet?',
    'What can WordCraft create?', 'Could GridCraft create a spreadsheet?', 'Does WordCraft let me create documents?',
    'Is WordCraft able to create documents?', 'Can WordCraft open documents?', 'Will GridCraft save a spreadsheet?',
    'Tell me whether WordCraft can create documents.', 'Explain how GridCraft can create a spreadsheet.']) {
    assert.equal(requestsNoriArtCraftOperation(goal), false, goal)
    assert.equal(resolveNoriArtCraftRequest(goal), null, goal)
    for (const [app] of routes) {
      assert.equal(noriArtCraftMcpToolMatchesUserIntent(`artcraft_${app}_example`, goal), false, goal)
      assert.equal(noriArtCraftToolMatchesUserIntent('launch_artcraft_app', { app_id: app }, goal), false, goal)
    }
  }
})

test('questions about every named app stay conversational even when they include an operation verb', () => {
  for (const [app] of routes) {
    for (const goal of [`Can ${app} create something?`, `What can ${app} create?`, `Can ${app} open files?`]) {
      assert.equal(requestsNoriArtCraftOperation(goal), false, goal)
      assert.equal(resolveNoriArtCraftRequest(goal), null, goal)
    }
  }
})

test('indirect actual requests still route, but indirect requests for an explanation do not', () => {
  assertRoute('Can you create a spreadsheet with two columns?', 'gridcraft')
  assertRoute('Could you please create a spreadsheet with two columns?', 'gridcraft')
  assertRoute('Would you write a report in WordCraft?', 'wordcraft')
  assert.deepEqual(resolveNoriArtCraftRequest('Can you open WordCraft?'),
    { name: 'launch_artcraft_app', args: { app_id: 'wordcraft' } })
  assert.deepEqual(resolveNoriArtCraftRequest('Could you show me all ArtCraft apps?'),
    { name: 'list_artcraft_apps', args: { scope: 'installed' } })
  for (const goal of ['Can you tell me whether WordCraft can create documents?',
    'Could you please explain how GridCraft can create a spreadsheet?',
    'Can you show me how to create a spreadsheet in GridCraft?']) {
    assert.equal(requestsNoriArtCraftOperation(goal), false, goal)
    assert.equal(resolveNoriArtCraftRequest(goal), null, goal)
  }
})
