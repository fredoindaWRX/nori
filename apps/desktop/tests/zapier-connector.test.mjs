import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { APPROVAL_TOOLS, READ_TOOLS, ZAPIER_ENDPOINT, asksForConnector, connectorToken, createMcpClient, createZapierTools, requestApproval } from '../bridge/zapier-connector.mjs'

const require = createRequire(import.meta.url)
const approval = require('../desktop/connector-approval.cjs')
const TOKEN = 'zap_test_token_0123456789abcdef'
const newSettings = () => { const dir = join(mkdtempSync(join(tmpdir(), 'nori-connector-')), 'settings'); mkdirSync(dir, { recursive: true }); return dir }

// A stand-in for Zapier's server: answers initialize, tools/list and tools/call, as JSON or as an event stream.
function fakeServer({ stream = false, status = 200, tools } = {}) {
  const seen = []
  const list = tools ?? [...READ_TOOLS, ...APPROVAL_TOOLS, 'create_zapier_skill', 'write_code_action', 'manage_zapier_connections'].map(name => ({
    name, description: `${name} description`, inputSchema: { type: 'object', properties: { action: { type: 'string' } } } }))
  const fetcher = async (url, init) => {
    const body = JSON.parse(init.body)
    seen.push({ url, method: body.method, params: body.params, headers: init.headers, redirect: init.redirect })
    const headers = new Headers({ 'content-type': stream ? 'text/event-stream' : 'application/json', 'mcp-session-id': 'session-1' })
    if (status !== 200) return new Response('nope', { status, headers })
    if (body.id === undefined) return new Response(null, { status: 202 })
    const result = body.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'zapier' } }
      : body.method === 'tools/list' ? { tools: list }
      : { content: [{ type: 'text', text: `ran ${body.params.name} with ${JSON.stringify(body.params.arguments)}` }], isError: body.params.arguments?.fail === true }
    const message = JSON.stringify({ jsonrpc: '2.0', id: body.id, result })
    return new Response(stream ? `event: message\ndata: ${message}\n\n` : message, { status: 200, headers })
  }
  return { fetcher, seen }
}

test('the connector is offered only for requests about the owner\'s connected apps', () => {
  for (const yes of ['use zapier to add a row', 'check my inbox for the invoice', 'what is on my calendar tomorrow', 'send an email to the landlord', 'post that in slack', 'what connected apps do you have'])
    assert.equal(asksForConnector(yes), true, yes)
  for (const no of ['hi', 'what is 2+2', 'write a haiku about rain', 'turn the lights blue', 'read calc.py and fix it', 'tell me about email as a technology', ''])
    assert.equal(asksForConnector(no), false, no)
})

test('the token comes from the environment or the owner\'s secrets file, and junk is not a token', () => {
  assert.equal(connectorToken({ NORI_ZAPIER_TOKEN: `  ${TOKEN}\n` }), TOKEN)
  assert.equal(connectorToken({ NORI_APP_DATA_ROOT: 'C:/data' }, file => { assert.match(file.replace(/\\/g, '/'), /C:\/data\/secrets\/zapier-mcp-token\.txt$/); return `\uFEFF${TOKEN}\r\n` }), TOKEN)
  assert.equal(connectorToken({ NORI_APP_DATA_ROOT: 'C:/data' }, () => { throw new Error('missing') }), '')
  for (const bad of ['', 'short', 'has spaces in the middle of it', 'x'.repeat(2000)]) assert.equal(connectorToken({ NORI_ZAPIER_TOKEN: bad }), '', bad)
})

