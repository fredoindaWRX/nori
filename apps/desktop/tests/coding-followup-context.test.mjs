import test from 'node:test'
import assert from 'node:assert/strict'
import { captureCodingConversationTurn, restoreCodingConversationTurn, codingActionText,
  boundedCodingConversationTurns, codingModelBackgroundTurns, serializeCodingResumeRecord } from '../bridge/coding-followup-context.mjs'

test('long retained request keeps its trailing editable and readonly restrictions', () => {
  const text='Write a Python function. '+'界'.repeat(18000)+'. Edit only calculator.py. Read test_calculator.py without changing it.'
  const turn=captureCodingConversationTurn('user',text)
  assert.equal(codingActionText(turn),text)
  const restored=restoreCodingConversationTurn(JSON.parse(JSON.stringify(turn)))
  assert.equal(codingActionText(restored),text)
  assert.equal(codingModelBackgroundTurns([turn])[0].text.length,1800)
  assert.equal(codingActionText(turn),text)
})

test('legacy clipping and explicit truncation never establish complete action scope', () => {
  assert.equal(codingActionText({role:'user',text:'Write Python code. '.padEnd(1800,' ')}),null)
  assert.equal(codingActionText({role:'user',text:'Write Python code.',truncated:true,complete:true}),null)
  const captured=captureCodingConversationTurn('user','Write code. '+'x'.repeat(21000)+'. Edit only calculator.py.')
  assert.equal(captured.truncated,true)
  assert.equal(codingActionText(captured),null)
  assert.equal(codingActionText(restoreCodingConversationTurn(captured)),null)
})

test('UTF8 history budgeting removes old whole turns and preserves the newest complete pair', () => {
  const history=[]
  for(let i=0;i<5;i++)history.push(captureCodingConversationTurn('user','界'.repeat(18000)),captureCodingConversationTurn('nori','Earlier reply.'))
  const newest=[captureCodingConversationTurn('user','Write a Python function. '+'界'.repeat(18000)+'. Edit only calculator.py.'),captureCodingConversationTurn('nori','Would you like me to run it with Aider?')]
  history.push(...newest)
  assert.ok(Buffer.byteLength(JSON.stringify(history))>262144)
  const bounded=boundedCodingConversationTurns(history)
  assert.ok(bounded.length<history.length)
  assert.ok(Buffer.byteLength(JSON.stringify(bounded))<=245760)
  assert.deepEqual(bounded.slice(-2),newest)
  assert.ok(bounded.every(turn=>history.some(original=>original.role===turn.role&&original.text===turn.text)))
})

test('resume serialization includes metadata in the byte limit without changing personality', () => {
  const history=Array.from({length:10},(_,i)=>captureCodingConversationTurn(i%2?'nori':'user','界'.repeat(18000)))
  history[history.length-1]=captureCodingConversationTurn('nori','Would you like me to run it with Aider?')
  const personality={style:'balanced',notes:'界'.repeat(60000)}
  const record={session_id:'synthetic-only',model:'local',effort:'deep',at:0,history,personality}
  const encoded=serializeCodingResumeRecord(record),got=JSON.parse(encoded)
  assert.ok(Buffer.byteLength(encoded)<=262144)
  assert.deepEqual(got.personality,personality)
  assert.deepEqual(got.history,history.slice(-2))
  assert.equal(got.session_id,record.session_id)
  assert.equal(history.length,10)
})

test('exact resume boundary succeeds; an oversized newest pair plus metadata refuses', () => {
  const record={history:[{role:'user',text:'Write Python code.'},{role:'nori',text:'Would you like me to run it?'}],personality:{notes:''}}
  record.personality.notes='x'.repeat(262144-Buffer.byteLength(JSON.stringify(record)))
  assert.equal(Buffer.byteLength(serializeCodingResumeRecord(record)),262144)
  record.personality.notes+='x'
  assert.throws(()=>serializeCodingResumeRecord(record),/previous saved state was preserved/)
})
