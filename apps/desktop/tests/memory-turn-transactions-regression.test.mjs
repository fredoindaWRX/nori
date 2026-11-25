import test from 'node:test'
import assert from 'node:assert/strict'
import { memoryFixture, queryFixture, firstDelta } from './fixtures/memory-turn-transaction-vm.mjs'

function memoryQueryWithClaimingModel(memory) {
  const models = [], no = () => false
  const q = queryFixture({ memory, globals: {
    requestsComputerControl: no, isImageCapabilityQuestion: no, isVideoCapabilityQuestion: no,
    isAiderCapabilityQuestion: no, requestsNoriProjectRead: no, requestsBrowserControl: no, requestsSystemCommand: no,
    requestsNetworkWatch: no, requestsHue: no, requestsWeather: no, chooseToolIntent: async () => null,
    resolveCinematicVideoRequest: () => null, resolveVideoRequest: () => null,
    selfQuery: no, asksAboutSelf: no, selfKnowledgeContext: goal => ({ goal, background: '' }),
    recalledResearchContext: async () => ({ context: '' }),
    localChat: async function* (request) { models.push(request.goal); yield 'I saved that and will remember it next time.' },
  } })
  return { ...q, models }
}

for (const failure of ['failWrite', 'failRename']) {
  for (const input of ['My name is Synthetic Rejected', 'Clear everything you learned']) {
    test(`${failure}: failed name or clear transaction preserves memory and recovers: ${input}`, async () => {
      const memory = memoryFixture()
      memory.api.learnFromUserText('My name is Synthetic Preserved')
      memory.api.learnFromUserText('Always keep synthetic examples concise')
      const diskBefore = memory.disk.get(memory.file)
      const cacheBefore = JSON.stringify(memory.api.listLearnedMemory())
      const contextBefore = memory.api.learnedContext()
      memory.state[failure] = true
      const fixture = memoryQueryWithClaimingModel(memory), failedEvents = []
      for await (const event of fixture.create(input, { getModel: () => 'synthetic-model' })) failedEvents.push(event)
      assert.equal(failedEvents.at(-1).error_code, 'NORI_MEMORY_SAVE_FAILED')
      assert.equal(failedEvents.some(event => event.subtype === 'success'), false)
      assert.equal(fixture.models.length, 0)
      assert.equal(fixture.updates.length, 0)
      assert.equal(fixture.experiences.length, 0)
      assert.equal(memory.disk.get(memory.file), diskBefore)
      assert.equal(JSON.stringify(memory.api.listLearnedMemory()), cacheBefore)
      assert.equal(memory.api.learnedContext(), contextBefore)

      memory.state[failure] = false
      const recoveredEvents = []
      for await (const event of fixture.create('My name is Synthetic Recovered')) recoveredEvents.push(event)
      assert.equal(recoveredEvents.at(-1).subtype, 'success')
      assert.match(recoveredEvents.at(-1).result, /Synthetic Recovered/)
      assert.equal(fixture.models.length, 0)
      assert.equal(fixture.updates.length, 1)
      assert.doesNotMatch(JSON.stringify(fixture.updates), /Synthetic Rejected|Clear everything/)
      const restored = memory.restart().api.listLearnedMemory()
      assert.equal(restored.counts.preferences, 1)
      assert.match(JSON.stringify(restored), /Synthetic Recovered/)
      assert.doesNotMatch(JSON.stringify(restored), /Synthetic Rejected/)
    })
  }
}

