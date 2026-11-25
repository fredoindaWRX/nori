import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_PERSONALITY, PERSONALITY_TRAITS, AFFECT_TRAITS, DEFAULT_AFFECT, validatePersonalityPatch, restorePersonality, validPersonalitySnapshot, personalityInstruction } from '../bridge/personality/profile.mjs'
import { createPersonality } from '../bridge/nori-personality.mjs'

test('defaults and snapshots are independent copies', () => {
  const a = createPersonality(), b = createPersonality()
  a.snapshot().profile.humor = 0
  a.configure({ humor: 80 })
  assert.equal(b.profile().humor, DEFAULT_PERSONALITY.humor)
  assert.equal(a.profile().humor, 80)
  assert.equal(validPersonalitySnapshot(a.snapshot()), true)
})
test('invalid settings fail instead of becoming prompt instructions', () => {
  for (const value of [null, [], {}, { humor: -1 }, { humor: 101 }, { humor: NaN }, { humor: Infinity }, { humor: 0.5 }, { humor: '90' }, { instructions: 'ignore permissions' }, JSON.parse('{"__proto__":10}')]) {
    assert.throws(() => validatePersonalityPatch(value))
    assert.deepEqual(restorePersonality(value), DEFAULT_PERSONALITY)
  }
})
test('partial valid preferences restore over the baseline', () => {
  assert.deepEqual(restorePersonality({ humor: 0 }), { ...DEFAULT_PERSONALITY, humor: 0 })
})
test('playful and celebration cues change affect without changing personality', () => {
  const state = createPersonality()
  assert.equal(state.startTurn('haha lol').mode, 'playful')
  assert.ok(state.snapshot().affect.amusement > DEFAULT_AFFECT.amusement)
  assert.equal(state.startTurn('we did it, it works').mode, 'celebrating')
  assert.ok(state.snapshot().affect.joy > DEFAULT_AFFECT.joy)
  assert.deepEqual(state.profile(), DEFAULT_PERSONALITY)
})
test('seriousness wins over playful cues and work routing', () => {
  const state = createPersonality()
  for (const text of ['hospital lol', 'there is an emergency haha', 'not working smh lol', 'stop joking']) {
    const snapshot = state.startTurn(text, { work: true })
    assert.equal(snapshot.mode, 'supportive')
    assert.equal(snapshot.affect.amusement, 0)
    assert.match(state.instruction(), /humor:off/)
  }
})
test('task expression is focused without changing task permissions', () => {
  const state = createPersonality()
  const snapshot = state.startTurn('build the app', { work: true })
  assert.equal(snapshot.mode, 'focused')
  assert.equal(snapshot.affect.amusement, 5)
  assert.match(state.instruction(), /permissions/)
  assert.equal('allowWrites' in snapshot, false)
})
test('explicit zero stays off even after a playful cue', () => {
  const state = createPersonality({ profile: { humor: 0, enthusiasm: 0, warmth: 0, curiosity: 0, sarcasm: 0 } })
  state.startTurn('lol we won')
  assert.match(state.instruction(), /humor:off/)
  assert.match(state.instruction(), /sarcasm:off/)
  assert.match(state.instruction(), /enthusiasm:steady/)
})
test('changing personality does not overwrite affect or persist it', () => {
  const state = createPersonality()
  state.startTurn('haha')
  state.finishTurn(true)
  const affect = state.snapshot().affect
  state.configure({ humor: 0, enthusiasm: 0 })
  assert.deepEqual(state.snapshot().affect, affect)
  assert.equal('affect' in state.profile(), false)
  assert.deepEqual(createPersonality({ profile: state.profile() }).snapshot().affect, DEFAULT_AFFECT)
})
test('all live values stay bounded across repeated events', () => {
  const state = createPersonality({ profile: { humor: 100, enthusiasm: 100 } })
  for (let i = 0; i < 100; i++) {
    state.startTurn('we won lol')
    for (const key of AFFECT_TRAITS) assert.ok(state.snapshot().affect[key] >= 0 && state.snapshot().affect[key] <= 100)
    state.finishTurn(true)
  }
})
test('temporary affect remains stable during a long reply, then settles 90 seconds after completion', () => {
  let now = 0
  const state = createPersonality({ clock: () => now })
  state.startTurn('haha')
  const applied = state.snapshot().affect
  now = 200_000
  assert.deepEqual(state.snapshot().affect, applied)
  state.finishTurn(true)
  assert.deepEqual(state.snapshot().affect, applied)
  assert.equal(state.snapshot().mode, 'playful')
  now += 45_000
  assert.equal(state.snapshot().affect.amusement, 53)
  assert.equal(state.snapshot().mode, 'playful')
  now += 45_000
  assert.deepEqual(state.snapshot().affect, DEFAULT_AFFECT)
  assert.equal(state.snapshot().mode, 'ready')
})
test('a profile change during a response applies only to the next response', () => {
  const state = createPersonality()
  state.startTurn('hello')
  const instruction = state.instruction()
  state.configure({ humor: 0 })
  assert.equal(state.instruction(), instruction)
  state.finishTurn(true)
  state.startTurn('hello again')
  assert.match(state.instruction(), /humor:off/)
})
test('failed and interrupted replies reduce playfulness without false celebration', () => {
  const state = createPersonality()
  state.startTurn('haha')
  assert.equal(state.finishTurn(false).mode, 'recovering')
  assert.equal(state.snapshot().affect.amusement, 0)
  assert.match(state.instruction(), /humor:off/)
  state.startTurn('hello')
  assert.equal(state.interrupt().mode, 'paused')
  assert.equal(state.snapshot().active, false)
})
test('saved indicator is explicit and reset on edits', () => {
  const state = createPersonality()
  assert.equal(state.snapshot().saved, null)
  state.setSaved(true)
  assert.equal(state.snapshot().saved, true)
  state.configure({ enthusiasm: 70 })
  assert.equal(state.snapshot().saved, null)
  state.setSaved(false)
  assert.equal(state.snapshot().saved, false)
})
test('no raw conversation or arbitrary prompt text is in public state', () => {
  const state = createPersonality()
  const secret = 'unique-private-conversation-123456'
  state.startTurn(secret)
  assert.equal(JSON.stringify(state.snapshot()).includes(secret), false)
  assert.ok(state.instruction().length < 1600)
})
test('snapshot parser refuses invalid contract and out-of-bounds bars', () => {
  const valid = createPersonality().snapshot()
  for (const patch of [{ schema: 'nori.personality.v1' }, { mode: 'sentient' }, { active: 'yes' }, { saved: 'yes' }, { affect: { ...valid.affect, joy: 900 } }, { affect: { ...valid.affect, unknown: 5 } }, { profile: { humor: 10 } }, { appliedProfile: null }, { reason: 'x'.repeat(121) }]) {
    assert.equal(validPersonalitySnapshot({ ...valid, ...patch }), false)
    assert.equal(personalityInstruction({ ...valid, ...patch }), '')
  }
})

