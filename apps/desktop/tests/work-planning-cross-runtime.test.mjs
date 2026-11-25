import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createWorkNeuralObservations } from '../bridge/work-neural-observations.mjs'
import { createNeuralEventLedger, bindNeuralEvent } from '../bridge/neural-event-contract.mjs'
import { observeBridgeNeuralSignal, observedNeuralSignals, clearNeuralSignals } from '../src/scene/neural-signals.ts'
const root=fileURLToPath(new URL('../../../',import.meta.url))
const python=fileURLToPath(new URL('../../../python/Python311/python.exe',import.meta.url))
const fixture=String.raw`
import asyncio,json,sys
from pathlib import Path
from copy import deepcopy
root=Path.cwd();sys.path.insert(0,str(root/'nori'));sys.path.insert(0,str(root/'nori/shared'))
from work_sessions import WorkSessionManager
manager=object.__new__(WorkSessionManager)
state={'task_id':'fixture-task','goal':'PRIVATE_OWNER_REQUEST','artifacts':[],'cancel_requested':False}
snapshots=[]
manager._save=lambda state:snapshots.append({'task_id':state['task_id'],'neural_events':deepcopy(state.get('neural_events',[]))})
manager._event=lambda *args:None
manager._observation_context=lambda observations:'fixture'
async def request(*args):
    if sys.argv[1]=='cancelled':raise asyncio.CancelledError()
    return {'response':'{"plan":["Inspect fixture"]}' if sys.argv[1]=='completed' else '{"plan":[]}'}
manager._request=request
try:asyncio.run(manager._recover_loop(state,'fixture-credential',[]))
except asyncio.CancelledError:pass
print(json.dumps(snapshots))
`
for(const terminal of ['completed','failed','cancelled']) {
  test(`Python recovery ${terminal} snapshot reaches actual Planning signal contract`,()=>{
    clearNeuralSignals()
    const process=spawnSync(python,['-B','-c',fixture,terminal],{cwd:root,encoding:'utf8',timeout:10000,maxBuffer:65536})
    assert.ifError(process.error);assert.equal(process.status,0,process.stderr)
    assert.ok(!process.stdout.includes('PRIVATE_OWNER_REQUEST'))
    const snapshots=JSON.parse(process.stdout)
    const extraction=createWorkNeuralObservations('fixture-task')
    const turn=createNeuralEventLedger('accepted-turn')
    const states=[]
    for(const snapshot of snapshots) {
      for(const event of extraction.collect(snapshot)) {
        states.push(event.state)
        const bound=bindNeuralEvent(event,'accepted-turn')
        assert.ok(bound)
        observeBridgeNeuralSignal(bound,'accepted-turn',70000,turn)
      }
      assert.deepEqual(extraction.collect(snapshot),[])
    }
    assert.deepEqual(states,['started',terminal])
    assert.deepEqual(observedNeuralSignals(70000).map(signal=>signal.to),['planning'])
    turn.close();extraction.close();clearNeuralSignals()
    assert.deepEqual(extraction.collect(snapshots.at(-1)),[])
    observeBridgeNeuralSignal({...snapshots.at(-1).neural_events[0],ask:'accepted-turn'},'accepted-turn',70001,turn)
    assert.deepEqual(observedNeuralSignals(70001),[])
  })
}
