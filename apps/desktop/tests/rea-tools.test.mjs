import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { checkNoriReaConnection, createNoriReaTools, noriReaMissingTargetResponse, noriReaResultResponse,
  noriReaSetupResponse, requestedNoriReaTarget, requestsNoriRea, requestsNoriReaSetup,
  resolveNoriReaEnginePaths } from '../bridge/rea-tools.mjs'

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'nori-rea-runtime-'))
  const target = path.join(root, 'test-target.exe')
  writeFileSync(target, 'synthetic packaged target')
  const script = path.join(root, 'rea', 'scripts', 'rea.mjs')
  mkdirSync(path.dirname(script), { recursive: true })
  writeFileSync(script, '// synthetic REA CLI fixture')
  writeFileSync(path.join(root, 'rea', 'package.json'), JSON.stringify({ name: 'rea-agents', version: '6.8.0' }))
  const node = path.join(root, 'node.exe')
  writeFileSync(node, 'synthetic node executable identity for injected runner')
  return { root, target, script, node,
    environment: { NORI_REA_SCRIPT: script, NORI_REA_NODE: node, APPDATA: root, PATH: '' } }
}

test('native summary uses verified overview without unsupported analysis views and rejects tampering', async t => {
  const f = fixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const client = mockMcp({ result: { normalized_result: { document: 'fixture', procedure_count: 12, string_count: 3, segment_count: 2 } } })
  const tools = createNoriReaTools(`Use REA to inspect "${f.target}".`, {
    noriRoot: f.root, environment: f.environment, mcpFactory: async () => client,
    evidenceReader: async file => JSON.parse(readFileSync(file, 'utf8')).evidence_id,
  })
  await tools.call('rea_analyze_target', { path: f.target })
  const result = JSON.parse(await tools.call('rea_inspect_latest_evidence', { view: { kind: 'summary' } }))
  assert.equal(result.normalized_result.summary.procedure_count, 12)
  assert.equal(client.calls.some(call => call.name === 'inspect_analysis_view'), false)
  await assert.rejects(tools.call('rea_inspect_latest_evidence', { view: { kind: 'page', collection: 'modules', limit: 1 } }))
  const exported = client.calls.find(call => call.name === 'export_evidence_bundle').arguments.path
  writeFileSync(exported, '{}')
  await assert.rejects(tools.call('rea_inspect_latest_evidence', { view: { kind: 'summary' } }), /changed/)
})

function mockMcp({ evidenceId = `ev_${'a'.repeat(64)}`, analysisReceiptId = `ev_${'f'.repeat(64)}`, exportedEvidenceIds = [evidenceId], result = {}, onCall = () => {} } = {}) {
  let calls = []
  let callOptions = []
  return {
    get calls() { return calls },
    get callOptions() { return callOptions },
    async listTools() { return { tools: [
      { name: 'open_binary' }, { name: 'binary_overview' }, { name: 'close_binary' },
      { name: 'analyze_javascript_application' }, { name: 'inspect_analysis_view' }, { name: 'export_evidence_bundle' },
    ] } },
    async callTool(request, options) {
      calls.push(request)
      callOptions.push(options)
      onCall(request)
      if (request.name === 'export_evidence_bundle') {
        writeFileSync(request.arguments.path, JSON.stringify({ evidence_id: exportedEvidenceIds[0],
          records: exportedEvidenceIds.slice(1).map(id => ({ evidence_id: id })), ...result }))
        return { content: [{ type: 'text', text: 'Evidence bundle exported.' }] }
      }
      if (request.name === 'inspect_analysis_view') {
        return { structuredContent: { evidence_id: `ev_${'d'.repeat(64)}`, subject: { name: 'fixture', largeIgnoredEnvelope: 'x'.repeat(20_000) }, raw_result: { ignored: 'y'.repeat(20_000) }, normalized_result: {
          kind: request.arguments.view.kind,
          parent_evidence_id: request.arguments.source.evidence_id,
          parent_operation: 'analyze_javascript_application', parent_digest: `sha256:${'1'.repeat(64)}`, view_digest: `sha256:${'2'.repeat(64)}`,
          ...(request.arguments.view.kind === 'summary' ? { summary: { files: 1, functions: 2 } } : {}),
          ...(request.arguments.view.kind === 'page' ? { items: [{ node_id: `jag_node_${'e'.repeat(64)}`, path: 'assets/main.js' }] } : {}),
          ...(request.arguments.view.kind === 'item' ? { item: { node_id: request.arguments.view.selector.node_id, exports: [] } } : {}),
          view: request.arguments.view, coverage: { status: 'partial' }, limitations: ['synthetic test evidence'], unknowns: [],
        } } }
      }
      if (request.name === 'analyze_javascript_application') {
        return { structuredContent: { evidence_id: analysisReceiptId, normalized_result: {
          parent_evidence_id: evidenceId, summary: { files: 1, functions: 2 },
        } } }
      }
      return { structuredContent: { evidence_id: evidenceId, normalized_result: { summary: { files: 1, functions: 2 } }, ...result } }
    },
    async close() {},
  }
}

