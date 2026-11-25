import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { callThroughNeuralese, encodeNeuraleseToolError, encodeProjectToolProposal, requestedProjectPath } from '../bridge/neuralese-project-tools.mjs'

const definitions = [{
  type: 'function',
  function: {
    name: 'read_file',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' }, start_line: { type: 'integer' }, max_lines: { type: 'integer' } },
      required: ['path'],
    },
  },
}]
const directoryDefinitions = [{
  type: 'function',
  function: {
    name: 'list_dir',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
    },
  },
}]
const skillCatalogDefinitions = [{
  type: 'function',
  function: {
    name: 'list_skill_catalog',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', enum: ['skills'] } },
      required: ['path'],
    },
  },
}]
const zeroArgumentDefinitions = [{
  type: 'function',
  function: {
    name: 'inspect_document',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
}]
const optionalArgumentDefinitions = [{
  type: 'function',
  function: {
    name: 'optional_probe',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { required_value: { type: 'string' }, optional_value: { type: 'integer' } },
      required: ['required_value'],
    },
  },
}]
const saveEditedCopyDefinitions = [{
  type: 'function',
  function: {
    name: 'save_edited_copy',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { filename: { type: 'string' }, content: { type: 'string' } },
      required: ['filename', 'content'],
    },
  },
}]

test('Neuralese accepts valid zero-argument tools without widening their contract', async () => {
  let dispatched = 0
  const tools = {
    definitions: zeroArgumentDefinitions,
    async call(action, args) {
      dispatched++
      assert.equal(action, 'inspect_document')
      assert.deepEqual(args, {})
      return JSON.stringify({ inspected: true })
    },
  }
  const result = await callThroughNeuralese(tools, 'inspect_document', {}, {}, 'call_zero_args')
  assert.deepEqual(JSON.parse(result), { inspected: true })
  assert.equal(dispatched, 1)
  await assert.rejects(() => callThroughNeuralese(tools, 'inspect_document', { override: true }, {}, 'call_zero_args_bad'),
    /fields differ from the registered contract/)
})

test('Neuralese losslessly preserves omitted optional arguments but still enforces required and allowed fields', async () => {
  const calls = []
  const tools = {
    definitions: optionalArgumentDefinitions,
    async call(action, args) {
      calls.push({ action, args })
      return JSON.stringify({ received: args })
    },
  }
  const result = await callThroughNeuralese(tools, 'optional_probe', { required_value: 'kept' }, {}, 'call_optional_1')
  assert.deepEqual(JSON.parse(result), { received: { required_value: 'kept' } })
  assert.deepEqual(calls, [{ action: 'optional_probe', args: { required_value: 'kept' } }])
  await assert.rejects(() => callThroughNeuralese(tools, 'optional_probe', {}, {}, 'call_optional_missing'),
    /fields differ from the registered contract/)
  await assert.rejects(() => callThroughNeuralese(tools, 'optional_probe', {
    required_value: 'kept', surprise: true,
  }, {}, 'call_optional_extra'), /fields differ from the registered contract/)
  assert.equal(calls.length, 1)
})

test('Neuralese carries attached-file edit payload and does not confuse output filename with a project path', async () => {
  let dispatched = 0
  const tools = {
    definitions: saveEditedCopyDefinitions,
    async call(action, args, options) {
      dispatched++
      assert.equal(action, 'save_edited_copy')
      assert.deepEqual(args, { filename: 'notes-edited.txt', content: 'Edited text.' })
      assert.deepEqual(options, { maxBytes: 1024 })
      return JSON.stringify({ saved: true, path: 'user-edits/notes-edited.txt', original_overwritten: false })
    },
  }
  const intent = 'Edit the attached notes under documents/source.'
  const result = await callThroughNeuralese(tools, 'save_edited_copy', {
    filename: 'notes-edited.txt', content: 'Edited text.',
  }, { maxBytes: 1024 }, 'call_attachment_edit', intent)
  assert.deepEqual(JSON.parse(result), { saved: true, path: 'user-edits/notes-edited.txt', original_overwritten: false })
  assert.equal(dispatched, 1)
})

test('Neuralese wraps GPT-OSS project calls and untrusted results losslessly without granting authority', async () => {
  let dispatched
  const tools = {
    definitions,
    async call(action, args, options) {
      dispatched = { action, args, options }
      return JSON.stringify({ path: args.path, content: 'fixture', omitted: false })
    },
  }

  const result = await callThroughNeuralese(tools, 'read_file', { path: 'README.md' }, { maxBytes: 1024 }, 'call_fixture_1')

  assert.deepEqual(dispatched, {
    action: 'read_file',
    args: { path: 'README.md', start_line: 1, max_lines: 60 },
    options: { maxBytes: 1024 },
  })
  assert.deepEqual(JSON.parse(result), { path: 'README.md', content: 'fixture', omitted: false })
})