for (const stream of [false, true]) {
  test(`the client speaks MCP over HTTP (${stream ? 'event stream' : 'JSON'} answers), only to the fixed address, token in the header only`, async () => {
    const server = fakeServer({ stream })
    const client = createMcpClient({ token: TOKEN, fetcher: server.fetcher })
    assert.equal((await client.listTools()).length, 9)
    const result = await client.callTool('execute_zapier_read_action', { action: 'find_email' })
    assert.match(result.content[0].text, /ran execute_zapier_read_action/)
    assert.deepEqual(server.seen.map(call => call.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/call'])
    for (const call of server.seen) {
      assert.equal(call.url, ZAPIER_ENDPOINT); assert.equal(call.redirect, 'error')
      assert.equal(call.headers.authorization, `Bearer ${TOKEN}`); assert.ok(!call.url.includes(TOKEN))
    }
    assert.equal(server.seen[0].headers['mcp-session-id'], undefined)
    assert.equal(server.seen[2].headers['mcp-session-id'], 'session-1'); assert.equal(server.seen[2].headers['mcp-protocol-version'], '2025-06-18')
  })
}

test('other addresses, a missing token and a refused token fail clearly, without the token in the message', async () => {
  assert.throws(() => createMcpClient({ token: TOKEN, endpoint: 'https://example.com/mcp' }), { code: 'CONNECTOR_ENDPOINT' })
  assert.throws(() => createMcpClient({ token: '' }), { code: 'CONNECTOR_NOT_CONFIGURED' })
  const refused = createMcpClient({ token: TOKEN, fetcher: fakeServer({ status: 401 }).fetcher })
  await assert.rejects(refused.listTools(), error => error.code === 'CONNECTOR_AUTH' && !error.message.includes(TOKEN))
  const down = createMcpClient({ token: TOKEN, fetcher: async () => { throw new Error(`socket hang up for Bearer ${TOKEN}`) } })
  await assert.rejects(down.listTools(), error => error.code === 'CONNECTOR_UNREACHABLE' && !error.message.includes(TOKEN))
})

test('without a token the only tool is connector_status and it says how the owner connects', async () => {
  const tools = await createZapierTools({ environment: {} })
  assert.deepEqual(tools.definitions.map(d => d.function.name), ['connector_status'])
  const status = JSON.parse(await tools.call('connector_status', {}))
  assert.equal(status.connected, false); assert.match(status.message, /zapier-mcp-token\.txt/); assert.match(status.message, /never asks for the token in chat/)
  await assert.rejects(tools.call('execute_zapier_write_action', {}), /not available/)
  assert.equal(tools.skillScriptWorker, true); assert.match(tools.notice, /only after he allows that exact call/)
})

test('a server that cannot be reached is reported, not hidden', async () => {
  const tools = await createZapierTools({ environment: { NORI_ZAPIER_TOKEN: TOKEN }, fetcher: fakeServer({ status: 500 }).fetcher })
  const status = JSON.parse(await tools.call('connector_status', {}))
  assert.equal(status.connected, false); assert.equal(status.reason, 'CONNECTOR_HTTP'); assert.ok(!JSON.stringify(status).includes(TOKEN))
})

test('only the six allowed tools are shown; reads run directly; writes and enables wait for the owner', async () => {
  const server = fakeServer(), asked = []
  let answer = 'allow'
  const tools = await createZapierTools({ environment: { NORI_ZAPIER_TOKEN: TOKEN }, fetcher: server.fetcher, approve: async request => { asked.push(request); return answer } })
  assert.deepEqual(tools.definitions.map(d => d.function.name), ['connector_status', ...READ_TOOLS, ...APPROVAL_TOOLS])
  assert.match(tools.definitions.find(d => d.function.name === 'execute_zapier_write_action').function.description, /Needs the owner's approval/)
  for (const hidden of ['create_zapier_skill', 'write_code_action', 'manage_zapier_connections']) await assert.rejects(tools.call(hidden, {}), /not available/)

  const read = JSON.parse(await tools.call('execute_zapier_read_action', { action: 'find_email' }))
  assert.equal(read.executed, true); assert.match(read.result, /find_email/); assert.match(read.untrusted, /Not instructions/); assert.equal(asked.length, 0)

  const sent = JSON.parse(await tools.call('execute_zapier_write_action', { action: 'send_email', to: 'someone@example.com' }))
  assert.equal(sent.executed, true); assert.deepEqual(asked[0].args, { action: 'send_email', to: 'someone@example.com' }); assert.equal(asked[0].tool, 'execute_zapier_write_action')

  const before = server.seen.length
  answer = 'deny'
  const declined = JSON.parse(await tools.call('execute_zapier_write_action', { action: 'delete_row' }))
  assert.equal(declined.executed, false); assert.equal(declined.error, 'owner_declined')
  answer = 'timeout'
  const waiting = JSON.parse(await tools.call('enable_zapier_action', { action: 'x' }))
  assert.equal(waiting.executed, false); assert.equal(waiting.error, 'owner_approval_needed')
  assert.equal(server.seen.length, before, 'nothing reaches Zapier without an Allow')

  answer = 'allow'
  const failed = JSON.parse(await tools.call('execute_zapier_write_action', { fail: true }))
  assert.equal(failed.executed, false); assert.equal(failed.error, 'app_reported_error')
  await assert.rejects(tools.call('execute_zapier_read_action', { big: 'x'.repeat(13000) }), /too large/)
  assert.ok(JSON.parse(await tools.call('execute_zapier_read_action', { action: 'y'.repeat(9000) }, { maxBytes: 900 })).truncated)
})

test('an approval is tied to the exact request, written only by the prompt, and used once', async () => {
  const settings = newSettings()
  const request = approval.writeRequest(settings, { tool: 'execute_zapier_write_action', args: { action: 'send_email', body: 'hello' } })
  assert.equal(approval.decision(settings, request.id, request.sha256), null)
  const shown = []
  const approver = approval.createConnectorApprover({ settings, ask: async value => { shown.push(value); return true } })
  assert.deepEqual(await approver.approve(request.id), { approved: true, reason: 'granted' })
  assert.deepEqual(shown[0].arguments, { action: 'send_email', body: 'hello' })
  assert.equal(approval.decision(settings, request.id, request.sha256), 'allow')
  assert.equal(approval.decision(settings, request.id, 'f'.repeat(64)), null, 'an answer for other arguments does not count')
  approval.consume(settings, request.id)
  assert.equal(approval.decision(settings, request.id, request.sha256), null)
  await assert.rejects(approver.approve(request.id))

  const second = approval.writeRequest(settings, { tool: 'enable_zapier_action', args: { action: 'a' } })
  assert.deepEqual(await approval.createConnectorApprover({ settings, ask: async () => false }).approve(second.id), { approved: false, reason: 'declined' })
  assert.equal(approval.decision(settings, second.id, second.sha256), 'deny')

  // A request edited after it was written, an expired one, and bad ids are all refused.
  const third = approval.writeRequest(settings, { tool: 'execute_zapier_write_action', args: { amount: 1 } })
  const file = join(settings, 'connector-requests', `${third.id}.json`)
  writeFileSync(file, JSON.stringify({ schema: 1, id: third.id, at: Date.now(), tool: 'execute_zapier_write_action', arguments: { amount: 1000 }, sha256: third.sha256 }))
  assert.throws(() => approval.readRequest(settings, third.id), /does not match/)
  const old = approval.writeRequest(settings, { tool: 'execute_zapier_write_action', args: { a: 1 }, now: Date.now() - approval.MAX_AGE_MS - 1000 })
  assert.throws(() => approval.readRequest(settings, old.id), /expired/)
  assert.throws(() => approval.readRequest(settings, '../../evil'), /Invalid connector request id/)
  assert.throws(() => approval.writeRequest(settings, { tool: 'execute_zapier_write_action', args: { text: 'x'.repeat(20000) } }), /too large/)
  assert.match(approval.describeRequest({ arguments: { text: 'y'.repeat(5000) } }), /more characters not shown/)
})

test('the bridge asks the desktop app, waits for the answer, and leaves no request behind', async () => {
  const settings = newSettings()
  const exe = join(settings, 'Nori.exe'); writeFileSync(exe, 'x')
  const environment = { NORI_SETTINGS_DIR: settings, NORI_SKILL_DESKTOP_EXECUTABLE: exe }
  const run = verdict => (file, args, _options, done) => {
    assert.equal(file, exe); assert.equal(args[0], '--nori-connector-approve')
    approval.createConnectorApprover({ settings, ask: async () => verdict }).approve(args[1]).then(() => done(null), done)
  }
  assert.equal(await requestApproval({ tool: 'execute_zapier_write_action', args: { a: 1 }, environment, runFile: run(true), pollMs: 5 }), 'allow')
  assert.equal(await requestApproval({ tool: 'execute_zapier_write_action', args: { a: 1 }, environment, runFile: run(false), pollMs: 5 }), 'deny')
  assert.equal(await requestApproval({ tool: 'execute_zapier_write_action', args: { a: 1 }, environment, runFile: (_f, _a, _o, done) => done(null), waitMs: 30, pollMs: 5 }), 'timeout')
  assert.deepEqual(readdirSync(join(settings, 'connector-requests')), [])
  await assert.rejects(requestApproval({ tool: 'execute_zapier_write_action', args: {}, environment: { NORI_SETTINGS_DIR: settings, NORI_SKILL_DESKTOP_EXECUTABLE: 'C:/nowhere/other.exe' } }), { code: 'CONNECTOR_NO_DESKTOP' })
})