test('REA routing requires an explicit analysis request and one quoted exact packaged path', t => {
  const f = fixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const request = `Use REA to inspect "${f.target}" read-only.`
  assert.equal(requestsNoriRea(request), true)
  assert.equal(requestedNoriReaTarget(request).path, f.target)
  assert.equal(requestedNoriReaTarget('What is REA?').needsPath, true)
  assert.equal(requestsNoriRea('Use my app tools'), false)
  assert.match(noriReaMissingTargetResponse(), /exact path/i)
})

test('REA setup requests perform a live MCP handshake and report only Nori-wired tools', async t => {
  const f = fixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const request = 'Check that REA is connected and show which REA tools Nori can use.'
  assert.equal(requestsNoriReaSetup(request), true)
  let closed = false
  const client = mockMcp()
  const close = client.close.bind(client)
  client.close = async () => { closed = true; await close() }
  const status = await checkNoriReaConnection({ noriRoot: f.root, environment: f.environment,
    nodeVersionProbe: async node => { assert.equal(node, f.node); return 'v26.12.1' },
    mcpFactory: async options => { assert.equal(options.script, f.script); return client } })
  assert.equal(status.status, 'connected')
  assert.equal(status.server_tool_count, 6)
  assert.deepEqual(status.nori_wired_tools, [
    'analyze_javascript_application', 'inspect_analysis_view', 'open_binary', 'binary_overview', 'export_evidence_bundle',
    'close_binary',
  ])
  assert.equal(closed, true)
  const response = await noriReaSetupResponse({ noriRoot: f.root, environment: f.environment,
    nodeVersionProbe: async () => 'v26.12.1', mcpFactory: async () => mockMcp() })
  assert.match(response, /local MCP handshake succeeded/)
  assert.match(response, /is not needed/)
  assert.match(response, /not the same as wiring all 6 REA tools/)
  assert.equal(requestsNoriRea('Use my app tools'), false)
  assert.equal(requestsNoriReaSetup('Use REA to analyze "C:\\Apps\\Sample.exe".'), false)
})

test('REA connection check never claims a missing installation succeeded', async t => {
  const f = fixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const response = await noriReaSetupResponse({ noriRoot: f.root, environment: { APPDATA: f.root, PATH: '' } })
  assert.match(response, /connection check did not pass/)
  assert.match(response, /will not claim REA is connected/)
})

