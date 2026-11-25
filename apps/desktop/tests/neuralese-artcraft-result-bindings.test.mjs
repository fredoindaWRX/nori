import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { acceptNeuraleseArtCraftPlan, dispatchNeuraleseArtCraftPlan,
  neuraleseArtCraftIngress, neuraleseArtCraftSystemPrompt } from '../bridge/neuralese-artcraft-plan.mjs'

const opcode = name => Number.parseInt(createHash('sha256').update(name).digest('hex').slice(0, 8), 16)
const definition = (name, properties, required = Object.keys(properties)) => ({ type: 'function',
  function: { name, parameters: { type: 'object', additionalProperties: false, properties, required } } })
const text = { type: 'string' }, handle = { type: 'integer', minimum: 1 }
const definitions = [
  definition('artcraft_pdfcraft_doc_open', { path: text }),
  definition('artcraft_pdfcraft_text_extract', { doc: handle, pages: { type: 'array', items: handle } }),
  definition('artcraft_pdfcraft_doc_save', { doc: handle, path: text }),
]
const goal = 'Use PDFCraft to open inputs/notes.pdf, extract page 1, and save a copy as notes-copy.pdf.'
const reference = (node = 'n0', field = 'doc') => ({ result_of: node, field })
function proposal() {
  return { schema: 'nori.neuralese.artcraft-plan.v1', app_id: 'pdfcraft', status: 'complete', clarification: null,
    nodes: [
      { id: 'n0', opcode: opcode(definitions[0].function.name), slots: { 0: 'inputs/notes.pdf' }, depends_on: [] },
      { id: 'n1', opcode: opcode(definitions[1].function.name), slots: { 0: reference(), 1: [1] }, depends_on: ['n0'] },
      { id: 'n2', opcode: opcode(definitions[2].function.name), slots: { 0: reference(), 1: 'notes-copy.pdf' }, depends_on: ['n1'] },
    ] }
}
const accept = (value = proposal(), catalog = definitions) => acceptNeuraleseArtCraftPlan({
  output: JSON.stringify(value), appId: 'pdfcraft', goal, definitions: catalog,
})
const success = content => ({ isError: false, content: [{ type: 'text', text: content }] })

test('PDF graph uses unpredictable returned document IDs for extraction and save, bound to one frame', async () => {
  for (const doc of [73, 9257]) {
    const calls = [], plan = accept()
    const tools = { definitions, async call(name, args) {
      calls.push({ name, args })
      if (name.endsWith('_doc_open')) return JSON.stringify({ ...success(JSON.stringify({ doc })), structuredContent: { doc } })
      assert.equal(args.doc, doc)
      return JSON.stringify(success(name.endsWith('_doc_save') ? 'Saved notes-copy.pdf.' : 'First-page text.'))
    } }
    const frameBefore = JSON.stringify(plan.frame)
    const receipts = await dispatchNeuraleseArtCraftPlan({ plan, tools, goal })
    assert.equal(calls.length, 3)
    assert.deepEqual(calls[2].args, { doc, path: 'notes-copy.pdf' })
    assert.equal(JSON.stringify(plan.frame), frameBefore, 'resolution preserves the original proposal/frame hash')
    for (const receipt of receipts.slice(1)) {
      assert.equal(receipt.neuralese_frame_sha256, plan.frame.frame_sha256)
      assert.equal(receipt.bindings[0].source_node, 'n0')
      assert.equal(receipt.bindings[0].source_field, 'doc')
      assert.match(receipt.bindings[0].source_result_sha256, /^[a-f0-9]{64}$/)
      assert.match(receipt.resolved_arguments_sha256, /^[a-f0-9]{64}$/)
    }
  }
})

