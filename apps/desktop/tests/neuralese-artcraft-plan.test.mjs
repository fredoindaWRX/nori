import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  acceptNeuraleseArtCraftPlan,
  createNeuraleseArtCraftToolAdapter,
  dispatchNeuraleseArtCraftPlan,
  neuraleseArtCraftIngress,
  neuraleseArtCraftSystemPrompt,
  summarizeNeuraleseArtCraftReceipts,
  translateNeuraleseArtCraftActions,
  NEURALESE_ARTCRAFT_FRAME_SCHEMA,
  NEURALESE_ARTCRAFT_PLAN_SCHEMA,
} from '../bridge/neuralese-artcraft-plan.mjs'
import { repairNeuraleseArtCraftSlotLabels } from '../bridge/neuralese-artcraft-slot-repair.mjs'
import { callThroughNeuralese } from '../bridge/neuralese-project-tools.mjs'

const definitions = [
  { type: 'function', function: { name: 'artcraft_wordcraft_new_document',
    description: 'Create a new document.', strict: false,
    parameters: { type: 'object', additionalProperties: false,
      properties: { title: { type: 'string', minLength: 1, maxLength: 80 }, format: { type: 'string', enum: ['docx'] } },
      required: ['title', 'format'] } } },
  { type: 'function', function: { name: 'artcraft_wordcraft_type_text',
    description: 'Write text into the active document.', strict: false,
    parameters: { type: 'object', additionalProperties: false,
      properties: { text: { type: 'string', minLength: 1, maxLength: 2000 } }, required: ['text'] } } },
  { type: 'function', function: { name: 'artcraft_wordcraft_open_document',
    description: 'Open an existing document from the selected workspace.', strict: false,
    parameters: { type: 'object', additionalProperties: false,
      properties: { path: { type: 'string', minLength: 1, maxLength: 180 } }, required: ['path'] } } },
]

function opcode(name) {
  return Number.parseInt(createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 8), 16)
}

function plan(goal, nodes, status = 'complete', clarification = null) {
  return JSON.stringify({ schema: NEURALESE_ARTCRAFT_PLAN_SCHEMA, app_id: 'wordcraft', status, nodes, clarification })
}

function node(id, toolName, slots, depends_on = []) {
  return { id, opcode: opcode(toolName), slots, depends_on }
}

test('WordCraft creation-and-save plan cannot complete with only a blank document', async () => {
  const goal='Use WordCraft to create a document containing exactly this sentence: Nori local document proof 4827. Save it as proof.docx.'
  const catalog=[...definitions,{type:'function',function:{name:'artcraft_wordcraft_save_document',
    parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}}]
  const create=node('n0','artcraft_wordcraft_new_document',{0:'Proof',1:'docx'})
  const write=node('n1','artcraft_wordcraft_type_text',{0:'Nori local document proof 4827.'},['n0'])
  const save=node('n2','artcraft_wordcraft_save_document',{0:'proof.docx'},['n1'])
  const accept=nodes=>acceptNeuraleseArtCraftPlan({appId:'wordcraft',goal,definitions:catalog,output:plan(goal,nodes)})
  assert.throws(()=>accept([create]),/complete.*document|requested save/i)
  assert.throws(()=>accept([create,write]),/requested save/i)
  assert.throws(()=>accept([create,node('n1','artcraft_wordcraft_save_document',{0:'proof.docx'},['n0'])]),/document.*text/i)
  assert.throws(()=>accept([create,write,{...save,slots:{0:'other.docx'}}]),/filename/i)
  assert.equal(accept([create,write,save]).nodes.length,3)
  let invoked=0
  const adapter=createNeuraleseArtCraftToolAdapter({appId:'wordcraft',goal,tools:{definitions:catalog,
    call:async()=>{invoked++;return '{}'}}})
  await assert.rejects(adapter.call(adapter.definitions[0].function.name,JSON.parse(plan(goal,[create]))),/complete.*document|requested save/i)
  assert.equal(invoked,0)
})