test('REA connection rejects unsupported Node versions and incomplete Nori tool wiring', async t => {
  const f = fixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  await assert.rejects(() => checkNoriReaConnection({ noriRoot: f.root, environment: f.environment,
    nodeVersionProbe: async () => 'v22.23.3', mcpFactory: async () => { throw new Error('must not launch') } }), /Node\.js 22\.23\.4\+/)
  await assert.rejects(() => checkNoriReaConnection({ noriRoot: f.root, environment: f.environment,
    nodeVersionProbe: async () => 'v24.22.0', mcpFactory: async () => { throw new Error('must not launch') } }), /24\.22\.1\+/)
  await assert.rejects(() => checkNoriReaConnection({ noriRoot: f.root, environment: f.environment,
    nodeVersionProbe: async () => 'v26.12.0', mcpFactory: async () => { throw new Error('must not launch') } }), /26\.12\.1\+/)
  const client = mockMcp()
  client.listTools = async () => ({ tools: [{ name: 'analyze_javascript_application' }] })
  const status = await checkNoriReaConnection({ noriRoot: f.root, environment: f.environment,
    nodeVersionProbe: async () => 'v24.22.1', mcpFactory: async () => client })
  assert.equal(status.status, 'incomplete')
  assert.deepEqual(status.missing_nori_wired_tools,
    ['inspect_analysis_view', 'open_binary', 'binary_overview', 'export_evidence_bundle', 'close_binary'])
})

test('single-target Ghidra invocation stays fixed and retains digest-verified Evidence', async t => {
  const f = fixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const request = `Use REA to analyze "${f.target}".`
  const client = mockMcp({ onCall(call) {
    if (call.name === 'open_binary') assert.deepEqual(call.arguments, { path: f.target, provider_id: 'ghidra' })
    if (call.name === 'binary_overview') assert.deepEqual(call.arguments, {})
    if (call.name === 'close_binary') assert.deepEqual(call.arguments, {})
  } })
  const tools = createNoriReaTools(request, { noriRoot: f.root, environment: f.environment,
    clock: () => new Date('2026-10-16T12:00:00.000Z'),
    mcpFactory: async options => { assert.equal(options.script, f.script); assert.equal(options.node, f.node); return client },
    evidenceReader: async file => JSON.parse(readFileSync(file, 'utf8')).evidence_id })
  const receipt = JSON.parse(await tools.call('rea_analyze_target', { path: f.target }))
  assert.equal(receipt.status, 'completed')
  assert.equal(receipt.evidence_id, `ev_${'a'.repeat(64)}`)
  assert.equal(receipt.target_executed, false)
  assert.equal(receipt.target_modified, false)
  assert.match(noriReaResultResponse(JSON.stringify(receipt)), /static analysis/)
  const evidencePath = path.join(f.root, receipt.evidence_path)
  assert.deepEqual(JSON.parse(readFileSync(evidencePath, 'utf8')).evidence_id, `ev_${'a'.repeat(64)}`)
  assert.equal(readdirSync(path.join(f.root, 'verification', 'rea')).length, 1)
  assert.deepEqual(client.calls.map(call => call.name), ['open_binary', 'binary_overview', 'export_evidence_bundle', 'close_binary'])
})

