import test from 'node:test'
import assert from 'node:assert/strict'
import { agentToolLoop, toolCallLimit } from '../bridge/agent-loop.mjs'
import { composeToolUnion } from '../bridge/tool-registry.mjs'
import { PLAN_TOOL_NAME, hostPlan, multiStepRequest, planProblem, planReceipt, renderPlan } from '../bridge/work-plan.mjs'
import { stepLabel } from '../bridge/work-steps.mjs'

const definition = { type: 'function', function: { name: 'inspect', parameters: {
  type: 'object', properties: { item: { type: 'string' } }, required: ['item'], additionalProperties: false,
} } }
const toolCall = (id, name, args) => ({ index: 0, id, function: { name, arguments: JSON.stringify(args) } })
const response = delta => new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
const plan = statuses => ({ items: [
  { step: 'Inspect the engine log', status: statuses[0] },
  { step: 'Compare with last week', status: statuses[1] },
  { step: 'Write the summary', status: statuses[2] },
] })

async function run(replies, { browser = false, ask = 'Check the engine log against last week and summarise' } = {}) {
  const payloads = [], steps = [], invoked = []
  const families = [{ key: 'project', tools: { definitions: [definition], call: (_name, args) => { invoked.push(args.item); return JSON.stringify({ ok: true, item: args.item }) } } }]
  const tools = composeToolUnion(families)
  if (browser) tools.family = key => key === 'browser' ? {} : null
  let index = 0
  const fetcher = async (_url, options) => { payloads.push(JSON.parse(options.body)); return response(replies[Math.min(index++, replies.length - 1)]) }
  let text = ''
  for await (const part of agentToolLoop({ endpoint: 'http://127.0.0.1:1', modelId: 'test',
    messages: [{ role: 'system', content: 'Nori' }, { role: 'user', content: ask }],
    contextTokens: 65536, maxTokens: 1024, tools, fetcher, onKnight: event => { if (event?.step) steps.push(event.step) } })) text += part
  return { text, payloads, steps, invoked }
}

test('a multi-step tool turn writes a plan, works through it and shows the checklist live', async () => {
  const { text, payloads, steps, invoked } = await run([
    { tool_calls: [toolCall('p1', PLAN_TOOL_NAME, plan(['in_progress', 'pending', 'pending']))] },
    { tool_calls: [toolCall('t1', 'inspect', { item: 'engine log' })] },
    { tool_calls: [toolCall('p2', PLAN_TOOL_NAME, plan(['done', 'done', 'in_progress']))] },
    { tool_calls: [toolCall('p3', PLAN_TOOL_NAME, plan(['done', 'done', 'done']))] },
    { content: 'Summary: the log matches last week.' },
  ])
  assert.equal(text, 'Summary: the log matches last week.')
  assert.deepEqual(invoked, ['engine log'])
  // The model is told how to plan and is offered the plan tool next to its real tools.
  assert.match(payloads[0].messages[0].content, /Planning: when a request needs 3 or more tool steps/)
  assert.deepEqual(payloads[0].tools.map(tool => tool.function.name), ['inspect', PLAN_TOOL_NAME])
  // It reads back where it is in the plan.
  const receipt = payloads[1].messages.find(message => message.role === 'tool' && message.tool_call_id === 'p1')
  assert.equal(receipt.content, 'Plan saved: 0 of 3 steps done. Work on: Inspect the engine log. Call update_plan again when it is done.')
  // The owner sees each plan update as a "Plan" step with the checklist, and the real tool as its own step.
  const planEnds = steps.filter(step => step.tool === PLAN_TOOL_NAME && step.phase === 'end')
  assert.equal(planEnds.length, 3)
  assert.equal(planEnds[0].preview, '▶ Inspect the engine log\n☐ Compare with last week\n☐ Write the summary')
  assert.equal(planEnds[2].preview, '✔ Inspect the engine log\n✔ Compare with last week\n✔ Write the summary')
  assert.equal(steps.find(step => step.tool === PLAN_TOOL_NAME && step.phase === 'start').label, 'Plan')
  assert.equal(steps.filter(step => step.tool === 'inspect').length, 2)
})