for (const failure of ['failWrite', 'failRename']) {
  for (const input of ['Always answer synthetic examples clearly', 'Remember that the synthetic workshop is orange']) {
    test(`${failure}: failed memory save must not be acknowledged by model inference: ${input}`, async () => {
      const memory = memoryFixture()
      memory.api.learnFromUserText('Remember that the synthetic workshop is blue')
      const before = memory.disk.get(memory.file)
      memory.state[failure] = true
      const q = memoryQueryWithClaimingModel(memory), events = []
      for await (const event of q.create(input, { getModel: () => 'synthetic-model' })) events.push(event)
      assert.equal(events.at(-1).error_code, 'NORI_MEMORY_SAVE_FAILED')
      assert.equal(events.some(event => event.subtype === 'success'), false)
      assert.equal(q.models.length, 0)
      assert.equal(q.updates.length, 0)
      assert.equal(memory.disk.get(memory.file), before)
      assert.match(events.filter(event => event.type === 'stream_event').map(event => event.event.delta.text).join(''), /could not save/i)
      assert.equal(memory.api.listLearnedMemory().entries.length, 1)
    })
  }
}

for (const input of ['Always answer synthetic examples clearly', 'Remember that the synthetic workshop is orange']) {
  test(`successful memory save still survives query acknowledgement and restart: ${input}`, async () => {
    const memory = memoryFixture(), q = memoryQueryWithClaimingModel(memory), events = []
    for await (const event of q.create(input, { getModel: () => 'synthetic-model' })) events.push(event)
    assert.equal(events.at(-1).subtype, 'success')
    assert.equal(memory.restart().api.listLearnedMemory().entries.length, 1)
    assert.match(memory.restart().api.listLearnedMemory().entries[0].text, /synthetic/)
  })
}

for (const mode of ['interrupt', 'close']) {
  test(`${mode} during failed-save reply cannot create success or conversation history`, async () => {
    const memory = memoryFixture()
    memory.state.failWrite = true
    const q = memoryQueryWithClaimingModel(memory), stream = q.create('Always answer synthetic examples clearly', { getModel: () => 'synthetic-model' })
    await firstDelta(stream)
    if (mode === 'interrupt') await stream.interrupt()
    else stream.close()
    const rest = []
    for await (const event of stream) rest.push(event)
    assert.equal(rest.some(event => event.subtype === 'success'), false)
    assert.equal(q.models.length, 0)
    assert.equal(q.updates.length, 0)
    assert.equal(memory.api.listLearnedMemory().entries.length, 0)
  })
}

test('a failed memory save does not poison the next successful preference turn', async () => {
  const memory = memoryFixture(), q = memoryQueryWithClaimingModel(memory), events = []
  memory.state.failRename = true
  const stream = q.create(['Remember that the synthetic workshop is orange', 'Always keep synthetic examples concise'], { getModel: () => 'synthetic-model' })
  for await (const event of stream) {
    events.push(event)
    if (event.error_code === 'NORI_MEMORY_SAVE_FAILED') memory.state.failRename = false
  }
  assert.equal(events.filter(event => event.error_code === 'NORI_MEMORY_SAVE_FAILED').length, 1)
  assert.equal(events.filter(event => event.subtype === 'success').length, 1)
  assert.equal(q.models.length, 0)
  assert.equal(q.updates.length, 1)
  assert.doesNotMatch(JSON.stringify(q.updates), /orange/)
  assert.equal(memory.restart().api.listLearnedMemory().entries.length, 1)
  assert.match(memory.restart().api.listLearnedMemory().entries[0].text, /concise/)
})

test('an explicit action after a direct preference is routed and not stored as a permanent action', async () => {
  const memory = memoryFixture(), q = memoryQueryWithClaimingModel(memory), input = 'Always keep replies concise, then open WordCraft'
  const events = []
  for await (const event of q.create(input, { getModel: () => 'synthetic-model' })) events.push(event)
  assert.equal(q.models.length, 1, 'The action must reach normal orchestration rather than a memory-only acknowledgement')
  assert.match(q.models[0], /then open WordCraft/)
  assert.equal(events.at(-1).subtype, 'success')
  assert.equal(memory.api.listLearnedMemory().entries[0].text, 'Always keep replies concise')
})