test('compact Neuralese preserves nested command parameter contracts without inventing authority', () => {
  const schema = { type: 'object', additionalProperties: false, properties: {
    path: { type: 'string', enum: ['transform/position'] },
    value: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 3 },
  } }
  const definitions = [{ type: 'function', function: { name: 'artcraft_effectcraft_execute_command',
    parameters: { type: 'object', properties: { params: schema }, required: ['params'] } } }]
  const ingress = neuraleseArtCraftIngress({ appId: 'effectcraft', goal: 'Create an animation.', definitions, format: 'compact' })
  assert.deepEqual(ingress.opcodes[0].f[0].schema, schema)
  assert.equal(ingress.opcodes[0].name, 'artcraft_effectcraft_execute_command')
  assert.match(neuraleseArtCraftSystemPrompt({ appId: 'effectcraft', transport: 'tool-call' }), /depends_on/)
})

test('PhotoCraft repairs exact registered field labels to Neuralese slot IDs before dispatch', async () => {
  const name = 'artcraft_photocraft_doc_new'
  const goal = 'Use PhotoCraft to create a blank raster document 128 by 96 pixels.'
  const catalog = [{ type: 'function', function: { name, description: 'Create a blank raster document. Use PhotoCraft. Save requested work. ',
    parameters: { type: 'object', additionalProperties: false, properties: {
      width: { type: 'integer', minimum: 16, maximum: 8192 },
      height: { type: 'integer', minimum: 16, maximum: 8192 },
      mode: { type: 'string', enum: ['RGB', 'RGBA'] },
      depth: { type: 'integer', enum: [8, 16, 32] },
    }, required: ['width', 'height', 'mode', 'depth'] } } }]
  const action = node('n0', name, { width: 128, height: 96, mode: 'RGBA', depth: 8 })
  const output = JSON.stringify({ schema: NEURALESE_ARTCRAFT_PLAN_SCHEMA, app_id: 'photocraft',
    status: 'complete', nodes: [action], clarification: null })
  assert.throws(() => acceptNeuraleseArtCraftPlan({ output, appId: 'photocraft', goal, definitions: catalog }), /invalid slot id/)
  const plan = repairNeuraleseArtCraftSlotLabels({ output, appId: 'photocraft', goal, definitions: catalog })
  assert.deepEqual(plan.nodes[0].args, { width: 128, height: 96, mode: 'RGBA', depth: 8 })
  let dispatched = 0
  const receipts = await dispatchNeuraleseArtCraftPlan({ plan, goal, tools: { definitions: catalog,
    async call(tool, args) { dispatched++; assert.equal(tool, name); assert.deepEqual(args, plan.nodes[0].args)
      return JSON.stringify({ isError: false, content: [{ type: 'text', text: 'created blank raster' }] }) } },
    callIdFactory: () => 'photocraft-slot-repair-test' })
  assert.equal(dispatched, 1)
  assert.equal(receipts.length, 1)
})

test('Neuralese slot-label repair rejects unknown names and does not alter causal edges', () => {
  const name = 'artcraft_photocraft_doc_new'
  const goal = 'Use PhotoCraft to create a blank raster document 128 by 96 pixels.'
  const catalog = [{ type: 'function', function: { name, description: 'Create a blank raster document.',
    parameters: { type: 'object', properties: { width: { type: 'integer' } }, required: ['width'] } } }]
  const make = (slots, depends_on = []) => JSON.stringify({ schema: NEURALESE_ARTCRAFT_PLAN_SCHEMA,
    app_id: 'photocraft', status: 'complete', nodes: [node('n0', name, slots, depends_on)], clarification: null })
  assert.throws(() => repairNeuraleseArtCraftSlotLabels({ output: make({ widht: 128 }), appId: 'photocraft', goal, definitions: catalog }), /unknown or duplicate slot/)
  assert.throws(() => repairNeuraleseArtCraftSlotLabels({ output: make({ width: 128 }, ['n9']), appId: 'photocraft', goal, definitions: catalog }), /causal dependencies/)
})