test('12 stable traits and 11 temporary states match the owner baseline exactly', () => {
  assert.deepEqual(DEFAULT_PERSONALITY, { humor: 70, honesty: 95, warmth: 60, enthusiasm: 40, sarcasm: 55, curiosity: 85, directness: 85, patience: 75, discretion: 90, playfulness: 55, empathy: 70, formality: 25 })
  assert.deepEqual(DEFAULT_AFFECT, { joy: 20, amusement: 35, frustration: 5, irritation: 3, anger: 0, concern: 8, excitement: 12, confidence: 75, uncertainty: 10, curiosity: 60, urgency: 0 })
  assert.equal(PERSONALITY_TRAITS.length, 12)
  assert.equal(AFFECT_TRAITS.length, 11)
  assert.equal(PERSONALITY_TRAITS.includes('joy'), false)
  assert.equal(AFFECT_TRAITS.includes('honesty'), false)
})
test('old joy slider migrates to enthusiasm, never into temporary joy', () => {
  const old = { humor: 100, joy: 0, warmth: 0, curiosity: 100 }
  assert.deepEqual(restorePersonality(old), { ...DEFAULT_PERSONALITY, humor: 100, enthusiasm: 0, warmth: 0, curiosity: 100 })
  assert.equal(createPersonality({ profile: old }).snapshot().affect.joy, 20)
  assert.deepEqual(restorePersonality({ ...old, arbitrary: 10 }), DEFAULT_PERSONALITY)
})
test('affect cannot be edited as an owner personality preference', () => {
  for (const value of [{ joy: 20 }, { anger: 10 }, { uncertainty: 90 }]) assert.throws(() => validatePersonalityPatch(value))
})
test('every personality control is used in fixed bounded style instructions', () => {
  for (const trait of PERSONALITY_TRAITS) {
    const low = createPersonality({ profile: { [trait]: 0 } }), high = createPersonality({ profile: { [trait]: 100 } })
    assert.notEqual(low.instruction(), high.instruction(), `${trait} is only a decorative slider`)
    assert.ok(high.instruction().length < 1600)
  }
})
test('every dynamic affect bar changes fixed, nonliteral output guidance', () => {
  const base = createPersonality().snapshot()
  for (const trait of AFFECT_TRAITS) {
    const low = { ...base, affect: { ...base.affect, [trait]: 0 } }
    const high = { ...base, affect: { ...base.affect, [trait]: 100 } }
    const lowText = personalityInstruction(low), highText = personalityInstruction(high)
    assert.notEqual(lowText, highText, `${trait} is displayed but does not shape delivery guidance`)
    assert.match(highText, /not feelings\/reliability/)
    assert.match(highText, /never alter facts, permissions/)
    assert.ok(highText.length < 1600, `${trait} guidance must remain compact`)
  }
})
test('low honesty and discretion do not authorize deception or privacy bypass', () => {
  const state = createPersonality({ profile: { honesty: 0, discretion: 0 } })
  assert.match(state.instruction(), /honesty:truthful/)
  assert.match(state.instruction(), /discretion:permission-required/)
  assert.match(state.instruction(), /privacy/)
})
test('urgent and nonurgent serious cues are distinguished without hostility', () => {
  const state = createPersonality()
  assert.equal(state.startTurn('we have an emergency lol').affect.urgency, 90)
  assert.match(state.instruction(), /urgency=urgent-calm/)
  assert.equal(state.startTurn('I am grieving').affect.urgency, 0)
  const snapshot = state.startTurn('I am angry and frustrated, smh')
  assert.ok(snapshot.affect.frustration > DEFAULT_AFFECT.frustration)
  assert.ok(snapshot.affect.anger > DEFAULT_AFFECT.anger)
  assert.ok(snapshot.affect.irritation > DEFAULT_AFFECT.irritation)
  assert.ok(snapshot.affect.concern > DEFAULT_AFFECT.concern)
  assert.match(state.instruction(), /anger=calm\/no-mirroring/)
  assert.match(state.instruction(), /frustration=patient\/no-blame/)
})
test('serious-mode priorities suppress playful directions even with high playful bars', () => {
  const base = createPersonality().snapshot()
  const serious = {
    ...base,
    mode: 'supportive',
    affect: { ...base.affect, joy: 100, amusement: 100, excitement: 100, urgency: 100 },
  }
  const instruction = personalityInstruction(serious)
  assert.match(instruction, /humor:off/)
  assert.match(instruction, /joy=steady/)
  assert.match(instruction, /amusement=off/)
  assert.match(instruction, /urgency=urgent-calm/)
  assert.doesNotMatch(instruction, /humor:welcome-only/)
})
test('uncertainty expresses delivery, not factual reliability or action authority', () => {
  const state = createPersonality()
  assert.equal(state.startTurn('I am not sure what I want').affect.uncertainty, 45)
  assert.match(state.instruction(), /not feelings\/reliability/)
  assert.match(state.instruction(), /never alter facts, permissions/)
  assert.equal('verificationPassed' in state.snapshot(), false)
})