for (const input of ['"Always answer synthetic examples clearly"', 'The attached text says: Always answer synthetic examples clearly']) {
  test(`untrusted preference reference cannot authorize durable memory: ${input}`, () => {
    const memory = memoryFixture()
    assert.equal(memory.api.learnFromUserText(input).kind, 'none')
    assert.equal(memory.api.listLearnedMemory().entries.length, 0)
    assert.equal(memory.state.commits, 0)
  })
}

for (const input of ['Nori should always keep synthetic results clear', 'Nori must remember synthetic preferences', 'Nori, please always keep synthetic examples brief', 'Please from now on keep synthetic results clear']) {
  test(`direct addressed preference wording remains supported: ${input}`, () => {
    const memory = memoryFixture()
    assert.equal(memory.api.learnFromUserText(input).kind, 'preference')
    assert.equal(memory.restart().api.listLearnedMemory().counts.preferences, 1)
  })
}

test('host invalidation during history callback prevents any later journal write or success', async () => {
  let active = true
  const memory = memoryFixture()
  const q = queryFixture({ memory, active: () => active })
  const stream = q.create('My name is Synthetic Tester', { onConversationUpdate: () => { active = false } })
  const events = []
  for await (const event of stream) events.push(event)
  assert.equal(events.some(event => event.subtype === 'success'), false)
  assert.equal(q.experiences.length, 0)
})

test('failed semantic memory read cannot leak its answer or poison the following name lookup', async () => {
  const memory = memoryFixture()
  memory.api.learnFromUserText('My name is Synthetic Tester')
  const q = queryFixture({ memory, globals: { semanticMemorySearchIntent: goal => goal.startsWith('Search') ? 'synthetic' : null } })
  const stream = q.create(['Search my saved memory for synthetic', 'whats my name'], {
    searchSemanticMemory: async () => { throw Error('Synthetic read failure') },
  })
  const events = []
  for await (const event of stream) events.push(event)
  assert.equal(events.filter(event => event.error_code === 'NORI_SEMANTIC_MEMORY_UNAVAILABLE').length, 1)
  const success = events.filter(event => event.subtype === 'success')
  assert.equal(success.length, 1)
  assert.match(success[0].result, /Synthetic Tester/)
  assert.equal(q.updates.length, 1)
  assert.doesNotMatch(JSON.stringify(q.updates), /Synthetic read failure|Search my saved/)
})

for (const [request, scope] of [
  ['Nori, please clear all my saved preferences.', 'preferences'],
  ['Delete saved corrections!', 'feedback'],
  ['Forget remembered knowledge.', 'knowledge'],
  ["Please forget everything you've learned.", 'all'],
]) {
  test(`affirmative scoped deletion survives restart: ${request}`, () => {
    const f = memoryFixture()
    f.api.learnFromUserText('My name is Synthetic Tester')
    f.api.learnFromUserText('Always show synthetic results')
    f.api.learnFromUserText('No, I meant a synthetic green result')
    assert.equal(f.api.listLearnedMemory().entries.length, 3)
    const result = f.api.learnFromUserText(request)
    assert.equal(result.kind, 'cleared')
    assert.equal(result.saved, true)
    assert.equal(result.scope ?? 'all', scope)
    const counts = f.restart().api.listLearnedMemory().counts
    for (const kind of ['knowledge', 'preferences', 'feedback']) {
      assert.equal(counts[kind], scope === 'all' || scope === kind ? 0 : 1)
    }
  })
}