test('DeckCraft guidance requires bare slide arrays and the host rejects wrapped slide values before dispatch', async () => {
  const name = 'artcraft_deckcraft_create_presentation'
  const goal = 'Use DeckCraft to create a presentation with exactly one slide. Its title must be Nori proof 4827 and its body must be Made locally. Save it as nori-acceptance.deckcraft.'
  const definitions = [{ type: 'function', function: { name, description: 'Create a text presentation. Save and verify it.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      slides: { type: 'array', minItems: 1, maxItems: 10, items: { type: 'object', additionalProperties: false,
        properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, body: { type: 'string', maxLength: 2000 } },
        required: ['title', 'body'] } },
      path: { type: 'string' },
    }, required: ['slides', 'path'] } } }]
  const ingress = neuraleseArtCraftIngress({ appId: 'deckcraft', goal, definitions, format: 'compact' })
  assert.equal(ingress.opcodes.find(item => item.name === name).f[0].t, 'array')
  assert.match(neuraleseArtCraftSystemPrompt({ appId: 'deckcraft', definitions, transport: 'tool-call' }), /bare JSON array.*not an object.*value/)
  assert.match(neuraleseArtCraftSystemPrompt({ appId: 'deckcraft', definitions }), /never wrap a slot value in.*value/)
  const makeOutput = slides => JSON.stringify({ schema: NEURALESE_ARTCRAFT_PLAN_SCHEMA, app_id: 'deckcraft', status: 'complete',
    nodes: [node('n0', name, { 0: slides, 1: 'nori-acceptance.deckcraft' })], clarification: null })
  const wrapped = makeOutput({ value: [{ title: 'Nori proof 4827', body: 'Made locally' }] })
  assert.throws(() => acceptNeuraleseArtCraftPlan({ output: wrapped, appId: 'deckcraft', goal, definitions }), /wrong value type/)
  let dispatched = 0
  const adapter = createNeuraleseArtCraftToolAdapter({ appId: 'deckcraft', goal, tools: { definitions,
    async call() { dispatched++; return JSON.stringify({ isError: false, content: [{ type: 'text', text: 'saved' }] }) } } })
  await assert.rejects(adapter.call(adapter.definitions[0].function.name, JSON.parse(wrapped)), /wrong value type/)
  assert.equal(dispatched, 0)
  const valid = acceptNeuraleseArtCraftPlan({ output: makeOutput([{ title: 'Nori proof 4827', body: 'Made locally' }]),
    appId: 'deckcraft', goal, definitions })
  assert.deepEqual(valid.nodes[0].args, { slides: [{ title: 'Nori proof 4827', body: 'Made locally' }], path: 'nori-acceptance.deckcraft' })
})

test('Neuralese accepts registered JSON Schema union types and rejects values outside the union', () => {
  const name = 'artcraft_effectcraft_render_preview'
  const definitions = [{ type: 'function', function: { name,
    parameters: { type: 'object', properties: { comp: { type: ['integer', 'string'] } }, required: ['comp'] } } }]
  const output = comp => JSON.stringify({ schema: NEURALESE_ARTCRAFT_PLAN_SCHEMA, app_id: 'effectcraft',
    status: 'complete', nodes: [node('n0', name, { 0: comp })], clarification: null })
  for (const comp of [1, '1']) {
    assert.equal(acceptNeuraleseArtCraftPlan({ output: output(comp), appId: 'effectcraft',
      goal: 'Render a preview in EffectCraft.', definitions }).nodes[0].args.comp, comp)
  }
  for (const comp of [true, null, 1.5, {}, []]) {
    assert.throws(() => acceptNeuraleseArtCraftPlan({ output: output(comp), appId: 'effectcraft',
      goal: 'Render a preview in EffectCraft.', definitions }), /allowed value types/)
  }
})

test('new EffectCraft plans require a composition and layer before their dependent operations', () => {
  const open = 'artcraft_effectcraft_open_project', execute = 'artcraft_effectcraft_execute_command'
  const definitions = [
    { type: 'function', function: { name: open, parameters: { type: 'object', properties: { new: { type: 'boolean' } } } } },
    { type: 'function', function: { name: execute, parameters: { type: 'object', properties: { command: { type: 'string' }, params: {type:'object'} } } } },
  ]
  const accept = commands => acceptNeuraleseArtCraftPlan({ appId: 'effectcraft', goal: 'Create a composition with keyframes in EffectCraft.', definitions,
    output: JSON.stringify({schema:NEURALESE_ARTCRAFT_PLAN_SCHEMA,app_id:'effectcraft',status:'complete',clarification:null,
      nodes:[node('n0',open,{0:true}),...commands.map((command,index)=>node(`n${index+1}`,execute,{0:command,
        ...(command==='prop.addKey'?{1:{path:'transform/position',time:0,value:[1,2]}}:{})},[`n${index}`]))]}) })
  assert.throws(()=>accept(['shape.newShape']), /needs comp.new/)
  assert.throws(()=>accept(['comp.new','prop.addKey']), /needs a layer/)
  assert.equal(accept(['comp.new','shape.newShape','prop.addKey']).nodes.length,4)
  assert.match(neuraleseArtCraftSystemPrompt({appId:'effectcraft',transport:'tool-call'}), /NO composition until comp.new/)
})