test('REA follow-up reads bounded module pages and items from the exact digest-pinned Evidence file', async t => {
  const f = fixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const app = path.join(f.root, 'dist')
  mkdirSync(path.join(app, 'assets'), { recursive: true })
  writeFileSync(path.join(app, 'index.html'), '<html></html>')
  writeFileSync(path.join(app, 'assets', 'main.js'), 'export const local = true')
  const oldEvidenceId = `ev_${'a'.repeat(64)}`
  const currentEvidenceId = `ev_${'b'.repeat(64)}`
  const client = mockMcp({ evidenceId: currentEvidenceId, analysisReceiptId: `ev_${'f'.repeat(64)}`,
    exportedEvidenceIds: [oldEvidenceId, currentEvidenceId] })
  let connections = 0
  const tools = createNoriReaTools(`Use REA to inspect "${app}".`, { noriRoot: f.root, environment: f.environment,
    mcpFactory: async () => { connections++; return client },
    evidenceReader: async (file, _script, expected) => {
      const bundle = JSON.parse(readFileSync(file, 'utf8'))
      assert.equal(expected, currentEvidenceId)
      assert.ok([bundle.evidence_id, ...bundle.records.map(record => record.evidence_id)].includes(expected))
      return expected
    } })
  assert.deepEqual(tools.definitions.map(item => item.function.name), [
    'rea_analyze_target', 'rea_inspect_latest_evidence',
  ])
  await assert.rejects(() => tools.call('rea_inspect_latest_evidence', {
    view: { kind: 'summary' },
  }), /only after a successful analysis/)
  assert.equal(connections, 0)
  const receipt = JSON.parse(await tools.call('rea_analyze_target', { path: app }))
  const summary = JSON.parse(await tools.call('rea_inspect_latest_evidence', {
    view: { kind: 'summary' },
  }))
  assert.equal(Object.hasOwn(summary, 'subject'), false)
  assert.equal(Object.hasOwn(summary, 'raw_result'), false)
  assert.equal(summary.normalized_result.parent_operation, 'analyze_javascript_application')
  assert.ok(Buffer.byteLength(JSON.stringify(summary)) < 12_000)
  const page = JSON.parse(await tools.call('rea_inspect_latest_evidence', {
    view: { kind: 'page', collection: 'modules', offset: 0, limit: 8 },
  }))
  const item = JSON.parse(await tools.call('rea_inspect_latest_evidence', {
    view: { kind: 'item', collection: 'modules', selector: { node_id: `jag_node_${'e'.repeat(64)}` } },
  }))
  assert.equal(summary.normalized_result.parent_evidence_id, receipt.evidence_id)
  assert.equal(page.normalized_result.parent_evidence_id, receipt.evidence_id)
  assert.equal(item.normalized_result.parent_evidence_id, receipt.evidence_id)
  assert.equal(connections, 4)
  const inspect = client.calls.filter(call => call.name === 'inspect_analysis_view')
  assert.equal(inspect.length, 3)
  assert.deepEqual(inspect[0].arguments.source, {
    kind: 'evidence-file', path: path.join(f.root, receipt.evidence_path), evidence_id: currentEvidenceId,
  })
  assert.deepEqual(inspect[1].arguments.source, inspect[0].arguments.source)
  assert.deepEqual(inspect[2].arguments.source, inspect[0].arguments.source)
  assert.deepEqual(inspect[1].arguments.view, {
    kind: 'page', collection: 'modules', offset: 0, limit: 8,
  })
  await assert.rejects(() => tools.call('rea_inspect_latest_evidence', {
    view: { kind: 'page', collection: 'modules', offset: 24, limit: 17 },
  }), /offset 0\.\.100000 and limit 1\.\.16/)
  await assert.rejects(() => tools.call('rea_inspect_latest_evidence', {
    view: { kind: 'page', collection: 'unknown', limit: 12 },
  }), /modules collection only/)
  await assert.rejects(() => tools.call('rea_inspect_latest_evidence', {
    view: { kind: 'item', collection: 'modules', selector: { node_id: 'invented' } },
  }), /exact node_id from a prior module page/)
  assert.equal(connections, 4)
})

test('REA page-first follow-up works without server-retained Evidence state', async t => {
  const f = fixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const app = path.join(f.root, 'dist')
  mkdirSync(path.join(app, 'assets'), { recursive: true })
  writeFileSync(path.join(app, 'index.html'), '<html></html>')
  const client = mockMcp()
  const tools = createNoriReaTools(`Use REA to inspect "${app}".`, { noriRoot: f.root, environment: f.environment,
    mcpFactory: async () => client,
    evidenceReader: async file => JSON.parse(readFileSync(file, 'utf8')).evidence_id })
  const receipt = JSON.parse(await tools.call('rea_analyze_target', { path: app }))
  const page = JSON.parse(await tools.call('rea_inspect_latest_evidence', {
    view: { kind: 'page', collection: 'modules', offset: 0, limit: 5 },
  }))
  assert.equal(page.normalized_result.parent_evidence_id, receipt.evidence_id)
  assert.deepEqual(client.calls.filter(call => call.name === 'inspect_analysis_view').map(call => call.name), ['inspect_analysis_view'])
  assert.deepEqual(client.calls.find(call => call.name === 'inspect_analysis_view').arguments.source, {
    kind: 'evidence-file', path: path.join(f.root, receipt.evidence_path), evidence_id: receipt.evidence_id,
  })
})

