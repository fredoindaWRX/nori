const test = require('node:test'), assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, writeFileSync } = require('node:fs'), { tmpdir } = require('node:os'), { join } = require('node:path')
const { createCodingGrants } = require('../desktop/coding-grants.cjs')
const { createCodingSession } = require('../desktop/coding-session.cjs')

const newFile = () => join(mkdtempSync(join(tmpdir(), 'nori-grants-')), 'settings', 'coding-grants.json')

test('the store keeps only approved project paths, case-insensitively, and survives a bad file', () => {
  const file = newFile(), store = createCodingGrants({ file })
  assert.equal(store.has('C:\\Work\\App'), false)
  assert.equal(store.add('C:\\Work\\App'), true)
  assert.equal(store.has('c:\\work\\app'), true)
  assert.equal(store.add('C:\\Work\\App'), true)
  assert.deepEqual(createCodingGrants({ file }).list(), ['C:\\Work\\App'])
  assert.equal(store.remove('C:\\WORK\\APP'), true)
  assert.equal(store.has('C:\\Work\\App'), false)
  writeFileSync(file, 'not json')
  assert.deepEqual(store.list(), [])
  assert.equal(store.add(''), false)
})

function session({ store, asks, project = 'C:\\Work\\App', clock = () => 1000 } = {}) {
  const core = { environment: { NORI_COUNCIL_URL: 'http://127.0.0.1:9107/', NORI_API_TOKEN: 't' }, workerApprovalKey: 'a'.repeat(64) }
  const fetcher = async () => new Response(JSON.stringify({ enabled: true, per_task_confirmation_required: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  const state = { project, answer: true }
  const s = createCodingSession({ owns: () => true, getCore: () => core, getProject: () => state.project, rememberStore: store,
    ask: async policy => { asks.push(policy); return state.answer }, fetcher, clock, verifyWorkspace: async p => p, classifyGoal: async () => true })
  return { s, state }
}

test('consent is asked once per project, then remembered across sessions with no expiry', async () => {
  const file = newFile(), asks = []
  const first = session({ store: createCodingGrants({ file }), asks })
  assert.equal((await first.s.registerTurn({}, { rawGoal: 'fix the bug', clientTurnId: 'a' })).reason, 'session_consent_required')
  assert.equal(asks.length, 0, 'an unapproved project never grants itself')
  const granted = await first.s.grant({})
  assert.equal(granted.enabled, true); assert.equal(granted.remembered, true); assert.equal(granted.expiresAt, null)
  assert.equal(asks.length, 1)
  assert.match(asks[0].policy, /remembered for this project until you stop allowing it/)
  assert.equal((await first.s.registerTurn({}, { rawGoal: 'fix the bug', clientTurnId: 'b' })).registered, true)
  // A new app session (fresh in-memory state) on the same project: no dialog, the request registers straight away.
  const later = session({ store: createCodingGrants({ file }), asks, clock: () => 10 ** 12 })
  const again = await later.s.registerTurn({}, { rawGoal: 'add a test', clientTurnId: 'c' })
  assert.equal(again.registered, true); assert.equal(asks.length, 1)
  // Another project is not covered by that approval.
  const other = session({ store: createCodingGrants({ file }), asks, project: 'C:\\Work\\Other' })
  assert.equal((await other.s.registerTurn({}, { rawGoal: 'fix it', clientTurnId: 'd' })).reason, 'session_consent_required')
  assert.equal(asks.length, 1)
})

test('a declined dialog remembers nothing; "stop allowing" forgets the project; a plain revoke does not', async () => {
  const file = newFile(), asks = [], store = createCodingGrants({ file })
  const a = session({ store, asks }); a.state.answer = false
  assert.equal((await a.s.grant({})).enabled, false)
  assert.deepEqual(store.list(), [])
  a.state.answer = true
  await a.s.grant({})
  assert.deepEqual(store.list(), ['C:\\Work\\App'])
  await a.s.revoke({})                      // chat Stop / new conversation: session ends, project stays allowed
  assert.equal(store.has('C:\\Work\\App'), true)
  assert.equal((await a.s.registerTurn({}, { rawGoal: 'go', clientTurnId: 'e' })).registered, true)
  assert.equal(asks.length, 2)
  await a.s.revoke({}, { forget: true })    // "Stop allowing this project"
  assert.equal(store.has('C:\\Work\\App'), false)
  assert.equal((await a.s.registerTurn({}, { rawGoal: 'go', clientTurnId: 'f' })).reason, 'session_consent_required')
})

test('without a store the earlier 30-minute session rule is unchanged', async () => {
  const asks = []; let now = 1000
  const { s } = session({ store: null, asks, clock: () => now })
  const granted = await s.grant({})
  assert.equal(granted.expiresAt, 1000 + 1800000); assert.equal(granted.remembered, false)
  assert.match(asks[0].policy, /expires in 30 minutes/)
  now += 1800001
  assert.equal((await s.registerTurn({}, { rawGoal: 'go', clientTurnId: 'g' })).reason, 'session_consent_required')
})