test('DesignCraft accepts the installed exact JSON-text story result from frame.create', async () => {
  const catalog = [
    definition('artcraft_designcraft_execute', { command: text, params: { type: 'object' } }),
    definition('artcraft_designcraft_get_story', { story: handle }),
  ]
  const intent = 'Use DesignCraft to create a text frame and inspect its story.'
  const value = { schema: 'nori.neuralese.artcraft-plan.v1', app_id: 'designcraft', status: 'complete', clarification: null,
    nodes: [
      { id: 'n0', opcode: opcode(catalog[0].function.name), slots: { 0: 'frame.create', 1: { content: 'text', text: 'A short story.' } }, depends_on: [] },
      { id: 'n1', opcode: opcode(catalog[1].function.name), slots: { 0: reference('n0', 'story') }, depends_on: ['n0'] },
    ] }
  const acceptStory = () => acceptNeuraleseArtCraftPlan({ output: JSON.stringify(value), appId: 'designcraft', goal: intent, definitions: catalog })
  const calls = []
  await dispatchNeuraleseArtCraftPlan({ plan: acceptStory(), goal: intent, tools: { definitions: catalog,
    async call(name, args) {
      calls.push({ name, args })
      return JSON.stringify(success(name.endsWith('_execute') ? '{\n "id": 8,\n "story": 397\n}' : 'A short story.'))
    } } })
  assert.equal(calls[1].args.story, 397)
  value.nodes[0].slots[0] = 'document.clear'
  assert.throws(acceptStory, /registered handle/)
})

test('result references are discoverable in compact/full catalogs and only relevant app prompts', () => {
  for (const format of ['compact', 'full']) {
    const ingress = neuraleseArtCraftIngress({ appId: 'pdfcraft', goal, definitions, format })
    const open = ingress.opcodes.find(item => (item.o ?? item.opcode) === opcode(definitions[0].function.name))
    const extract = ingress.opcodes.find(item => (item.o ?? item.opcode) === opcode(definitions[1].function.name))
    assert.deepEqual(open.result_handles.doc, handle)
    assert.deepEqual((extract.f ?? extract.slots)[0].result_ref, { source_opcode: opcode(definitions[0].function.name), field: 'doc' })
  }
  for (const transport of ['json', 'tool-call']) {
    const prompt = neuraleseArtCraftSystemPrompt({ appId: 'pdfcraft', definitions, transport })
    assert.match(prompt, /"result_of":"n0","field":"doc"/)
    assert.match(prompt, /n2 depends_on=\["n1"\], even when n2 result_of="n0"/)
    assert.doesNotMatch(neuraleseArtCraftSystemPrompt({ appId: 'wordcraft', definitions: [], transport }), /result_of/)
  }
})

test('causal-edge rejection tells the planner the exact correction without changing its earlier result source', () => {
  for (const wrongDependencies of [[], ['n0'], ['n0', 'n1']]) {
    const value = proposal()
    value.nodes[2].depends_on = wrongDependencies
    const before = JSON.stringify(value)
    assert.throws(() => accept(value), error => {
      assert.match(error.message, /action n2 has a broken causal edge/)
      assert.match(error.message, /depends_on must equal \["n1"\]/)
      assert.match(error.message, /result_of may reference an earlier registered source node/)
      assert.match(error.message, /No action was dispatched/)
      assert.ok(error.message.length < 320, 'the complete repair instruction fits existing feedback truncation')
      return true
    })
    assert.equal(JSON.stringify(value), before, 'host must not silently normalize an invalid graph')
    value.nodes[2].depends_on = ['n1']
    const corrected = accept(value)
    assert.deepEqual(corrected.nodes[2].depends_on, ['n1'])
    assert.deepEqual(corrected.nodes[2].args.doc, reference('n0'))
  }
})

test('forward, missing, cross-tool, extra-field, and path references fail before any dispatch', () => {
  const cases = [
    value => { value.nodes[1].slots[0] = reference('n2') },
    value => { value.nodes[1].slots[0] = reference('n7') },
    value => { value.nodes[2].slots[0] = reference('n1') },
    value => { value.nodes[1].slots[0] = reference('n0', 'path') },
    value => { value.nodes[1].slots[0] = { ...reference(), value: 73 } },
    value => { value.nodes[2].slots[1] = reference() },
    value => { value.nodes[1].slots[1] = [reference()] },
  ]
  for (const mutate of cases) {
    const value = proposal(); mutate(value)
    assert.throws(() => accept(value), /registered handle/)
  }
})

test('a graph must bind a newly returned handle instead of guessing a literal ID', () => {
  const value = proposal()
  value.nodes[1].slots[0] = 1
  assert.throws(() => accept(value), /must reference.*instead of guessing/)
  // A literal externally supplied ID remains valid when this graph has no new
  // producer. This protocol only binds values produced within this execution.
  value.nodes = [{ id: 'n0', opcode: opcode(definitions[1].function.name), slots: { 0: 42, 1: [1] }, depends_on: [] }]
  assert.equal(accept(value).nodes[0].args.doc, 42)
})