test('REA evidence follow-up refuses a modified saved bundle before reconnecting', async t => {
  const f = fixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const app = path.join(f.root, 'dist')
  mkdirSync(path.join(app, 'assets'), { recursive: true })
  writeFileSync(path.join(app, 'index.html'), '<html></html>')
  const client = mockMcp()
  let connections = 0
  const tools = createNoriReaTools(`Use REA to inspect "${app}".`, { noriRoot: f.root, environment: f.environment,
    mcpFactory: async () => { connections++; return client },
    evidenceReader: async file => JSON.parse(readFileSync(file, 'utf8')).evidence_id })
  const receipt = JSON.parse(await tools.call('rea_analyze_target', { path: app }))
  const evidencePath = path.join(f.root, receipt.evidence_path)
  writeFileSync(evidencePath, readFileSync(evidencePath, 'utf8') + ' ')
  await assert.rejects(() => tools.call('rea_inspect_latest_evidence', { view: { kind: 'summary' } }), /changed after analysis/)
  assert.equal(connections, 1)
})

test('packaged Nori resolves the installed Ghidra and JDK from its parent install tree', async t => {
  const f = fixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const suiteRoot = path.join(f.root, 'apps', 'desktop', 'release', 'candidate', 'win-unpacked', 'resources', 'NoriSuite')
  mkdirSync(suiteRoot, { recursive: true })
  const ghidra = path.join(f.root, 'tools', 'analysis-engines', 'ghidra_12.1.4_PUBLIC')
  const jdk = path.join(f.root, 'tools', 'analysis-engines', 'jdk-25.0.4.1+1')
  mkdirSync(path.join(ghidra, 'Ghidra'), { recursive: true })
  mkdirSync(path.join(ghidra, 'support'), { recursive: true })
  mkdirSync(path.join(jdk, 'bin'), { recursive: true })
  writeFileSync(path.join(ghidra, 'Ghidra', 'application.properties'), 'application.version=12.1.4')
  writeFileSync(path.join(ghidra, 'support', 'analyzeHeadless.bat'), '@echo off')
  writeFileSync(path.join(jdk, 'bin', 'java.exe'), 'synthetic Java executable identity')
  writeFileSync(path.join(jdk, 'release'), 'JAVA_VERSION="25.0.4.1"')
  assert.deepEqual(resolveNoriReaEnginePaths(suiteRoot, f.environment), { ghidra, jdk })
  const client = mockMcp()
  const tools = createNoriReaTools(`Use REA to inspect "${f.target}".`, {
    noriRoot: suiteRoot,
    environment: f.environment,
    mcpFactory: async options => {
      assert.equal(options.cwd, suiteRoot)
      assert.equal(options.environment.GHIDRA_INSTALL_DIR, ghidra)
      assert.equal(options.environment.JAVA_HOME, jdk)
      assert.equal(options.environment.REA_ANALYSIS_PROVIDER, 'ghidra')
      return client
    },
    evidenceReader: async file => JSON.parse(readFileSync(file, 'utf8')).evidence_id,
  })
  const receipt = JSON.parse(await tools.call('rea_analyze_target', { path: f.target }))
  assert.equal(receipt.status, 'completed')
  assert.deepEqual(client.calls.filter(call => call.name === 'open_binary')[0].arguments,
    { path: f.target, provider_id: 'ghidra' })
})

