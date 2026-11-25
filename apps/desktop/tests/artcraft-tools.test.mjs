import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createNoriArtCraftTools, requestsNoriArtCraft, resolveNoriArtCraftRequest,
  noriArtCraftToolMatchesUserIntent } from '../bridge/artcraft-tools.mjs'
import { callThroughNeuralese } from '../bridge/neuralese-project-tools.mjs'
import { localChat } from '../bridge/local-chat.mjs'

test('ArtCraft local catalog exposes all 13 installed apps through a verified Neuralese handoff', async () => {
  const tools = createNoriArtCraftTools('C:/Nori')
  assert.equal(tools.definitions.length, 2)
  assert.equal(requestsNoriArtCraft('Please open VectorCraft for me.'), true)
  assert.equal(requestsNoriArtCraft('What is the weather?'), false)
  assert.deepEqual(resolveNoriArtCraftRequest('Show me all ArtCraft apps.'),
    { name: 'list_artcraft_apps', args: { scope: 'installed' } })
  assert.deepEqual(resolveNoriArtCraftRequest('Open VectorCraft.'),
    { name: 'launch_artcraft_app', args: { app_id: 'vectorcraft' } })
  assert.equal(resolveNoriArtCraftRequest('Tell me about ArtCraft.'), null)
  assert.equal(resolveNoriArtCraftRequest("Don't open VectorCraft."), null)
  assert.equal(resolveNoriArtCraftRequest('Should I launch VectorCraft?'), null)
  assert.equal(noriArtCraftToolMatchesUserIntent('launch_artcraft_app', { app_id: 'vectorcraft' }, 'Open VectorCraft.'), true)
  assert.equal(noriArtCraftToolMatchesUserIntent('launch_artcraft_app', { app_id: 'photocraft' }, 'Open VectorCraft.'), false)
  assert.equal(noriArtCraftToolMatchesUserIntent('launch_artcraft_app', { app_id: 'vectorcraft' }, "Don't open VectorCraft."), false)
  const reply = await callThroughNeuralese(tools, 'list_artcraft_apps', { scope: 'installed' },
    { maxBytes: 8192 }, 'artcraft-list-01', 'Show the ArtCraft apps installed for Nori.')
  const inventory = JSON.parse(reply)
  assert.equal(inventory.apps.split(',').length, 13)
  assert.equal(inventory.access, 'installed; local GUI launch only')
})

test('NorLlama deterministic ArtCraft routing needs no model substitution and preserves proof limits', async t => {
  const names = ['NORI_INFERENCE_RUNTIME', 'NORI_RUNTIME_MODEL_STATE', 'NORI_ROOT', 'NORI_APP_DATA_ROOT']
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]))
  process.env.NORI_INFERENCE_RUNTIME = 'norllama'
  process.env.NORI_RUNTIME_MODEL_STATE = 'unavailable'
  process.env.NORI_ROOT = 'C:/Nori'
  process.env.NORI_APP_DATA_ROOT = 'C:/Nori'
  t.after(() => {
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  })
  let response = ''
  for await (const part of localChat({ goal: 'Show me all ArtCraft apps installed locally.', turns: [] })) response += part
  assert.match(response, /photocraft/)
  assert.match(response, /gridcraft/)
  assert.match(response, /app-specific MCP tool broker/)
  assert.match(response, /does not verify a creative workflow/)
  assert.doesNotMatch(response, /not enabled yet/)
})

test('ArtCraft launch dispatcher rejects unlisted IDs without starting a process', async () => {
  const tools = createNoriArtCraftTools('C:/Nori')
  const reply = await callThroughNeuralese(tools, 'launch_artcraft_app', { app_id: 'powershell' },
    { maxBytes: 8192 }, 'artcraft-invalid-01', 'Open the unlisted app.')
  const decoded = JSON.parse(reply)
  assert.equal(decoded.executed, false)
  assert.match(decoded.error, /installed ArtCraft inventory/)
})

test('ArtCraft launch starts only the selected verified local executable', async () => {
  let launched
  const tools = createNoriArtCraftTools('C:/Nori', { launchProcess: (executable, args, options) => {
    launched = { executable, args, options }
    const child = new EventEmitter()
    child.unref = () => {}
    queueMicrotask(() => child.emit('spawn'))
    return child
  } })
  const reply = await callThroughNeuralese(tools, 'launch_artcraft_app', { app_id: 'vectorcraft' },
    { maxBytes: 8192 }, 'artcraft-launch-01', 'Open VectorCraft for me.')
  const decoded = JSON.parse(reply)
  assert.equal(decoded.launched, true, JSON.stringify(decoded))
  assert.equal(decoded.app_id, 'vectorcraft')
  assert.equal(decoded.status, 'process_started')
  assert.match(launched.executable.toLowerCase(), /\\integrations\\artcraft\\apps\\vectorcraft\\.*vectorcraft\.exe$/)
  assert.deepEqual(launched.args, [])
  assert.equal(launched.options.shell, false)
})
