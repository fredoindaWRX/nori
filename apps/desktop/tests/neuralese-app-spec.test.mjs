import test from 'node:test'
import assert from 'node:assert/strict'
import {
  encodeNeuraleseAppSpec, verifyNeuraleseAppSpec,
  NEURALESE_APP_SPEC_OPCODE, NEURALESE_APP_SPEC_SCHEMA,
} from '../bridge/neuralese-app-spec.mjs'

function proposal(overrides = {}) {
  return {
    spec_id: 'local-notes',
    title: 'Local Notes',
    description: 'A private, local notes app.',
    source: { goal_cell: 'Build a local notes app for me.' },
    data_schema: [{ id: 'note', name: 'Note', fields: [
      { id: 'title', name: 'Title', type: 'string', required: true, options: null, default: null },
      { id: 'pinned', name: 'Pinned', type: 'boolean', required: false, options: null, default: false },
      { id: 'category', name: 'Category', type: 'enum', required: false, options: ['personal', 'work'], default: 'personal' },
    ] }],
    views: [{ id: 'notes', name: 'Notes', type: 'table', collection_id: 'note', fields: ['title', 'pinned', 'category'] }],
    workflows: [{ id: 'save-note', name: 'Save a note', trigger: 'manual', collection_id: 'note', steps: [
      { id: 'create', action: 'local_data.create', depends_on: [] },
      { id: 'ask-nori', action: 'nori.assistant.query', depends_on: ['create'] },
    ] }],
    capabilities: ['local_data.create', 'nori.assistant.query'],
    unknown_fields: [],
    translation_losses: [{ source_pointer: '/request/title', target_pointer: '/title', status: 'exact', reason: 'Mapped without changing meaning.' }],
    ...overrides,
  }
}

test('Neuralese app spec preserves typed app structure and stays preview-only', () => {
  const frame = encodeNeuraleseAppSpec(proposal())
  assert.equal(frame.schema, NEURALESE_APP_SPEC_SCHEMA)
  assert.equal(frame.opcode, NEURALESE_APP_SPEC_OPCODE)
  assert.equal(frame.source.goal_cell, 'Build a local notes app for me.')
  assert.equal(frame.data_schema[0].fields[2].default, 'personal')
  assert.equal(frame.workflows[0].steps[1].depends_on[0], 'create')
  assert.deepEqual(frame.trust_flags, { source_untrusted: true, model_output_untrusted: true, external_effects: false })
  assert.equal(frame.execution_authorized, false)
  assert.deepEqual(verifyNeuraleseAppSpec(frame, { expectedGoal: 'Build a local notes app for me.' }), {
    schema: 'nori.neuralese.app-spec-validation.v1', spec_id: 'local-notes', frame_sha256: frame.frame_sha256,
    status: 'ready_for_local_preview', findings: [], execution_authorized: false, external_effects: false, materialized: false,
  })
})

test('unsupported source concepts are retained and make the proposal incomplete, not silently green', () => {
  const frame = encodeNeuraleseAppSpec(proposal({
    unknown_fields: ['/request/voice-cloning'],
    translation_losses: [{ source_pointer: '/request/voice-cloning', target_pointer: null, status: 'unmapped', reason: 'No local voice-cloning action was mapped.' }],
  }))
  const report = verifyNeuraleseAppSpec(frame)
  assert.equal(report.status, 'incomplete')
  assert.deepEqual(report.findings, [{ code: 'unmapped_source_field', pointer: '/request/voice-cloning', severity: 'incomplete' }])
  assert.equal(report.execution_authorized, false)
})

test('Neuralese app frame hashes canonical content and rejects tampering', () => {
  const frame = encodeNeuraleseAppSpec(proposal())
  const reordered = { ...proposal(), capabilities: undefined }
  delete reordered.capabilities
  // The encoder rejects unrecognized or missing fields rather than repairing them.
  assert.throws(() => encodeNeuraleseAppSpec(reordered), /missing or unmapped/)
  const tampered = structuredClone(frame)
  tampered.title = 'Remote Notes'
  assert.throws(() => verifyNeuraleseAppSpec(tampered), /integrity check/)
  assert.throws(() => verifyNeuraleseAppSpec(frame, { expectedGoal: 'A different request.' }), /active user request/)
})

test('unmapped fields, unsupported capabilities and injected host actions are rejected', () => {
  assert.throws(() => encodeNeuraleseAppSpec({ ...proposal(), external_url: 'https://example.test' }), /unmapped fields/)
  assert.throws(() => encodeNeuraleseAppSpec(proposal({ capabilities: ['shell.execute'] })), /Unsupported Nori app capability/)
  assert.throws(() => encodeNeuraleseAppSpec(proposal({ capabilities: ['local_data.create', 'network.send'] })), /Unsupported Nori app capability/)
  assert.throws(() => encodeNeuraleseAppSpec(proposal({
    workflows: [{ id: 'escape', name: 'Install dependencies', trigger: 'manual', collection_id: 'note',
      steps: [{ id: 'install', action: 'shell.execute', depends_on: [] }] }],
  })), /Unsupported workflow action/)
})

test('data defaults, field references, duplicate identifiers, and workflow edges are checked deterministically', () => {
  assert.throws(() => encodeNeuraleseAppSpec(proposal({ data_schema: [{ id: 'note', name: 'Note', fields: [
    { id: 'count', name: 'Count', type: 'integer', required: false, options: null, default: 'many' },
  ] }] })), /Default value does not match/)
  assert.throws(() => encodeNeuraleseAppSpec(proposal({ views: [{ id: 'notes', name: 'Notes', type: 'table', collection_id: 'note', fields: ['missing'] }] })), /missing field/)
  assert.throws(() => encodeNeuraleseAppSpec(proposal({ workflows: [{ id: 'save-note', name: 'Save a note', trigger: 'manual', collection_id: 'note', steps: [
    { id: 'first', action: 'local_data.create', depends_on: ['later'] },
    { id: 'later', action: 'nori.assistant.query', depends_on: [] },
  ] }] })), /missing, forward, or reversed dependency/)
})

test('unauthorized external effect or authority flags can never be encoded', () => {
  const frame = encodeNeuraleseAppSpec(proposal())
  frame.execution_authorized = true
  assert.throws(() => verifyNeuraleseAppSpec(frame), /integrity check/)
  assert.throws(() => encodeNeuraleseAppSpec(proposal({ trust_flags: { external_effects: true } })), /unmapped fields/)
})