test('Neuralese ingress binds the request digest and a bounded numeric tool catalog', () => {
  const goal = 'Use WordCraft to create a trip-planning document.'
  const ingress = neuraleseArtCraftIngress({ appId: 'wordcraft', goal, definitions })
  assert.equal(ingress.schema, 'nori.neuralese.artcraft-ingress.v1')
  assert.equal(ingress.target_slot, 'wordcraft')
  assert.equal(ingress.intent_cell, goal)
  assert.match(ingress.intent_sha256, /^[a-f0-9]{64}$/)
  assert.match(ingress.registry_sha256, /^[a-f0-9]{64}$/)
  assert.ok(ingress.opcodes.every(item => Number.isSafeInteger(item.opcode) && item.slots.every(slot => Number.isSafeInteger(slot.slot))))
  const prompt = neuraleseArtCraftSystemPrompt({ appId: 'wordcraft' })
  assert.match(prompt, /nori\.neuralese\.artcraft-plan\.v1/)
  assert.match(prompt, /app_id="wordcraft"/)
  assert.match(prompt, /slots maps decimal-string slot IDs to actual argument VALUES/)
  assert.match(prompt, /it is not policy/)
  const vectorPrompt = neuraleseArtCraftSystemPrompt({ appId: 'vectorcraft', definitions: [
    { type: 'function', function: { name: 'artcraft_vectorcraft_create_artwork' } },
  ] })
  assert.match(vectorPrompt, /VectorCraft slots: 0=complete SVG matching intent_cell/)
  assert.match(vectorPrompt, /exact requested relative \.svg filename/)
  assert.throws(() => neuraleseArtCraftSystemPrompt(), /exact active app ID/)
})

test('host accepts a schema-valid multi-step graph and binds its Neuralese frame', () => {
  const goal = 'Use WordCraft to create a trip-planning document and write the outline.'
  const output = plan(goal, [
    node('n0', 'artcraft_wordcraft_new_document', { 0: 'Trip Plan', 1: 'docx' }),
    node('n1', 'artcraft_wordcraft_type_text', { 0: 'Dates, lodging, and travel checklist.' }, ['n0']),
  ])
  const accepted = acceptNeuraleseArtCraftPlan({ output, appId: 'wordcraft', goal, definitions })
  assert.equal(accepted.status, 'complete')
  assert.equal(accepted.frame.schema, NEURALESE_ARTCRAFT_FRAME_SCHEMA)
  assert.equal(accepted.frame.execution_authorized, false)
  assert.equal(accepted.frame.provenance, 'nori_local_model_proposal')
  assert.match(accepted.frame.frame_sha256, /^[a-f0-9]{64}$/)
  assert.deepEqual(accepted.nodes.map(item => item.depends_on), [[], ['n0']])
  assert.deepEqual(accepted.nodes[0].args, { title: 'Trip Plan', format: 'docx' })
})

test('clarification is a valid zero-action Neuralese result', () => {
  const goal = 'Use WordCraft to create a document.'
  const accepted = acceptNeuraleseArtCraftPlan({
    output: plan(goal, [], 'clarify', 'What should the document be about?'), appId: 'wordcraft', goal, definitions,
  })
  assert.equal(accepted.status, 'clarify')
  assert.match(accepted.clarification, /document be about/)
  assert.deepEqual(accepted.nodes, [])
})

test('host safely accepts one fenced JSON plan only after normal schema validation', () => {
  const goal = 'Use WordCraft to create a trip-planning document.'
  const output = `\`\`\`json\n${plan(goal, [node('n0', 'artcraft_wordcraft_new_document', { 0: 'Trip Plan', 1: 'docx' })])}\n\`\`\``
  const accepted = acceptNeuraleseArtCraftPlan({ output, appId: 'wordcraft', goal, definitions })
  assert.equal(accepted.nodes[0].args.title, 'Trip Plan')
  const withPreamble = acceptNeuraleseArtCraftPlan({ output: `Model answer:\n${output}\nEnd.`, appId: 'wordcraft', goal, definitions })
  assert.equal(withPreamble.nodes[0].args.title, 'Trip Plan')
  assert.throws(() => acceptNeuraleseArtCraftPlan({ output: `${output}\n${output}`, appId: 'wordcraft', goal, definitions }), /strict Neuralese JSON/)
})