for (const mode of ['interrupt', 'close', 'superseded']) {
  for (const input of ['My name is Synthetic Cancelled', 'Always show synthetic output clearly', 'Clear everything you learned']) {
    test(`${mode} during context must precede any memory mutation: ${input}`, async () => {
      let release, entered, active = true
      const context = new Promise(resolve => { release = resolve })
      const started = new Promise(resolve => { entered = resolve })
      const memory = memoryFixture()
      memory.api.learnFromUserText('My name is Synthetic Preserved')
      const before = memory.disk.get(memory.file)
      const q = queryFixture({ memory, active: () => active, contextHook: async () => { entered(); await context; return '' } })
      const stream = q.create(input)
      await stream.next()
      const pending = stream.next()
      await started
      if (mode === 'interrupt') await stream.interrupt()
      else if (mode === 'close') stream.close()
      else active = false
      release()
      const first = await pending, rest = []
      for await (const event of stream) rest.push(event)
      assert.equal(first.done, true)
      assert.equal(rest.length, 0)
      assert.equal(memory.disk.get(memory.file), before)
      assert.equal(q.updates.length, 0)
    })
  }
}

test('interrupt during context suppresses abandoned learning and preserves the next prompt', async () => {
  let release, entered, calls = 0
  const context = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const memory = memoryFixture()
  const q = queryFixture({ memory, contextHook: async () => {
    if (calls++ === 0) { entered(); await context }
    return ''
  } })
  const stream = q.create(['My name is Synthetic Cancelled', 'My name is Synthetic Kept'])
  await stream.next()
  const pending = stream.next()
  await started
  await stream.interrupt()
  release()
  assert.match(JSON.stringify((await pending).value), /Synthetic Kept/)
  const rest = []
  for await (const event of stream) rest.push(event)
  assert.equal(rest.filter(event => event.subtype === 'success').length, 1)
  assert.equal(q.updates.length, 1)
  assert.equal(memory.api.listLearnedMemory().entries.length, 1)
  assert.match(memory.api.listLearnedMemory().entries[0].text, /Synthetic Kept/)
  assert.doesNotMatch(JSON.stringify(q.updates), /Synthetic Cancelled/)
})

for (const mode of ['interrupt', 'close', 'superseded']) {
  test(`${mode} after a semantic memory read delta cannot report/save a successful reply`, async () => {
    let active = true
    const memory = memoryFixture()
    memory.api.learnFromUserText('Remember that the synthetic workshop is blue')
    const q = queryFixture({ memory, active: () => active, globals: { semanticMemorySearchIntent: () => 'synthetic workshop' } })
    const stream = q.create('Search my saved memory for the synthetic workshop', {
      searchSemanticMemory: async () => ({ searchedEntries: 1, matches: [{ text: 'The synthetic workshop is blue' }] }),
    })
    await firstDelta(stream)
    assert.equal(q.updates.length, 0)
    if (mode === 'interrupt') await stream.interrupt()
    else if (mode === 'close') stream.close()
    else active = false
    const rest = []
    for await (const event of stream) rest.push(event)
    assert.equal(rest.some(event => event.subtype === 'success'), false)
    assert.equal(q.updates.length, 0)
    assert.equal(memory.api.listLearnedMemory().entries.length, 1)
  })
}


for (const version of ['source']) {
  for (const [label, text] of [['name lookup', 'whats my name'], ['preference acknowledgement', 'Always answer synthetic examples concisely'], ['forget acknowledgement', 'Clear everything you learned']]) {
    test(`${version}: interrupting ${label} after its delta cannot commit a successful conversation reply`, async () => {
      const memory = memoryFixture({ version }), fixture = queryFixture({ version, memory })
      const stream = fixture.create(text)
      await firstDelta(stream)
      await stream.interrupt()
      const rest = []; for await (const event of stream) rest.push(event)
      assert.equal(rest.some(event => event.type === 'result' && event.subtype === 'success'), false)
      assert.equal(fixture.updates.length, 0)
    })
  }

  test(`${version}: closing during asynchronous context preparation cannot save a new name afterward`, async () => {
    let release, entered
    const started = new Promise(resolve => { entered = resolve })
    const gate = new Promise(resolve => { release = resolve })
    const memory = memoryFixture({ version }), fixture = queryFixture({ version, memory, contextHook: async () => { entered(); await gate; return '' } })
    const stream = fixture.create('My name is Synthetic Tester')
    await stream.next()
    const pending = stream.next()
    await started
    stream.close()
    release()
    const first = await pending
    const rest = []; for await (const event of stream) rest.push(event)
    assert.equal(memory.api.listLearnedMemory().entries.length, 0)
    assert.equal(first.done, true)
    assert.equal(rest.length, 0)
    assert.equal(fixture.updates.length, 0)
  })
}