test('Neuralese rejects malformed or unregistered calls before dispatch', async () => {
  let dispatches = 0
  const tools = { definitions, async call() { dispatches++; return '{}' } }

  await assert.rejects(() => callThroughNeuralese(tools, 'read_file', { path: 'README.md', override: true }, {}, 'call_fixture_2'),
    /fields differ from the registered contract/)
  await assert.rejects(() => callThroughNeuralese(tools, 'read_file', { path: '\ud800' }, {}, 'call_fixture_unicode'),
    /valid Unicode/)
  await assert.rejects(() => callThroughNeuralese(tools, 'write_file', { path: 'x' }, {}, 'call_fixture_3'),
    /not in the active registry/)
  await assert.rejects(() => callThroughNeuralese(tools, 'read_file', { path: 'x' }, {}, 'unbounded id!'),
    /bounded model tool-call identity/)
  assert.equal(dispatches, 0)
})

test('Neuralese task proposal uses the canonical bounded Python task-frame schema', () => {
  const proposal = encodeProjectToolProposal(definitions, 'read_file', { path: 'README.md' }, 'call_fixture_schema')
  assert.deepEqual(Object.keys(proposal.frame).sort(), [
    'contract_sha256', 'execution_authorized', 'frame_sha256', 'intent_sha256',
    'nodes', 'proposal_sha256', 'registry_sha256', 'requested_path', 'schema',
  ])
  assert.equal(proposal.frame.schema, 'nori.neuralese.task-plan.v2')
  assert.equal(proposal.frame.execution_authorized, false)
  assert.equal(proposal.frame.nodes[0][1], createHash('sha256').update('read_file').digest().readUInt32BE(0))
  assert.deepEqual(proposal.call, { action: 'read_file', path: 'README.md', start_line: 1, max_lines: 60 })
})

test('Neuralese binds an explicit requested folder and blocks a model path mismatch before dispatch', async () => {
  const intent = 'List the skill-related folders under skills/ and read no files.'
  assert.equal(requestedProjectPath(intent), 'skills')
  let dispatches = 0
  const tools = {
    definitions: directoryDefinitions,
    async call(action, args) {
      dispatches++
      return JSON.stringify({ path: args.path, entries: ['incoming', 'quarantine'] })
    },
  }

  const blocked = JSON.parse(await callThroughNeuralese(tools, 'list_dir', { path: '.' }, {}, 'call_fixture_scope_bad', intent))
  assert.equal(blocked.executed, false)
  assert.match(blocked.error, /requested project scope is skills/i)
  assert.equal(dispatches, 0)

  const result = JSON.parse(await callThroughNeuralese(tools, 'list_dir', { path: 'skills' }, {}, 'call_fixture_scope_good', intent))
  assert.deepEqual(result, { path: 'skills', entries: ['incoming', 'quarantine'] })
  assert.equal(dispatches, 1)
})

test('Neuralese passes the exact skills catalog scope and blocks a substituted path', async () => {
  const intent = 'List the skill-related folders under skills/ and read no files.'
  let dispatches = 0
  const tools = {
    definitions: skillCatalogDefinitions,
    async call(action, args) {
      dispatches++
      return JSON.stringify({ root: args.path, entries: [], truncated: false })
    },
  }
  const blocked = JSON.parse(await callThroughNeuralese(tools, 'list_skill_catalog', { path: '.' }, {}, 'call_skill_scope_bad', intent))
  assert.equal(blocked.executed, false)
  assert.match(blocked.error, /requested project scope is skills/i)
  assert.equal(dispatches, 0)
  const result = JSON.parse(await callThroughNeuralese(tools, 'list_skill_catalog', { path: 'skills' }, {}, 'call_skill_scope_good', intent))
  assert.deepEqual(result, { root: 'skills', entries: [], truncated: false })
  assert.equal(dispatches, 1)
})

test('Neuralese preserves denied reads as untrusted structured results', async () => {
  const tools = {
    definitions,
    async call() { return JSON.stringify({ executed: false, error: 'That path is not available.' }) },
  }
  const result = await callThroughNeuralese(tools, 'read_file', { path: '.env' }, {}, 'call_fixture_4')
  assert.deepEqual(JSON.parse(result), { executed: false, error: 'That path is not available.' })
})

test('Neuralese frames host denial and protocol errors before translating to the legacy tool result', async () => {
  const tools = {
    definitions,
    async call() { throw new Error('The requested path is outside the Nori project.') },
  }
  const result = await callThroughNeuralese(tools, 'read_file', { path: '../outside' }, {}, 'call_fixture_denied')
  assert.deepEqual(JSON.parse(result), {
    executed: false,
    error: 'The requested path is outside the Nori project.',
  })
  assert.deepEqual(JSON.parse(encodeNeuraleseToolError('call_fixture_unknown', 'tool_boundary_rejected', 'Unknown action.')),
    { executed: false, error: 'Unknown action.' })
  assert.throws(() => encodeNeuraleseToolError('call_fixture_unknown', 'invented_code', 'No.'), /correlation or code/)
})