test('VectorCraft host validation enforces explicit dimensions, shapes, colors, and filename', () => {
  const vectorDefinitions = [{ type: 'function', function: { name: 'artcraft_vectorcraft_create_artwork',
    parameters: { type: 'object', additionalProperties: false, properties: {
      svg: { type: 'string' }, path: { type: 'string' },
    }, required: ['svg', 'path'] } } }]
  const goal = 'Create a 240x160 SVG with a dark blue rectangle and gold circle, and save it as test.svg.'
  const svg = "<svg xmlns='http://www.w3.org/2000/svg' width='240' height='160'><rect width='240' height='160' fill='darkblue'/><circle cx='120' cy='80' r='30' fill='gold'/></svg>"
  const valid = JSON.stringify({ schema: NEURALESE_ARTCRAFT_PLAN_SCHEMA, app_id: 'vectorcraft', status: 'complete',
    nodes: [{ id: 'n0', opcode: opcode('artcraft_vectorcraft_create_artwork'), slots: { 0: svg, 1: 'test.svg' }, depends_on: [] }], clarification: null })
  assert.equal(acceptNeuraleseArtCraftPlan({ output: valid, appId: 'vectorcraft', goal, definitions: vectorDefinitions }).status, 'complete')
  for (const badSvg of [svg.replace('240', '64'), svg.replace('<circle', '<ellipse'), svg.replace('darkblue', 'red')]) {
    const bad = JSON.stringify({ schema: NEURALESE_ARTCRAFT_PLAN_SCHEMA, app_id: 'vectorcraft', status: 'complete',
      nodes: [{ id: 'n0', opcode: opcode('artcraft_vectorcraft_create_artwork'), slots: { 0: badSvg, 1: 'test.svg' }, depends_on: [] }], clarification: null })
    assert.throws(() => acceptNeuraleseArtCraftPlan({ output: bad, appId: 'vectorcraft', goal, definitions: vectorDefinitions }), /VectorCraft SVG/)
  }
})

test('Neuralese host translation repairs a bounded simple VectorCraft request without trusting model proposal fields', () => {
  const vectorDefinitions = [{ type: 'function', function: { name: 'artcraft_vectorcraft_create_artwork',
    parameters: { type: 'object', additionalProperties: false, properties: {
      svg: { type: 'string' }, path: { type: 'string' },
    }, required: ['svg', 'path'] } } }]
  const goal = 'Create a 240x160 SVG with a dark blue rectangle and gold circle, and save it as test.svg.'
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160"><rect x="6" y="6" width="228" height="148" fill="#00008b"/><circle cx="120" cy="80" r="32" fill="#ffd700"/></svg>'
  const translated = translateNeuraleseArtCraftActions({ appId: 'vectorcraft', goal,
    actions: [{ name: 'artcraft_vectorcraft_create_artwork', args: { svg, path: 'test.svg' } }],
    definitions: vectorDefinitions })
  assert.equal(translated.status, 'complete')
  assert.equal(translated.frame.provenance, 'nori_neuralese_host_translation')
  assert.equal(translated.frame.execution_authorized, false)
  assert.deepEqual(translated.nodes[0].args, { svg, path: 'test.svg' })
  assert.throws(() => translateNeuraleseArtCraftActions({ appId: 'vectorcraft', goal,
    actions: [{ name: 'artcraft_vectorcraft_create_artwork', args: { svg: '<svg/>', path: 'elsewhere.svg' } }],
    definitions: vectorDefinitions }), /dimensions|filename|rectangle|circle/i)
  assert.throws(() => translateNeuraleseArtCraftActions({ appId: 'vectorcraft', goal,
    actions: [{ name: 'run_shell', args: { command: 'no' } }], definitions: vectorDefinitions }), /cannot invent an app operation/)
})