test('a request that spells out its steps gets a host-written plan at once, checked off at the answer', async () => {
  const { text, payloads, steps, invoked } = await run([
    { tool_calls: [toolCall('t1', 'inspect', { item: 'log' })] },
    { content: 'All done.' },
  ], { ask: 'read the engine log, then compare it with last week, then write me a summary' })
  assert.equal(text, 'All done.')
  // No forced plan round: the real tools are offered from the first call.
  assert.deepEqual(payloads[0].tools.map(tool => tool.function.name), ['inspect', PLAN_TOOL_NAME])
  assert.equal(payloads[0].tool_choice, 'auto')
  assert.ok(payloads[0].messages[0].content.includes('Your plan for this request, already shown to the owner:\n1. Read the engine log\n2. Compare it with last week\n3. Write me a summary'))
  assert.deepEqual(invoked, ['log'])
  const plans = steps.filter(step => step.tool === PLAN_TOOL_NAME && step.phase === 'end').map(step => step.preview)
  assert.deepEqual(plans, ['▶ Read the engine log\n☐ Compare it with last week\n☐ Write me a summary',
    '✔ Read the engine log\n✔ Compare it with last week\n✔ Write me a summary'])
  assert.equal(steps.findIndex(step => step.tool === PLAN_TOOL_NAME) < steps.findIndex(step => step.tool === 'inspect'), true)
})

test('host plan parsing', () => {
  assert.deepEqual(hostPlan('search the web for the RTX 5080 power draw, then look up the RTX 4080 Super power draw, then tell me in two lines which uses less').map(item => item.step),
    ['Search the web for the RTX 5080 power draw', 'Look up the RTX 4080 Super power draw', 'Tell me in two lines which uses less'])
  assert.deepEqual(hostPlan('1. read the log\n2. compare\n3. summarise').map(item => item.step), ['Read the log', 'Compare', 'Summarise'])
  assert.equal(hostPlan('what is the weather today'), null)
  assert.equal(hostPlan('read the log then summarise'), null)
  assert.equal(hostPlan('first open the folder, then list it, then pick the biggest')[0].status, 'in_progress')
  assert.equal(multiStepRequest('read the log, then compare, then summarise'), true)
})

test('a bad plan is sent back to the model to fix and is never shown', async () => {
  const { text, payloads, steps } = await run([
    { tool_calls: [toolCall('p1', PLAN_TOOL_NAME, plan(['in_progress', 'in_progress', 'pending']))] },
    { content: 'Done.' },
  ])
  assert.equal(text, 'Done.')
  const error = payloads[1].messages.find(message => message.role === 'tool' && message.tool_call_id === 'p1')
  assert.match(error.content, /keep at most one step in_progress/)
  assert.equal(steps.filter(step => step.tool === PLAN_TOOL_NAME).length, 0)
})

test('browser turns and turns without tools get no plan tool', async () => {
  const { payloads } = await run([{ content: 'Hi.' }], { browser: true })
  assert.equal(payloads[0].tools.some(tool => tool.function.name === PLAN_TOOL_NAME), false)
  assert.doesNotMatch(payloads[0].messages[0].content, /Planning:/)
})

test('one tool is capped per request; the model is told to use what it has, and other tools still run', async () => {
  const replies = Array.from({ length: 6 }, (_, i) => ({ tool_calls: [toolCall(`t${i}`, 'inspect', { item: `try ${i}` })] }))
  const { text, payloads, invoked } = await run([...replies, { content: 'Best I could do.' }])
  assert.equal(text, 'Best I could do.')
  assert.equal(invoked.length, 5)
  const refusal = payloads[6].messages.find(message => message.role === 'tool' && message.tool_call_id === 't5')
  assert.match(JSON.parse(refusal.content).error, /"inspect" was already called 5 times in this request; that is the limit/)
  assert.equal(toolCallLimit('read_file'), 12)
  assert.equal(toolCallLimit('search_my_files'), 5)
})

test('plan helpers', () => {
  assert.equal(planProblem({ items: [{ step: 'a', status: 'done' }, { step: 'A', status: 'pending' }] }), 'two steps have the same description')
  assert.equal(planProblem({ items: [{ step: 'a', status: 'started' }] }), 'each status must be one of: pending, in_progress, done')
  assert.equal(planProblem({ items: [{ step: 'a', status: 'done' }] }), null)
  assert.equal(renderPlan([{ step: 'a', status: 'done' }, { step: 'b', status: 'pending' }]), '✔ a\n☐ b')
  assert.equal(planReceipt([{ step: 'a', status: 'done' }]), 'Plan saved: all 1 steps are done. Give the owner your final answer now.')
  assert.equal(stepLabel(PLAN_TOOL_NAME), 'Plan')
})
