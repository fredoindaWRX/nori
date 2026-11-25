import test from 'node:test'
import assert from 'node:assert/strict'
import { createAgentTools, createRoutedAgentTools } from '../bridge/agent-tools.mjs'

test('routed catalog offers selected specialist and direct conversation skips construction', async () => {
  let creations = 0
  const factories = { documents: () => { creations++; return { definitions: [], call() {} } } }
  const direct = await createRoutedAgentTools({ intentGoal: 'hello' }, factories, async () => null)
  assert.equal(direct, null); assert.equal(creations, 0)
  const tools = await createRoutedAgentTools({ intentGoal: 'make a file' }, factories, async () => 'documents')
  assert.ok(tools.specialist('documents')); assert.equal(creations, 1)
  await tools.close()
})

test('routed follow-up retains tools despite a conversational selection', async () => {
  const tools = await createRoutedAgentTools({ intentGoal: 'open the second file',
    turns: [{ role: 'assistant', text: 'Found first.txt and second.txt' }] }, {}, async () => null)
  assert.ok(tools.definitions.some(x => x.function.name === 'read_my_file'))
  await tools.close()
})

test('cancellation during selection prevents catalog construction', async () => {
  const controller = new AbortController()
  await assert.rejects(createRoutedAgentTools({ intentGoal: 'task', signal: controller.signal },
    { research: () => assert.fail('late construction') }, async () => { controller.abort(); return 'base' }), { name: 'AbortError' })
})

test('host-selected intent is reused without a second model classification', async () => {
  const choose = () => assert.fail('duplicate model classification')
  assert.equal(await createRoutedAgentTools({ intentGoal: 'hello', toolIntent: null }, {}, choose), null)
  const tools = await createRoutedAgentTools({ intentGoal: 'task', toolIntent: 'documents' }, {
    documents: () => ({ definitions: [], call() {} }),
  }, choose)
  assert.ok(tools.specialist('documents'))
  await tools.close()
})

test('real base adapters assemble without executing file, web or command tools', async () => {
  const tools = createAgentTools({ intentGoal: 'Which tools can help?', toolIntent: 'base' })
  const names = tools.definitions.map(x => x.function.name)
  for (const name of ['search_public_web', 'search_my_files', 'read_my_file', 'check_pc']) assert.ok(names.includes(name), name)
  assert.equal(tools.family('system'), null)
  assert.equal(tools.family('browser'), null)
  assert.equal(tools.family('documents'), null)
  await tools.close()
})

test('missing project root omits project tools without suppressing the other adapters', async () => {
  const tools = createAgentTools({ intentGoal: 'review project', toolIntent: 'project' }, {
    paths() { throw Error('fixture missing root') },
  })
  assert.equal(tools.family('project'), null)
  assert.ok(tools.definitions.some(x => x.function.name === 'check_pc'))
  await tools.close()
})

test('specialist selection delegates calls and preserves browser signal', async () => {
  const controller = new AbortController()
  let browserOptions, systemCalls = 0
  const stub = name => ({ definitions: [{ type: 'function', function: { name, parameters: { type: 'object' } } }],
    call() { throw Error('task approval required') } })
  const tools = createAgentTools({ intentGoal: 'perform a task', toolIntent: 'agent', browserTask: true, signal: controller.signal }, {
    browser(options) { browserOptions = options; return stub('browser_action') },
    system() { const tool = stub('system_action'); tool.call = () => { systemCalls++; throw Error('task approval required') }; return tool },
    documents: () => stub('create_document'),
  })
  assert.equal(browserOptions.signal, controller.signal)
  assert.equal(browserOptions.allowStartRequest, true)
  assert.equal(tools.ownerOf('system_action'), 'system')
  await assert.rejects(tools.call('system_action', {}), /task approval required/)
  assert.equal(systemCalls, 1)
  await tools.close()
})

test('pre-canceled catalog construction never creates adapters', () => {
  const controller = new AbortController(); controller.abort()
  assert.throws(() => createAgentTools({ signal: controller.signal }, { research: () => assert.fail('unexpected adapter') }), { name: 'AbortError' })
})