test('strong-model planner adapter accepts only a Neuralese frame and dispatches through the app broker', async () => {
  const goal = 'Use WordCraft to create a trip-planning document.'
  const toolCalls = []
  const appTools = { definitions, async call(name, args) {
    toolCalls.push({ name, args })
    return JSON.stringify({ isError: false, content: [{ type: 'text', text: 'Created and saved outputs/trip-plan.docx.' }] })
  } }
  const adapter = createNeuraleseArtCraftToolAdapter({ appId: 'wordcraft', goal, tools: appTools })
  const action = node('n0', 'artcraft_wordcraft_new_document', { 0: 'Trip Plan', 1: 'docx' })
  const proposal = { schema: NEURALESE_ARTCRAFT_PLAN_SCHEMA, app_id: 'wordcraft', status: 'complete',
    nodes: [action], clarification: null }
  const receipt = JSON.parse(await callThroughNeuralese(adapter,
    adapter.definitions[0].function.name, proposal, { maxBytes: 8192 }, 'model-plan-1', goal))
  assert.equal(receipt.isError, false)
  assert.match(receipt.content[0].text, /Neuralese-validated action/)
  assert.equal(toolCalls.length, 1)
  assert.deepEqual(toolCalls[0], { name: 'artcraft_wordcraft_new_document', args: { title: 'Trip Plan', format: 'docx' } })
  const duplicate = JSON.parse(await callThroughNeuralese(adapter,
    adapter.definitions[0].function.name, proposal, { maxBytes: 8192 }, 'model-plan-2', goal))
  assert.equal(duplicate.executed, false)
  assert.equal(toolCalls.length, 1)
})

test('host rejects malformed, cross-app, unregistered, and schema-invalid proposals', () => {
  const goal = 'Use WordCraft to create a trip-planning document.'
  const valid = node('n0', 'artcraft_wordcraft_new_document', { 0: 'Trip Plan', 1: 'docx' })
  const cases = [
    ['not JSON', '{'],
    ['unknown app', JSON.stringify({ schema: NEURALESE_ARTCRAFT_PLAN_SCHEMA, app_id: 'gridcraft', status: 'complete', nodes: [valid], clarification: null })],
    ['unknown opcode', plan(goal, [{ ...valid, opcode: 17 }])],
    ['missing required slot', plan(goal, [node('n0', 'artcraft_wordcraft_new_document', { 0: 'Trip Plan' })])],
    ['wrong slot type', plan(goal, [node('n0', 'artcraft_wordcraft_new_document', { 0: 14, 1: 'docx' })])],
    ['broken causal edge', plan(goal, [valid, node('n1', 'artcraft_wordcraft_type_text', { 0: 'Outline' })])],
    ['extra root field', JSON.stringify({ schema: NEURALESE_ARTCRAFT_PLAN_SCHEMA, app_id: 'wordcraft', status: 'complete', nodes: [valid], clarification: null, override: true })],
  ]
  for (const [label, output] of cases) {
    assert.throws(() => acceptNeuraleseArtCraftPlan({ output, appId: 'wordcraft', goal, definitions }), undefined, label)
  }
})

test('read-only opens are accepted while a read-only request cannot dispatch a mutating operation', () => {
  const goal = 'Use WordCraft to open and inspect an existing document.'
  const read = acceptNeuraleseArtCraftPlan({
    output: plan(goal, [node('n0', 'artcraft_wordcraft_open_document', { 0: 'inputs/notes.docx' })]),
    appId: 'wordcraft', goal, definitions,
  })
  assert.equal(read.nodes[0].name, 'artcraft_wordcraft_open_document')
  assert.throws(() => acceptNeuraleseArtCraftPlan({
    output: plan(goal, [node('n0', 'artcraft_wordcraft_new_document', { 0: 'Trip Plan', 1: 'docx' })]),
    appId: 'wordcraft', goal, definitions,
  }), /read-only ArtCraft request/)
})

test('validated plans pass through Neuralese dispatch and summarize actual tool receipts', async () => {
  const goal = 'Use WordCraft to create a trip-planning document.'
  const accepted = acceptNeuraleseArtCraftPlan({
    output: plan(goal, [node('n0', 'artcraft_wordcraft_new_document', { 0: 'Trip Plan', 1: 'docx' })]),
    appId: 'wordcraft', goal, definitions,
  })
  const calls = []
  const tools = { definitions, async call(name, args) {
    calls.push({ name, args })
    return JSON.stringify({ isError: false, content: [{ type: 'text', text: 'Document created and saved in outputs/trip-plan.docx.' }] })
  } }
  const receipts = await dispatchNeuraleseArtCraftPlan({ plan: accepted, tools, goal })
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].args, { title: 'Trip Plan', format: 'docx' })
  assert.match(summarizeNeuraleseArtCraftReceipts('wordcraft', receipts), /Neuralese-validated action/)
  assert.throws(() => summarizeNeuraleseArtCraftReceipts('wordcraft', []), /at least one tool receipt/)
})
