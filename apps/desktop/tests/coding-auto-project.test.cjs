const test = require('node:test'), assert = require('node:assert/strict')
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs'), { tmpdir } = require('node:os'), { join } = require('node:path')
const { createWorkerWorkspace } = require('../desktop/worker-workspace.cjs')
const { createCodingSession } = require('../desktop/coding-session.cjs')

function project(root, name) { const dir = join(root, name); mkdirSync(join(dir, '.git'), { recursive: true }); return dir }

test('she can switch to a known project for the session without changing the owner\'s saved choice, and back', async () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-autoproj-'))
  const owners = project(root, 'owner-app'), own = project(root, 'self-code')
  mkdirSync(join(root, 'settings'), { recursive: true })
  writeFileSync(join(root, 'settings', 'worker-workspace.json'), JSON.stringify({ schema: 'nori.worker-workspace.v1', workspace: owners }))
  const activated = []
  const ws = createWorkerWorkspace({ dataRoot: root, owns: () => true, choose: async () => null,
    activate: async workspace => { activated.push(workspace); return { workspace, restartRequired: false } } })
  ws.startup()
  assert.equal(ws.read({}).workspace, owners)
  assert.deepEqual(await ws.switchTo(own), { workspace: own, changed: true })
  assert.deepEqual(ws.read({}), { workspace: own, restartRequired: false, approvalGranted: false, automatic: true })
  assert.equal(ws.automaticWorkspace(), own)
  assert.equal(ws.savedWorkspace(), owners)
  assert.equal(JSON.parse(readFileSync(join(root, 'settings', 'worker-workspace.json'), 'utf8')).workspace, owners, 'the saved choice is untouched')
  assert.deepEqual(await ws.switchTo(own), { workspace: own, changed: false })
  assert.deepEqual(await ws.switchTo(owners, { automatic: false }), { workspace: owners, changed: true })
  assert.equal(ws.automaticWorkspace(), null)
  assert.equal(ws.read({}).workspace, owners); assert.equal(ws.read({}).approvalGranted, false)
  assert.deepEqual(activated, [own, owners])
  await assert.rejects(ws.switchTo(join(root, 'not-a-project')), /ENOENT|real project|Git project/)
  const refusing = createWorkerWorkspace({ dataRoot: root, owns: () => true, choose: async () => null, activate: async () => ({ workspace: 'elsewhere', restartRequired: false }) })
  await assert.rejects(refusing.switchTo(own), /did not confirm/)
})

test('the project hook runs before consent, never while a run is active, and its failure sends nothing', async () => {
  const core = { environment: { NORI_COUNCIL_URL: 'http://127.0.0.1:9107/', NORI_API_TOKEN: 't' }, workerApprovalKey: 'a'.repeat(64) }
  const fetcher = async () => new Response(JSON.stringify({ enabled: true, per_task_confirmation_required: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  const state = { project: 'C:\\Work\\Owner', calls: [] }
  const make = hook => createCodingSession({ owns: () => true, getCore: () => core, getProject: () => state.project, ask: async () => true, fetcher,
    verifyWorkspace: async p => p, classifyGoal: async goal => goal !== 'hello', ensureProject: hook })
  const s = make(async goal => { state.calls.push(goal); if (/your code/.test(goal)) state.project = 'C:\\Nori\\self-code'; else state.project = 'C:\\Work\\Owner' })
  assert.equal((await s.registerTurn({}, { rawGoal: 'hello', clientTurnId: 'a' })).reason, 'not_coding')
  assert.deepEqual(state.calls, [], 'ordinary conversation never touches the project')
  const held = await s.registerTurn({}, { rawGoal: 'fix your code', clientTurnId: 'b' })
  assert.equal(held.reason, 'session_consent_required'); assert.equal(state.project, 'C:\\Nori\\self-code')
  assert.equal((await s.grant({})).project, 'C:\\Nori\\self-code', 'consent is asked for the project she switched to')
  const run = await s.registerTurn({}, { rawGoal: 'fix your code', clientTurnId: 'c' })
  assert.equal(run.registered, true); assert.equal(run.project, 'C:\\Nori\\self-code')
  await assert.rejects(s.registerTurn({}, { rawGoal: 'fix the bug in this project', clientTurnId: 'd' }), /Finish or stop current coding work first/)
  assert.equal(state.project, 'C:\\Nori\\self-code', 'no switch while a run is active')
  const failing = make(async () => { throw new Error('Core refused the switch') })
  await assert.rejects(failing.registerTurn({}, { rawGoal: 'fix your code', clientTurnId: 'e' }), /Core refused the switch/)
})
