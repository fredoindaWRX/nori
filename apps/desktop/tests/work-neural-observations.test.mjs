import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkNeuralObservations } from '../bridge/work-neural-observations.mjs'
const event=state=>({schema:'nori.neural-event.v1',type:'neural-event',operation_id:'fixture-op',operation:'plan',state})
test('task snapshots emit lifecycle once across repeated polls',()=>{
  const observations=createWorkNeuralObservations('task-one')
  const snapshot={task_id:'task-one',neural_events:[event('started'),event('completed')]}
  assert.deepEqual(observations.collect(snapshot),snapshot.neural_events)
  assert.deepEqual(observations.collect(snapshot),[])
})
test('wrong task, premature terminal, payload and oversized buffers cannot create activity',()=>{
  const observations=createWorkNeuralObservations('task-one')
  assert.deepEqual(observations.collect({task_id:'other',neural_events:[event('started')]}),[])
  assert.deepEqual(observations.collect({task_id:'task-one',neural_events:[event('completed')]}),[])
  assert.deepEqual(observations.collect({task_id:'task-one',neural_events:[{...event('started'),payload:'PRIVATE'}]}),[])
  assert.deepEqual(observations.collect({task_id:'task-one',neural_events:Array(513).fill(event('started'))}),[])
  assert.deepEqual(observations.collect({task_id:'task-one',neural_events:[event('started')]}),[event('started')])
})
test('closure suppresses later snapshots and event getters are not read',()=>{
  const observations=createWorkNeuralObservations('task-one')
  let reads=0
  const malformed={...event('started')}
  Object.defineProperty(malformed,'state',{get(){reads++;return 'started'}})
  assert.deepEqual(observations.collect({task_id:'task-one',neural_events:[malformed]}),[])
  assert.equal(reads,0)
  observations.close()
  assert.deepEqual(observations.collect({task_id:'task-one',neural_events:[event('started'),event('completed')]}),[])
})
