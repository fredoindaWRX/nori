import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** These tests run against a disposable School tree, never the live one. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'nori-school-'))
  mkdirSync(join(root, 'school', 'github-learning'), { recursive: true })
  mkdirSync(join(root, 'runtime-data', 'learning'), { recursive: true })
  mkdirSync(join(root, 'runtime-data', 'evolution'), { recursive: true })
  writeFileSync(join(root, 'school', 'NORI_SCHOOL_UPDATES.txt'), 'CANONICAL LEDGER SENTINEL\n')
  writeFileSync(join(root, 'school', 'github-learning', 'notes.md'), '# notes\n')
  writeFileSync(join(root, 'runtime-data', 'learning', 'run-report.md'), 'report\n')
  return root
}

const ROOT = fixture()
process.env.NORI_ROOT = ROOT

const listAll = (dir, prefix = '') => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
  entry.isDirectory() ? listAll(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`])

test('lane commands parse and default without a payload', async () => {
  const { command } = await import('../bridge/nori-school.mjs')
  assert.equal(command('what have you learned'), null)
  assert.equal(command('*work build a thing'), null)
  assert.deepEqual(command('*learn study the renderer architecture'), { kind: 'learn', goal: 'study the renderer architecture' })
  assert.deepEqual(command('*IMPROVE make barge-in cleaner'), { kind: 'improve', goal: 'make barge-in cleaner' })
  const empty = command('*learn')
  assert.equal(empty.kind, 'learn')
  assert.match(empty.goal, /highest-value GitHub learning target/)
})

test('the learning brief carries the GitHub Learning Policy contract', async () => {
  const { learningBrief } = await import('../bridge/nori-school.mjs')
  const brief = learningBrief('study pipecat barge-in')
  assert.match(brief, /GITHUB_LEARNING_POLICY\.md/)
  assert.match(brief, /school\\github-learning/)
  assert.match(brief, /runtime-data\\learning/)
  assert.match(brief, /never run unknown install scripts/)
  assert.match(brief, /never modify live Nori code/)
  assert.match(brief, /GITHUB_LEARNING_READY/)
  assert.match(brief, /study pipecat barge-in/)
})

test('the evolution brief enforces chambered mutation with rollback evidence', async () => {
  const { evolutionBrief } = await import('../bridge/nori-school.mjs')
  const brief = evolutionBrief('faster wake word')
  assert.match(brief, /NORI_EVOLUTION_POLICY\.md/)
  assert.match(brief, /isolated evolution worktree\/chamber/)
  assert.match(brief, /never edit the live C:\\Nori tree/)
  assert.match(brief, /rollback/)
  assert.match(brief, /EVOLUTION_MUTATION_READY/)
  assert.match(brief, /owner promotes/i)
})

test('school status reports real files, stays read-only, and is bounded', async () => {
  const { MAX_EVIDENCE_CHARS, paths, schoolStatus } = await import('../bridge/nori-school.mjs')
  const local = fixture()
  const before = listAll(local)
  const text = schoolStatus({ root: local })
  assert.equal(listAll(local).join('|'), before.join('|'), 'schoolStatus must not create or alter files')
  assert.match(text, /read-only snapshot/)
  assert.match(text, /CANONICAL LEDGER SENTINEL/)
  assert.match(text, /notes\.md/)
  assert.match(text, /run-report\.md/)
  assert.ok(text.length <= MAX_EVIDENCE_CHARS + 32)

  writeFileSync(paths(local).ledger, 'A'.repeat(50 * 1024) + 'LEDGER-END-MARK')
  assert.match(schoolStatus({ root: local }), /LEDGER-END-MARK/)

  writeFileSync(paths(local).ledger, 'x'.repeat(600 * 1024))
  assert.match(schoolStatus({ root: local }), /unavailable/)

  const empty = schoolStatus({ root: join(local, 'definitely-not-there') })
  assert.match(empty, /\(none yet\)/)
})

test('self-referential questions are detected and ordinary ones are not', async () => {
  const { selfQuery } = await import('../bridge/nori-school.mjs')
  assert.ok(selfQuery('what have you learned lately'))
  assert.ok(selfQuery('how do you improve yourself'))
  assert.ok(selfQuery('tell me about your own code'))
  assert.ok(!selfQuery('what is the weather tomorrow'))
  assert.ok(!selfQuery('learn how to cook rice'))
})

// Integration: the real query adapter against a stub Council.

test('*learn turns submit the policy brief through the durable work queue', async (t) => {
  const token = 'school-lane-token-that-is-longer-than-thirty-two-chars'
  const calls = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    calls.push({ url: request.url, body: body ? JSON.parse(body) : null })
    response.setHeader('content-type', 'application/json')
    if (request.method === 'POST' && request.url === '/work') {
      response.end(JSON.stringify({ task_id: 'work-school-1', status: 'queued' }))
      return
    }
    if (request.url === '/work/work-school-1') {
      response.end(JSON.stringify({ task_id: 'work-school-1', status: 'completed', response: 'GITHUB_LEARNING_READY' }))
      return
    }
    response.statusCode = 404
    response.end(JSON.stringify({ error: 'not found' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())

  process.env.NORI_COUNCIL_URL = `http://127.0.0.1:${server.address().port}`
  process.env.NORI_API_TOKEN = token
  process.env.NORI_POLL_MS = '1'
  const { query } = await import(`../bridge/nori-v2-query.mjs?learn=${Date.now()}`)
  async function* prompt() {
    yield { message: { content: [{ type: 'text', text: '*learn study renderer architecture' }] } }
  }
  const messages = []
  for await (const message of query({ prompt: prompt() })) messages.push(message)

  assert.equal(calls.some((call) => call.url === '/chat'), false, 'the lane must not fall back to chat')
  const submitted = calls.find((call) => call.url === '/work')
  assert.ok(submitted, 'the lane must use the durable work queue')
  assert.match(submitted.body.goal, /GITHUB_LEARNING_POLICY\.md/)
  assert.match(submitted.body.goal, /study renderer architecture/)
  assert.match(submitted.body.goal, /GITHUB_LEARNING_READY/)
  assert.equal(messages.at(-1).result, 'GITHUB_LEARNING_READY')
})

test('self-query chat turns attach the bounded School evidence snapshot', async (t) => {
  const token = 'grounded-chat-token-that-is-longer-than-thirty-two-chars'
  let received = null
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    received = JSON.parse(body)
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ status: 'completed', response: 'grounded' }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => server.close())

  process.env.NORI_COUNCIL_URL = `http://127.0.0.1:${server.address().port}`
  process.env.NORI_API_TOKEN = token
  const { query } = await import(`../bridge/nori-v2-query.mjs?grounded=${Date.now()}`)
  async function* prompt() {
    yield { message: { content: [{ type: 'text', text: 'what have you learned lately' }] } }
  }
  for await (const _message of query({ prompt: prompt() })) { /* consume */ }

  assert.match(received.goal, /\[Nori School/)
  assert.match(received.goal, /CANONICAL LEDGER SENTINEL/)
  assert.ok(received.goal.length < 3000)
})