test('model arguments cannot widen the user-bound target and invalid REA receipts do not claim success', async t => {
  const f = fixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const tools = createNoriReaTools(`Analyze with REA "${f.target}"`, { noriRoot: f.root, environment: f.environment,
    mcpFactory: async () => { throw new Error('must not execute') } })
  await assert.rejects(() => tools.call('rea_analyze_target', { path: `${f.target}.other` }), /exact user-selected target/)
  assert.throws(() => noriReaResultResponse(JSON.stringify({ status: 'completed', evidence_id: 'missing-digest' })), /incomplete REA receipt/)
})

test('unsupported targets fail before REA can be launched', t => {
  const f = fixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const unsupported = path.join(f.root, 'notes.txt')
  writeFileSync(unsupported, 'not an application artifact')
  const result = requestedNoriReaTarget(`Run REA on "${unsupported}"`)
  assert.match(result.invalid, /built app directories.*\.asar.*\.exe.*\.dll/)
})

test('an extracted built app is routed to REA static JavaScript analysis, never Ghidra', async t => {
  const f = fixture()
  t.after(() => rmSync(f.root, { recursive: true, force: true }))
  const app = path.join(f.root, 'dist')
  mkdirSync(path.join(app, 'assets'), { recursive: true })
  writeFileSync(path.join(app, 'index.html'), '<html></html>')
  writeFileSync(path.join(app, 'assets', 'main.js'), 'export const local = true')
  const client = mockMcp()
  const tools = createNoriReaTools(`Use REA to inspect "${app}".`, { noriRoot: f.root, environment: f.environment,
    mcpFactory: async () => client,
    evidenceReader: async file => JSON.parse(readFileSync(file, 'utf8')).evidence_id })
  await assert.rejects(() => tools.call('rea_analyze_target', { path: app, source_paths: ['../outside.js'] }), /normalized relative paths/)
  const receipt = JSON.parse(await tools.call('rea_analyze_target', { path: app, source_paths: ['assets/main.js'] }))
  assert.equal(receipt.status, 'completed')
  assert.equal(receipt.target_kind, 'javascript_application_directory')
  assert.match(receipt.provider, /javascript-static/)
  assert.equal(client.calls[0].name, 'analyze_javascript_application')
  assert.equal(client.calls[0].arguments.detail, 'summary')
  assert.equal(client.calls[0].arguments.analysis_timeout_ms, 480_000)
  assert.deepEqual(client.calls[0].arguments.source_paths, ['assets/main.js'])
  assert.equal(client.callOptions[0].timeout, 500_000)
})

test('invalid evidence storage is rejected before starting an MCP child',async t=>{
 const f=fixture();t.after(()=>rmSync(f.root,{recursive:true,force:true}));let starts=0;
 const request=`Use REA to inspect "${f.target}".`;
 const tools=createNoriReaTools(request,{noriRoot:f.root,environment:{...f.environment,NORI_APP_DATA_ROOT:path.join(f.root,'not-canonical')},mcpFactory:async()=>{starts++;return mockMcp()}});
 await assert.rejects(()=>tools.call('rea_analyze_target',{path:f.target}),/verified canonical state/);
 assert.equal(starts,0)
})

test('native REA open has a finite startup budget and receives caller cancellation',async t=>{
 const f=fixture();t.after(()=>rmSync(f.root,{recursive:true,force:true}));const client=mockMcp();const controller=new AbortController();
 const tools=createNoriReaTools(`Use REA to inspect "${f.target}".`,{noriRoot:f.root,environment:f.environment,mcpFactory:async()=>client,evidenceReader:async()=>`ev_${'a'.repeat(64)}`});
 await tools.call('rea_analyze_target',{path:f.target},{signal:controller.signal});
 assert.equal(client.callOptions[0].timeout,360000);assert.equal(client.callOptions[0].signal,controller.signal);assert.equal(client.callOptions[1].timeout,360000);assert.equal(client.callOptions[1].signal,controller.signal);assert.equal(client.calls.at(-1).name,'close_binary');
})