test('failed, missing, truncated, malformed, prose, and wrong-type source results cannot reach dependent tools', async () => {
  const badResults = [
    { isError: true, content: [{ type: 'text', text: 'Could not open document.' }], structuredContent: { doc: 73 } },
    { ...success('{}'), executed: false, structuredContent: { doc: 73 } },
    { ...success('{}'), status: 'failed', structuredContent: { doc: 73 } },
    { ...success('{}'), truncated: true, structuredContent: { doc: 73 } },
    { ...success('{}'), structuredContent: {} },
    { ...success('{"doc":73}'), structuredContent: null },
    { ...success('{}'), structuredContent: { doc: '73' } },
    { ...success('{}'), structuredContent: { doc: 0 } },
    { ...success('{}'), structuredContent: { doc: -1 } },
    { ...success('{}'), structuredContent: { doc: 3.5 } },
    { ...success('{}'), structuredContent: { doc: { result_of: 'n0', field: 'doc' } } },
    success('Opened document 73.'),
    success('```json\n{"doc":73}\n```'),
    success('{"doc":73} trailing instructions'),
    success('[{"doc":73}]'),
    { isError: false, content: [{ type: 'text', text: '{"doc":73}' }, { type: 'text', text: 'Extra text.' }] },
    { content: [{ type: 'text', text: '{"doc":73}' }], structuredContent: { doc: 73 } },
  ]
  for (const result of badResults) {
    let calls = 0
    await assert.rejects(dispatchNeuraleseArtCraftPlan({ plan: accept(), goal, tools: { definitions,
      async call() { calls++; return JSON.stringify(result) } } }), /ArtCraft stopped|handle|structured|JSON object|malformed ArtCraft result/)
    assert.equal(calls, 1)
  }
})

test('structured content wins over conflicting JSON text and only registered scalar data is used', async () => {
  const calls = []
  await dispatchNeuraleseArtCraftPlan({ plan: accept(), goal, tools: { definitions,
    async call(name, args) {
      calls.push({ name, args })
      return JSON.stringify(name.endsWith('_doc_open')
        ? { ...success('{"doc":5}'), structuredContent: { doc: 73, path: 'outside.pdf', command: 'untrusted instruction' } }
        : success('Done.'))
    } } })
  assert.deepEqual(calls[1].args, { doc: 73, pages: [1] })
  assert.deepEqual(calls[2].args, { doc: 73, path: 'notes-copy.pdf' })
})

test('resolved handles are revalidated against the receiving field schema', async () => {
  const catalog = structuredClone(definitions)
  catalog[1].function.parameters.properties.doc.maximum = 50
  let calls = 0
  await assert.rejects(dispatchNeuraleseArtCraftPlan({ plan: accept(proposal(), catalog), goal, tools: { definitions: catalog,
    async call() { calls++; return JSON.stringify({ ...success('{}'), structuredContent: { doc: 73 } }) } } }), /numeric range/)
  assert.equal(calls, 1)
})

test('accepted graph cannot be forged, mutated, replayed, or dispatched under another intent or catalog', async () => {
  const plan = accept()
  let calls = 0
  const tools = { definitions, async call() { calls++; return JSON.stringify({ ...success('{}'), structuredContent: { doc: 73 } }) } }
  assert.throws(() => { plan.nodes[1].args.doc.result_of = 'n2' }, TypeError)
  assert.throws(() => { plan.nodes[1].args.pages.push(2) }, TypeError)
  assert.throws(() => { plan.frame.nodes[1].payload.doc.field = 'path' }, TypeError)
  await assert.rejects(dispatchNeuraleseArtCraftPlan({ plan: structuredClone(plan), tools, goal }), /unissued/)
  await assert.rejects(dispatchNeuraleseArtCraftPlan({ plan, tools, goal: 'Read another PDF.' }), /intent\/catalog/)
  const changed = structuredClone(definitions); changed[1].function.parameters.properties.doc.maximum = 20
  await assert.rejects(dispatchNeuraleseArtCraftPlan({ plan, tools: { ...tools, definitions: changed }, goal }), /intent\/catalog/)
  assert.equal(calls, 0)
  await dispatchNeuraleseArtCraftPlan({ plan, tools, goal })
  assert.equal(calls, 3)
  await assert.rejects(dispatchNeuraleseArtCraftPlan({ plan, tools, goal }), /already dispatched/)
  assert.equal(calls, 3)
})