for (const version of ['source']) {
  for (const input of [
    'Do not delete learned preferences.',
    "Don't forget my saved preferences.",
    'How do I delete learned preferences?',
    'Please explain the phrase "clear saved preferences" without changing anything.',
  ]) {
    test(`${version}: non-authorizing text must not erase memory: ${input}`, () => {
      const f = memoryFixture({ version })
      f.api.learnFromUserText('My name is Synthetic Tester')
      f.api.learnFromUserText('Always show synthetic test results clearly')
      const bytes = f.disk.get(f.file)
      const before = f.api.listLearnedMemory().entries.length
      f.api.learnFromUserText(input)
      assert.equal(f.api.listLearnedMemory().entries.length >= before, true)
      assert.notEqual(f.disk.get(f.file), JSON.stringify({ schema: 'nori.learned-guidance.v2', knowledge: [], preferences: [], feedback: [] }, null, 2))
      // The name must remain authoritative even if the sentence legitimately
      // becomes an additional preference/correction.
      assert.ok(f.api.listLearnedMemory().entries.some(entry => entry.text === 'User-provided name: Synthetic Tester'))
      assert.ok(bytes)
    })
  }

  test(`${version}: clearing saved preferences must not silently delete saved knowledge`, () => {
    const f = memoryFixture({ version })
    f.api.learnFromUserText('My name is Synthetic Tester')
    f.api.learnFromUserText('Always show synthetic test results clearly')
    f.api.learnFromUserText('Clear saved preferences')
    assert.equal(f.api.listLearnedMemory().counts.preferences, 0)
    assert.equal(f.api.listLearnedMemory().counts.knowledge, 1)
  })
}


for (const version of ['source']) {
  test(`${version}: explicit write, restart, edit, delete and another restart retain the actual transaction state`, () => {
    const f = memoryFixture({ version })
    assert.equal(f.api.learnFromUserText('Remember that the synthetic workshop project is blue.').kind, 'knowledge')
    assert.equal(f.api.listLearnedMemory().entries.length, 1)
    const restarted = f.restart()
    const entry = restarted.api.listLearnedMemory().entries[0]
    assert.match(entry.text, /synthetic workshop/)
    restarted.api.editLearnedMemory(entry.id, 'The synthetic workshop project is green.')
    const afterEdit = restarted.restart()
    assert.match(afterEdit.api.listLearnedMemory().entries[0].text, /green/)
    afterEdit.api.deleteLearnedMemory(entry.id)
    assert.equal(afterEdit.restart().api.listLearnedMemory().entries.length, 0)
  })

  test(`${version}: failed add, edit, delete and clear preserve both previous cache and canonical bytes`, () => {
    const f = memoryFixture({ version })
    f.api.learnFromUserText('Remember that the synthetic workshop project is blue.')
    const before = f.disk.get(f.file), entry = f.api.listLearnedMemory().entries[0]
    f.state.failRename = true
    assert.equal(f.api.learnFromUserText('Remember that a second synthetic fact should fail.').kind, 'unsaved')
    assert.throws(() => f.api.editLearnedMemory(entry.id, 'A synthetic change that must not commit.'), /preserved/)
    assert.throws(() => f.api.deleteLearnedMemory(entry.id), /preserved/)
    const clear = f.api.learnFromUserText('Clear everything you learned')
    assert.equal(clear.saved, false)
    assert.equal(f.disk.get(f.file), before)
    assert.equal(f.api.listLearnedMemory().entries.length, 1)
    assert.equal(f.api.listLearnedMemory().entries[0].text, entry.text)
  })
}
