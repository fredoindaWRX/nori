import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,dirname,resolve} from 'node:path'
import {
  ENGINE_CONTEXT_TOKENS, KV_SESSION_TOKENS, OUTPUT_RESERVE_TOKENS, PROMPT_BUDGET_TOKENS,
  SESSION_CAPACITY_TOKENS, PromptBudgetError, byteCount, fitPrompt, promptTokens, configuredModelPath,
} from '../bridge/context-budget.mjs'

// Injected counting keeps these regression tests on arithmetic, not on the
// machine's tokenizer. The framing matches tokenizer.hpp chat_prompt: one
// special token for each role word and one for the "\n\n" separator.
const framing = { system: 1, user: 1, assistant: 1, sep: 1 }
const countWords = text => {
  const trimmed = String(text).trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}
const options = { framing, countContent: countWords }
const sys = content => ({ role: 'system', content })
const user = content => ({ role: 'user', content })
const assistant = content => ({ role: 'assistant', content })
const turn = index => `turn ${index} ${'token '.repeat(400)}`

test('prompt counter resolves the selected model and rejects package escapes',async()=>{
  const root=await mkdtemp(join(tmpdir(),'Nori selected counter '))
  try{
    const runtime=join(root,'runtime','norllama');await mkdir(runtime,{recursive:true})
    await writeFile(join(root,'default.gguf'),'default fixture')
    await writeFile(join(root,'selected.gguf'),'selected fixture')
    await writeFile(join(runtime,'config.json'),JSON.stringify({model_path:'default.gguf'}))
    const selected=join(runtime,'selected.json')
    await writeFile(selected,JSON.stringify({model_path:'selected.gguf'}))
    assert.equal(await configuredModelPath(root),join(root,'default.gguf'))
    assert.equal(await configuredModelPath(root,selected),join(root,'selected.gguf'))
    await writeFile(selected,JSON.stringify({model_path:join(root,'selected.gguf')}))
    await assert.rejects(configuredModelPath(root,selected),/relative/)
    await writeFile(selected,JSON.stringify({model_path:'../outside.gguf'}))
    await assert.rejects(configuredModelPath(root,selected))
  }finally{
    assert.equal(resolve(dirname(root)),resolve(tmpdir()));await rm(root,{recursive:true,force:true})
  }
})

test('a conversation below the budget is sent untouched', async () => {
  const messages = [sys('You are Nori.'), user('Hello'), assistant('Hi there'), user('How are you?')]
  const result = await fitPrompt(messages, options)
  assert.equal(result.dropped, 0)
  assert.deepEqual(result.messages, messages)
  assert.ok(result.promptTokens <= PROMPT_BUDGET_TOKENS)
})

test('a conversation that exactly reaches the budget is still sent untouched', async () => {
  const messages = [sys('You are Nori.'), user('First question'), assistant('First answer'), user('Second question')]
  const exact = await promptTokens(messages, options)
  const atBudget = await fitPrompt(messages, { ...options, budget: exact })
  assert.equal(atBudget.dropped, 0)
  assert.deepEqual(atBudget.messages, messages)
  const overBudget = await fitPrompt(messages, { ...options, budget: exact - 1 })
  assert.equal(overBudget.dropped, 1)
  assert.ok(overBudget.promptTokens <= exact - 1)
})

test('an oversized history drops whole oldest turns first', async () => {
  const messages = [sys('You are Nori.'),
    ...Array.from({ length: 12 }, (_, index) => index % 2 ? assistant(turn(index)) : user(turn(index))),
    user('The newest question')]
  const result = await fitPrompt(messages, options)
  assert.ok(result.dropped > 0, 'history had to be trimmed')
  assert.ok(result.promptTokens <= PROMPT_BUDGET_TOKENS)
  const keptTexts = new Set(result.messages.map(message => message.content))
  assert.ok(!keptTexts.has(turn(0)), 'oldest turn was dropped')
  assert.ok(!keptTexts.has(turn(1)))
  assert.ok(keptTexts.has(turn(10)), 'a recent turn survives')
  const keptIndexes = []
  const droppedIndexes = []
  messages.forEach((message, index) => {
    if (index === 0 || index === messages.length - 1) return
    ;(keptTexts.has(message.content) ? keptIndexes : droppedIndexes).push(index)
  })
  assert.ok(keptIndexes.length >= 1)
  assert.ok(Math.min(...keptIndexes) > Math.max(...droppedIndexes),
    'kept turns form one contiguous window ending at the newest end')
})