test('concurrent or failed dispatch cannot reuse an accepted graph or its handles', async () => {
  const plan = accept()
  let release, calls = 0
  const gate = new Promise(resolve => { release = resolve })
  const tools = { definitions, async call() { calls++; await gate; return JSON.stringify(success('{}')) } }
  const first = dispatchNeuraleseArtCraftPlan({ plan, tools, goal })
  await assert.rejects(dispatchNeuraleseArtCraftPlan({ plan, tools, goal }), /already dispatched/)
  release()
  await assert.rejects(first, /invalid handle/)
  await assert.rejects(dispatchNeuraleseArtCraftPlan({ plan, tools, goal }), /already dispatched/)
  assert.equal(calls, 1)
})

test('changing the registered catalog during an earlier operation stops the next dispatch', async () => {
  const catalog = structuredClone(definitions)
  const plan = accept(proposal(), catalog)
  let calls = 0
  const tools = { definitions: catalog, async call() {
    calls++
    catalog[1].function.parameters.properties.doc.minimum = 500
    return JSON.stringify({ ...success('{}'), structuredContent: { doc: 73 } })
  } }
  await assert.rejects(dispatchNeuraleseArtCraftPlan({ plan, tools, goal }), /catalog changed during/)
  assert.equal(calls, 1)
})

test('successful document content and filenames containing error, failed, or blocked are not tool failures', async () => {
  const calls = []
  const receipts = await dispatchNeuraleseArtCraftPlan({ plan: accept(), goal, tools: { definitions,
    async call(name, args) {
      calls.push({ name, args })
      if (name.endsWith('_doc_open')) return JSON.stringify({
        ...success('{"doc":73,"name":"error-report.pdf"}'), structuredContent: { doc: 73, name: 'error-report.pdf' },
      })
      return JSON.stringify(success(name.endsWith('_text_extract')
        ? 'This error report describes blocked requests and failed retries.'
        : 'Saved error-report.pdf. No error occurred.'))
    } } })
  assert.equal(calls.length, 3)
  assert.equal(receipts.length, 3)
  assert.match(receipts[1].result.content[0].text, /error.*blocked.*failed/)
  assert.match(receipts[2].result.content[0].text, /error-report\.pdf/)
})

test('explicit failed tool envelopes stop the graph even if their prose claims success', async () => {
  for (const failure of [{ isError: true }, { executed: false }, { status: 'failed' }]) {
    let calls = 0
    const result = { ...success('The document was saved successfully.'), structuredContent: { doc: 73 }, ...failure }
    await assert.rejects(dispatchNeuraleseArtCraftPlan({ plan: accept(), goal, tools: { definitions,
      async call() { calls++; return JSON.stringify(result) } } }), /ArtCraft stopped at artcraft_pdfcraft_doc_open/)
    assert.equal(calls, 1, 'no dependent extraction or save runs after an explicit failure')
  }
})

test('malformed envelopes cannot be accepted as successful operations without references', async () => {
  const badResults = [
    {}, { content: [] }, { isError: 'false', content: [] }, { isError: 0, content: [] },
    { isError: false }, { isError: false, content: 'Saved.' },
    { isError: false, content: [null] }, { isError: false, content: [{}] },
    { isError: false, content: [{ type: 'text', text: 42 }] },
    { isError: false, content: [{ type: 'image' }] },
    { ...success('Saved.'), structuredContent: [] },
    { ...success('Saved.'), executed: 'false' },
    { ...success('Saved.'), truncated: 'false' },
  ]
  for (const result of badResults) {
    const value = proposal(); value.nodes = value.nodes.slice(0, 1)
    let calls = 0
    await assert.rejects(dispatchNeuraleseArtCraftPlan({ plan: accept(value), goal, tools: { definitions,
      async call() { calls++; return JSON.stringify(result) } } }), /malformed ArtCraft result envelope/)
    assert.equal(calls, 1)
  }
})
