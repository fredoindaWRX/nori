import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  createNoriAppProposalTools, requestsNoriLocalAppBuild, callNeuraleseAppProposal,
} from '../bridge/neuralese-app-tools.mjs'

const goal = 'Build a local notes app with a title and pinned flag.'
const proposal = {
  spec_id: 'local-notes', title: 'Local Notes', description: 'A local notes app.',
  source: { goal_cell: goal },
  data_schema: [{ id: 'note', name: 'Note', fields: [
    { id: 'title', name: 'Title', type: 'string', required: true, options: null, default: null },
    { id: 'pinned', name: 'Pinned', type: 'boolean', required: false, options: null, default: false },
  ] }],
  views: [{ id: 'notes', name: 'Notes', type: 'table', collection_id: 'note', fields: ['title', 'pinned'] }],
  workflows: [], capabilities: ['local_data.read'], unknown_fields: [], translation_losses: [],
}

test('app-builder intent is narrow and does not trigger on discussion alone', () => {
  assert.equal(requestsNoriLocalAppBuild(goal), true)
  assert.equal(requestsNoriLocalAppBuild('Use REA to create me a new Nori app based on "C:\\Apps\\Discord.exe".'), true)
  assert.equal(requestsNoriLocalAppBuild('Is Taskade Genesis integrated into Nori?'), false)
  assert.equal(requestsNoriLocalAppBuild('Compare three app builders.'), false)
})

test('local app proposal tool returns a verified Neuralese draft without materializing it', async () => {
  const tools = createNoriAppProposalTools(goal)
  const callId = `call_${randomUUID()}`
  const result = await callNeuraleseAppProposal(tools, 'propose_local_app',
    { spec_json: JSON.stringify(proposal) }, { maxBytes: 8192 }, callId, goal)
  const decoded = JSON.parse(result)
  assert.equal(decoded.status, 'ready_for_local_preview')
  assert.equal(decoded.execution_authorized, false)
  assert.equal(decoded.materialized, false)
  assert.match(decoded.receipt.frame_sha256, /^[a-f0-9]{64}$/)
  assert.match(decoded.note, /Proposal only; no app\/code\/actions executed/)
})

test('app proposal rejects goal substitution, unknown actions, and malformed JSON', async () => {
  const tools = createNoriAppProposalTools(goal)
  await assert.rejects(() => tools.call('propose_local_app', { spec_json: JSON.stringify({
    ...proposal, source: { goal_cell: 'a different request' },
  }) }), /not bound to the active user request/)
  await assert.rejects(() => tools.call('write_file', { spec_json: '{}' }), /Invalid local app proposal/)
  await assert.rejects(() => tools.call('propose_local_app', { spec_json: '{' }), SyntaxError)
  await assert.rejects(() => tools.call('propose_local_app', { spec_json: JSON.stringify({
    ...proposal, capabilities: ['shell.execute'],
  }) }), /Unsupported Nori app capability/)
})

test('tool is explicitly non-executing and has a closed argument schema', () => {
  const tools = createNoriAppProposalTools(goal)
  assert.deepEqual(tools.definitions.map(tool => tool.function.name), ['propose_local_app'])
  assert.equal(tools.definitions[0].function.parameters.additionalProperties, false)
  assert.match(tools.definitions[0].function.description, /pending JSON draft/)
  assert.match(tools.definitions[0].function.description, /never writes or executes generated code/)
})

test('validated specs persist only as isolated pending JSON drafts inside the Nori root', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nori-local-app-store-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const tools = createNoriAppProposalTools(goal, { noriRoot: root })
  const args = { spec_json: JSON.stringify(proposal) }
  const first = JSON.parse(await tools.call('propose_local_app', args))
  const second = JSON.parse(await tools.call('propose_local_app', args))
  assert.equal(first.draft_id, second.draft_id)
  const fullPath = resolve(root, 'workspace', 'generated-apps', 'drafts', `draft-${first.draft_id}.json`)
  assert.ok(fullPath.startsWith(`${resolve(root)}${process.platform === 'win32' ? '\\' : '/'}`))
  const record = JSON.parse(readFileSync(fullPath, 'utf8'))
  assert.equal(record.schema, 'nori.local-app-draft.v1')
  assert.equal(record.status, 'pending_review')
  assert.equal(record.execution_authorized, false)
  assert.equal(record.external_effects, false)
  assert.equal(record.frame.source.goal_cell, goal)
})