test('the newest user turn is always preserved', async () => {
  const messages = [sys('You are Nori.'),
    ...Array.from({ length: 12 }, (_, index) => user(turn(index))),
    user('Hey Nori, are you working?')]
  const result = await fitPrompt(messages, options)
  assert.equal(result.messages.at(-1).content, 'Hey Nori, are you working?')
  assert.equal(result.messages.at(-1).role, 'user')
})

test('the verified 4096-token profile fits the former 3270-token system-plus-newest-turn case', async () => {
  const messages = [sys('S'.repeat(3000)), user('U'.repeat(200))]
  const result = await fitPrompt(messages)
  assert.equal(result.dropped, 0)
  assert.deepEqual(result.messages, messages)
  assert.ok(result.promptTokens > 2048)
  assert.ok(result.promptTokens <= PROMPT_BUDGET_TOKENS)
  assert.ok(result.promptTokens + OUTPUT_RESERVE_TOKENS <= SESSION_CAPACITY_TOKENS)
})

test('trimming never keeps an assistant answer after removing its user request', async () => {
  const messages = [sys('Nori'), user('Older request'), assistant('Older answer'), user('New request')]
  const result = await fitPrompt(messages, { ...options, budget: 23 })
  assert.deepEqual(result.messages, [messages[0], messages[3]])
  assert.equal(result.dropped, 1, 'one complete older turn was dropped')
  assert.equal(result.droppedMessages, 2)
  assert.ok(result.promptTokens <= 23)
})

test('message limit retains the newest complete exchange and drops older exchanges whole', async () => {
  const messages = [sys('Nori'), user('Older request'), assistant('Older answer'),
    user('Newest request'), assistant('Newest answer')]
  const result = await fitPrompt(messages, { ...options, maxMessages: 3 })
  assert.deepEqual(result.messages, [messages[0], messages[3], messages[4]])
  assert.equal(result.dropped, 1)
  assert.equal(result.droppedMessages, 2)
})

test('orphan assistant history is not retained without a user turn', async () => {
  const messages = [sys('Nori'), assistant('Unpaired old answer'), user('Current request')]
  const result = await fitPrompt(messages, options)
  assert.deepEqual(result.messages, [messages[0], messages[2]])
  assert.equal(result.droppedMessages, 1)
})

test('the system prompt is always preserved', async () => {
  const messages = [sys('You are Nori. System instructions live here.'),
    ...Array.from({ length: 12 }, (_, index) => assistant(turn(index))),
    user('Newest question')]
  const result = await fitPrompt(messages, options)
  assert.equal(result.messages[0].role, 'system')
  assert.match(result.messages[0].content, /System instructions/)
})

test('generation output keeps its reserved room outside the prompt budget', async () => {
  assert.equal(PROMPT_BUDGET_TOKENS + OUTPUT_RESERVE_TOKENS, SESSION_CAPACITY_TOKENS)
  assert.ok(SESSION_CAPACITY_TOKENS <= ENGINE_CONTEXT_TOKENS)
  assert.ok(SESSION_CAPACITY_TOKENS <= KV_SESSION_TOKENS)
  const messages = [sys('You are Nori.'),
    ...Array.from({ length: 12 }, (_, index) => user(turn(index))),
    user('Newest question')]
  const before = await promptTokens(messages, options)
  assert.ok(before > PROMPT_BUDGET_TOKENS)
  const result = await fitPrompt(messages, options)
  assert.ok(result.promptTokens <= PROMPT_BUDGET_TOKENS)
  assert.ok(result.promptTokens + OUTPUT_RESERVE_TOKENS <= SESSION_CAPACITY_TOKENS)
  assert.ok(result.promptTokens + OUTPUT_RESERVE_TOKENS <= ENGINE_CONTEXT_TOKENS)
})

test('a prompt that cannot fit fails with a bounded budget error instead of running', async () => {
  const messages = [sys('You are Nori.'), user('word '.repeat(5000))]
  await assert.rejects(() => fitPrompt(messages, options), error => {
    assert.ok(error instanceof PromptBudgetError)
    assert.match(error.message, /prompt budget exceeded/)
    assert.match(error.message, /system prompt and the newest message/)
    assert.ok(error.message.length <= 400, 'error text stays bounded')
    return true
  })
  await assert.rejects(() => fitPrompt([], options), PromptBudgetError)
  assert.ok(byteCount('astronaut') >= 9)
})
