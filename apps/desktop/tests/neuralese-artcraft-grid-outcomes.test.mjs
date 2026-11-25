import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { acceptNeuraleseArtCraftPlan, createNeuraleseArtCraftToolAdapter, dispatchNeuraleseArtCraftPlan,
  translateNeuraleseArtCraftActions, validateNeuraleseGridOutcome } from '../bridge/neuralese-artcraft-plan.mjs'

const definition = (name, properties, required = Object.keys(properties)) => ({ type: 'function',
  function: { name: `artcraft_gridcraft_${name}`, parameters: { type: 'object', properties, required, additionalProperties: false } } })
const text = { type: 'string' }
const definitions = [
  definition('new_workbook', { sample: text }, []), definition('open_workbook', { path: text }),
  definition('write_range', { range: text, values: { type: 'array' } }), definition('set_cell', { cell: text, input: text }),
  definition('read_range', { range: text }), definition('get_cell', { cell: text }),
  definition('inspect_workbook', {}), definition('save_workbook', { path: text }),
]
const action = (name, args = {}) => ({ name: `artcraft_gridcraft_${name}`, args })
const create = action('new_workbook')
const write = action('write_range', { range: 'A1:B2', values: [['Item', 'Value'], ['Nori proof', 7]] })
const read = action('read_range', { range: 'A1:B2' })
const save = action('save_workbook', { path: 'nori-grid-proof.xlsx' })
const goal = 'Use GridCraft to create an XLSX spreadsheet. Write A1:B1 Item/Value and A2:B2 Nori proof/7, read the cells back, and save as nori-grid-proof.xlsx.'
const literalGoal = 'Use GridCraft to create a spreadsheet, write A1:B2 = [["Item","Value"],["Nori proof",7]], read the cells back, and save as nori-grid-proof.xlsx.'
const accept = (actions, intent = goal) => translateNeuraleseArtCraftActions({ appId: 'gridcraft', goal: intent, actions, definitions })
function output(actions) {
  return { schema: 'nori.neuralese.artcraft-plan.v1', app_id: 'gridcraft', status: 'complete', clarification: null,
    nodes: actions.map((call, i) => {
      const properties = definitions.find(d => d.function.name === call.name).function.parameters.properties
      return { id: `n${i}`, opcode: Number.parseInt(createHash('sha256').update(call.name).digest('hex').slice(0, 8), 16),
        slots: Object.fromEntries(Object.entries(call.args).map(([key, value]) => [Object.keys(properties).indexOf(key), value])),
        depends_on: i ? [`n${i - 1}`] : [] }
    }) }
}

test('the reproduced new_workbook-only complete graph is rejected with zero dispatch', async () => {
  assert.throws(() => accept([create]), /requested write_range or set_cell/)
  let dispatched = 0
  const adapter = createNeuraleseArtCraftToolAdapter({ appId: 'gridcraft', goal,
    tools: { definitions, call: async () => { dispatched++; return '{}' } } })
  await assert.rejects(adapter.call(adapter.definitions[0].function.name, output([create])), /requested write_range or set_cell/)
  assert.equal(dispatched, 0)
})

test('complete create/write/read/save graph passes without acquiring execution authority', () => {
  for (const intent of [goal, literalGoal]) {
    const plan = accept([create, write, read, save], intent)
    assert.equal(plan.status, 'complete')
    assert.equal(plan.nodes.length, 4)
    assert.equal(plan.frame.execution_authorized, false)
  }
})

test('each explicitly requested operation must be present', () => {
  for (const [actions, message] of [
    [[write, read, save], /requested new_workbook/], [[create, read, save], /requested write_range/],
    [[create, write, save], /read_range or get_cell/], [[create, write, read], /requested save_workbook/],
    [[create, write, action('inspect_workbook'), save], /read_range or get_cell/],
  ]) assert.throws(() => accept(actions), message)
})

test('read and save cannot stand in for verification/persistence of a later write', () => {
  assert.throws(() => accept([create, read, write, save]), /after the final cell write/)
  assert.throws(() => accept([create, save, write, read]), /save_workbook after the final cell write/)
  // Readback may legitimately happen after saving, as long as both observe the final writes.
  assert.equal(accept([create, write, save, read]).status, 'complete')
})

test('a workbook reset cannot discard the requested writes and still complete', () => {
  assert.throws(() => accept([create, write, create, read, save]), /requested write_range/)
  assert.throws(() => accept([create, write, action('open_workbook', { path: 'other.xlsx' }), read, save]), /requested new_workbook/)
})

