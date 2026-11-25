import test from 'node:test'
import assert from 'node:assert/strict'
import {resolve} from 'node:path'
import {journalWorkflow} from '../scripts/project-workflow-journal.mjs'

const root=resolve(import.meta.dirname,'../../..')
const source='apps/desktop/scripts/project-workflow-journal.mjs'
test('successful workflow records paired identity and exact source hash',async()=>{
  const events=[],write=(...event)=>events.push(event)
  assert.equal(await journalWorkflow('build','fixture',source,()=>42,{root,write}),42)
  assert.equal(events.length,2)
  assert.match(events[0][2],/started$/)
  assert.match(events[1][2],/completed;/)
  assert.equal(events[0][2].split(' ')[1],events[1][2].split(' ')[1])
  assert.match(events[0][2],/source_sha256=[a-f0-9]{64}/)
})
test('failure preserves error and logs no private exception text',async()=>{
  const events=[],error=Error('secret-password'),write=(...event)=>events.push(event)
  await assert.rejects(journalWorkflow('build','fixture',source,()=>{throw error},{root,write}),e=>e===error)
  assert.equal(events[1][1],'failure')
  assert.doesNotMatch(JSON.stringify(events),/secret-password/)
})
test('failed start logging prevents dispatch',async()=>{
  let ran=false
  await assert.rejects(journalWorkflow('build','fixture',source,()=>{ran=true},
    {root,write:()=>{throw Error('locked')}}))
  assert.equal(ran,false)
})
test('terminal log failure cannot report workflow success',async()=>{
  let calls=0
  await assert.rejects(journalWorkflow('build','fixture',source,()=>42,
    {root,write:()=>{if(++calls===2)throw Error('disk full')}}))
})
test('action and terminal log failures are both preserved',async()=>{
  let calls=0
  await assert.rejects(journalWorkflow('package','fixture',source,()=>{throw Error('worker failed')},
    {root,write:()=>{if(++calls===2)throw Error('disk full')}}),e=>e instanceof AggregateError&&e.errors.length===2)
})
test('successful terminal event is sealed before returning',async()=>{
  const calls=[]
  await journalWorkflow('build','fixture',source,()=>42,
    {root,write:()=>calls.push('event'),seal:()=>calls.push('snapshot')})
  assert.deepEqual(calls,['event','event','snapshot'])
})
test('snapshot failure cannot report audit-complete success',async()=>{
  await assert.rejects(journalWorkflow('build','fixture',source,()=>42,
    {root,write:()=>{},seal:()=>{throw Error('backup failed')}}),/backup failed/)
})
