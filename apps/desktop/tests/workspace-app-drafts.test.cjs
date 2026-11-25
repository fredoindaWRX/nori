const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { createWorkspaceAppDrafts } = require('../desktop/workspace-app-drafts.cjs')

const goal = 'Build a local notes app.'
const proposal = {
  spec_id: 'local-notes', title: 'Local Notes', description: 'Private notes.',
  source: { goal_cell: goal }, data_schema: [], views: [], workflows: [], capabilities: [],
  unknown_fields: [], translation_losses: [],
}

async function makeFixture(appProposal = proposal) {
  const root = mkdtempSync(join(tmpdir(), 'nori-app-drafts-'))
  mkdirSync(join(root, 'workspace', 'generated-apps', 'drafts'), { recursive: true })
  const spec = await import('../bridge/neuralese-app-spec.mjs')
  const frame = spec.encodeNeuraleseAppSpec(appProposal)
  const validation = spec.verifyNeuraleseAppSpec(frame, { expectedGoal: goal })
  const id = frame.frame_sha256
  writeFileSync(join(root, 'workspace', 'generated-apps', 'drafts', `draft-${id}.json`), JSON.stringify({
    schema: 'nori.local-app-draft.v1', status: 'pending_review', frame, validation,
    created_at: new Date().toISOString(), execution_authorized: false, external_effects: false,
  }))
  const service = createWorkspaceAppDrafts({ root, owns: event => event === 'owner',
    loadVerifier: () => import('../bridge/neuralese-app-spec.mjs') })
  return { root, id, service }
}

test('app draft service lists and verifies local pending specs for its owning renderer', async t => {
  const fixture = await makeFixture()
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }))
  assert.equal(await fixture.service.list('other'), null)
  const listing = await fixture.service.list('owner')
  assert.equal(listing.root, 'workspace/generated-apps')
  assert.equal(listing.entries.length, 1)
  assert.equal(listing.entries[0].id, fixture.id)
  const draft = await fixture.service.read('owner', { id: fixture.id })
  assert.equal(draft.frame.title, 'Local Notes')
  assert.equal(draft.validation.status, 'ready_for_local_preview')
  assert.equal(draft.execution_authorized, false)
  assert.equal(draft.external_effects, false)
})

test('app draft service rejects traversal and hides tampered records', async t => {
  const fixture = await makeFixture()
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }))
  await assert.rejects(() => fixture.service.read('owner', { id: '../outside' }), /valid Neuralese app draft identifier/)
  const path = join(fixture.root, 'workspace', 'generated-apps', 'drafts', `draft-${fixture.id}.json`)
  const record = JSON.parse(require('node:fs').readFileSync(path, 'utf8'))
  record.frame.title = 'Tampered title'
  writeFileSync(path, JSON.stringify(record))
  const listing = await fixture.service.list('owner')
  assert.equal(listing.entries.length, 0)
  assert.equal(await fixture.service.read('owner', { id: fixture.id }), null)
})

test('app draft service treats an absent drafts folder as an empty local catalog', async t => {
  const root = mkdtempSync(join(tmpdir(), 'nori-app-drafts-empty-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const service = createWorkspaceAppDrafts({ root, owns: event => event === 'owner',
    loadVerifier: () => import('../bridge/neuralese-app-spec.mjs') })
  assert.deepEqual(await service.list('owner'), { root: 'workspace/generated-apps', entries: [], apps: [], truncated: false })
})

test('approved app opens as an active typed spec and its declared local CRUD stays inside Nori storage', async t => {
  const fixture = await makeFixture({
    spec_id: 'local-tasks', title: 'Local Tasks', description: 'A private task list.',
    source: { goal_cell: goal },
    data_schema: [{ id: 'tasks', name: 'Tasks', fields: [
      { id: 'title', name: 'Title', type: 'string', required: true, options: null, default: null },
      { id: 'done', name: 'Done', type: 'boolean', required: true, options: null, default: false },
    ] }],
    views: [{ id: 'tasks_table', name: 'Tasks', type: 'table', collection_id: 'tasks', fields: ['title', 'done'] }],
    workflows: [],
    capabilities: ['local_data.read', 'local_data.create', 'local_data.update', 'local_data.delete'],
    unknown_fields: [], translation_losses: [],
  })
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }))
  await assert.rejects(() => fixture.service.activate('owner', { id: fixture.id, approved: false }), /Explicit approval/)
  const approved = await fixture.service.activate('owner', { id: fixture.id, approved: true })
  assert.equal(approved.status, 'ACTIVE LOCAL APP')
  const opened = await fixture.service.readApp('owner', { id: fixture.id })
  assert.equal(opened.frame.title, 'Local Tasks')
  const created = await fixture.service.createRecord('owner', { app_id: fixture.id, collection_id: 'tasks', values: { title: 'Ship Nori', done: false } })
  assert.equal(created.values.title, 'Ship Nori')
  const updated = await fixture.service.updateRecord('owner', { app_id: fixture.id, collection_id: 'tasks', record_id: created.id, values: { title: 'Ship Nori', done: true } })
  assert.equal(updated.values.done, true)
  assert.equal((await fixture.service.records('owner', { app_id: fixture.id, collection_id: 'tasks' })).records.length, 1)
  const deleted = await fixture.service.deleteRecord('owner', { app_id: fixture.id, collection_id: 'tasks', record_id: created.id })
  assert.equal(deleted.deleted, true)
  assert.equal((await fixture.service.records('owner', { app_id: fixture.id, collection_id: 'tasks' })).records.length, 0)
  const listing = await fixture.service.list('owner')
  assert.equal(listing.apps.length, 1)
  assert.equal(listing.entries.length, 0)
  assert.equal(listing.apps[0].id, fixture.id)
})

test('app data capability gates reject undeclared reads and writes', async t => {
  const fixture = await makeFixture({
    spec_id: 'local-write-only', title: 'Write Only', description: 'No read access.', source: { goal_cell: goal },
    data_schema: [{ id: 'items', name: 'Items', fields: [{ id: 'name', name: 'Name', type: 'string', required: true, options: null, default: null }] }],
    views: [{ id: 'items_form', name: 'Items', type: 'form', collection_id: 'items', fields: ['name'] }],
    workflows: [], capabilities: ['local_data.create'], unknown_fields: [], translation_losses: [],
  })
  t.after(() => rmSync(fixture.root, { recursive: true, force: true }))
  await fixture.service.activate('owner', { id: fixture.id, approved: true })
  await assert.rejects(() => fixture.service.records('owner', { app_id: fixture.id, collection_id: 'items' }), /has not declared local_data.read/)
  await assert.rejects(() => fixture.service.createRecord('owner', { app_id: fixture.id, collection_id: 'items', values: { name: 'x', injected: 'no' } }), /undeclared field/)
})