test('readback must cover all written cells; separate covering reads are valid', () => {
  assert.throws(() => accept([create, write, action('get_cell', { cell: 'A1' }), save]), /readback must cover/)
  assert.equal(accept([create, write, action('read_range', { range: 'A1:A2' }),
    action('read_range', { range: 'B1:B2' }), save]).status, 'complete')
  assert.throws(() => accept([create, write, action('read_range', { range: 'C1:C2' }), save]), /readback must cover/)
})

test('explicit write and read ranges cannot be replaced with unrelated cells', () => {
  assert.throws(() => accept([create, action('set_cell', { cell: 'A1', input: 'Item' }),
    action('get_cell', { cell: 'A1' }), save]), /writes must cover the explicitly requested/)
  assert.throws(() => accept([create, action('write_range', { range: 'C1:D2', values: write.args.values }),
    action('read_range', { range: 'C1:D2' }), save]), /writes must cover the explicitly requested/)
  assert.throws(() => accept([action('read_range', { range: 'C1:D2' })],
    'Use GridCraft to read A1:B2.'), /reads must cover the explicitly requested/)
})

test('a write request with several explicit ranges requires each range, not only the first', () => {
  const intent = 'Use GridCraft to write data into A1:A2 and C1:C2.'
  const first = action('write_range', { range: 'A1:A2', values: [['Item'], ['Nori proof']] })
  const second = action('write_range', { range: 'C1:C2', values: [['Value'], [7]] })
  assert.throws(() => accept([first], intent), /writes must cover the explicitly requested/)
  assert.equal(accept([first, second], intent).status, 'complete')
  assert.equal(accept([action('set_cell', { cell: 'A1', input: 'Item' })], 'Use GridCraft to write data into A1.').status, 'complete')
  assert.throws(() => accept([first], 'Use GridCraft to write values to $A$1 : $B$2.'), /writes must cover/)
  assert.throws(() => accept([first], 'Use GridCraft to write values to D4:A1.'), /unsupported or reversed/)
})

test('explicit XLSX filenames are exact, including case, and allow a bounded output subfolder', () => {
  for (const path of ['other.xlsx', 'Nori-grid-proof.xlsx', 'nori-grid-proof.xlsx.bak']) {
    assert.throws(() => accept([create, write, read, action('save_workbook', { path })]), /filename must be exactly/)
  }
  assert.equal(accept([create, write, read, action('save_workbook', { path: 'outputs/nori-grid-proof.xlsx' })]).status, 'complete')
  assert.equal(accept([create, action('save_workbook', { path: 'Quarterly Proof.xlsx' })],
    'Use GridCraft to create a blank workbook and save as "Quarterly Proof.xlsx".').status, 'complete')
  assert.throws(() => accept([create, action('save_workbook', { path: 'Wrong.xlsx' })],
    'Use GridCraft to create a blank workbook and save as `Quarterly Proof.xlsx`.'), /filename must be exactly/)
})

test('explicit JSON matrix content retains text case, values, and types', () => {
  for (const values of [[['Item', 'Value'], ['nori proof', 7]], [['Item', 'Value'], ['Nori proof', '7']],
    [['Item', 'Value'], ['Nori proof', 8]], [['Item', 'Value']]]) {
    assert.throws(() => accept([create, action('write_range', { range: 'A1:B2', values }), read, save], literalGoal), /exact case-sensitive values and types/)
  }
  assert.throws(() => accept([create, action('write_range', { range: 'C1:D2', values: write.args.values }),
    action('read_range', { range: 'C1:D2' }), save], literalGoal), /explicitly requested cell ranges/)
})

test('explicit matrix values can be supplied by individual cell writes', () => {
  const actions = [create, action('set_cell', { cell: 'A1', input: 'Item' }), action('set_cell', { cell: 'B1', input: 'Value' }),
    action('set_cell', { cell: 'A2', input: 'Nori proof' }), action('set_cell', { cell: 'B2', input: '7' }), read, save]
  assert.equal(accept(actions, literalGoal).status, 'complete')
  actions[3] = action('set_cell', { cell: 'A2', input: 'nori proof' })
  assert.throws(() => accept(actions, literalGoal), /exact case-sensitive values and types/)
})

test('the final cell value, not an overwritten earlier value, satisfies the literal contract', () => {
  assert.throws(() => accept([create, write, action('set_cell', { cell: 'B2', input: '9' }), read, save], literalGoal), /exact case-sensitive/)
})

test('explicit matrix parsing handles escaped quotes and brackets inside cell strings', () => {
  for (const content of ['A ]] "read and save"', 'write C1:D9 = [["not a command"]]']) {
    const values = [[content, 7]]
    const intent = `Use GridCraft to write A1:B1 = ${JSON.stringify(values)}.`
    assert.equal(accept([action('write_range', { range: 'A1:B1', values })], intent).status, 'complete')
  }
  assert.equal(accept([action('set_cell', { cell: 'A1', input: 'save workbook' })],
    "Use GridCraft to write 'save workbook' into A1.").status, 'complete')
})

test('malformed or dimension-mismatched explicit JSON requires clarification', () => {
  for (const data of ['[["Item"]]', '[["Item",]]', '[["Item","Value"],["Nori proof",7]']) {
    assert.throws(() => accept([write], `Use GridCraft to write A1:B2 = ${data}`), /rectangular JSON matrix/)
  }
})

test('empty cell-writing operations cannot satisfy a requested write', () => {
  for (const values of [[], [[]]]) assert.throws(() => accept([create,
    action('write_range', { range: 'A1:B2', values }), read, save]), /must contain the requested cell values/)
})

test('benign read-only and in-place edits do not require creation or unrequested save/read', () => {
  assert.equal(accept([read], 'Use GridCraft to read range A1:B2.').status, 'complete')
  assert.equal(accept([action('open_workbook', { path: 'existing.xlsx' }), read],
    'Use GridCraft to open "existing.xlsx" and read cells A1:B2.').status, 'complete')
  assert.equal(accept([write], 'Use GridCraft to write values into A1:B2 in the current workbook.').status, 'complete')
  assert.equal(accept([create], 'Use GridCraft to create an empty workbook.').status, 'complete')
})

test('explicitly reading a different cell or inspecting before editing is not mistaken for whole-write readback', () => {
  const writeA1 = action('set_cell', { cell: 'A1', input: 'Nori proof' })
  const readB1 = action('get_cell', { cell: 'B1' })
  assert.equal(accept([writeA1, readB1], 'Use GridCraft to write data into A1, then read B1.').status, 'complete')
  assert.equal(accept([readB1, writeA1], 'Use GridCraft to read B1, then write data into A1.').status, 'complete')
})

test('an explicit do-not-save permits in-place writes at the completion layer and rejects any save', () => {
  const intent = 'Use GridCraft to write values into A1:B2; do not save.'
  assert.doesNotThrow(() => validateNeuraleseGridOutcome([write], intent))
  assert.throws(() => validateNeuraleseGridOutcome([write, save], intent), /explicitly prohibited saving/)
  // Known conservative upstream limitation: app routing currently denies this
  // entire request before completion validation. Keep it visible, not reworded.
  assert.throws(() => accept([write], intent), /does not match the current user task/)
})

test('negated saving and quoted cell text cannot create a save obligation', () => {
  for (const negative of ["don't save", 'never save', 'without saving', 'avoid saving']) {
    const intent = `Use GridCraft to write A1:B1 = [["save the workbook","read the cells"]]; ${negative}.`
    const onlyWrite = action('write_range', { range: 'A1:B1', values: [['save the workbook', 'read the cells']] })
    assert.doesNotThrow(() => validateNeuraleseGridOutcome([onlyWrite], intent))
    assert.throws(() => validateNeuraleseGridOutcome([onlyWrite, save], intent), /explicitly prohibited saving/)
  }
})

test('write/read/save error envelopes stop dispatch and cannot produce completed output', async () => {
  for (const failedOperation of ['write_range', 'read_range', 'save_workbook']) {
    for (const failure of [{ isError: true }, { isError: false, executed: false }, { isError: false, status: 'failed' }]) {
      const called = [], plan = accept([create, write, read, save])
      await assert.rejects(dispatchNeuraleseArtCraftPlan({ plan, goal, tools: { definitions, call: async (name) => {
        called.push(name)
        const failed = name.endsWith(`_${failedOperation}`)
        return JSON.stringify({ isError: false, content: [{ type: 'text', text: 'Saved successfully.' }], ...(failed ? failure : {}) })
      } } }), /ArtCraft stopped/)
      assert.equal(called.at(-1), `artcraft_gridcraft_${failedOperation}`)
    }
  }
})

test('host-translated and model-proposed plans enforce the same completion check', () => {
  assert.throws(() => acceptNeuraleseArtCraftPlan({ appId: 'gridcraft', goal, definitions,
    output: JSON.stringify(output([create])) }), /requested write_range/)
})
