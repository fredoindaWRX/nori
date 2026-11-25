import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createNeuralEventLedger, validateNeuralEvent } from '../bridge/neural-event-contract.mjs'

const root=fileURLToPath(new URL('../../../',import.meta.url))
const python=fileURLToPath(new URL('../../../python/Python311/python.exe',import.meta.url))
const fixture=String.raw`
import sys,json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
root=Path.cwd()
sys.path.insert(0,str(root/'nori'));sys.path.insert(0,str(root/'nori/shared'))
from orchestration.architect_worker import ArchitectWorker
policy=SimpleNamespace(decide=lambda operation:SimpleNamespace(allowed=True,reason='fixture'))
events=[]
dispatch=lambda request:{'knight':'fixture','dispatch_id':'fixture','result':{'status':sys.argv[1]}}
worker=ArchitectWorker(policy,None,dispatch,neural_observer=events.append)
request={'operation':'run_graph','nodes':[{'id':'private-node','capability':'fixture','request':{'private':'DO_NOT_EXPORT'},'depends_on':[]}]}
with patch('orchestration.architect_worker.record'):
    result=worker.run(request)
print(json.dumps({'events':events,'status':result['status']}))
`
for(const [outcome,terminal,status] of [['completed','completed','completed'],['failed','failed','incomplete']]) {
  test(`actual Python Architect ${outcome} events satisfy desktop lifecycle contract`,()=>{
    const process=spawnSync(python,['-B','-c',fixture,outcome],{cwd:root,encoding:'utf8',timeout:10000,maxBuffer:65536})
    assert.ifError(process.error)
    assert.equal(process.status,0,process.stderr)
    const result=JSON.parse(process.stdout)
    assert.equal(result.status,status)
    assert.deepEqual(result.events.map(event=>event.state),['started',terminal])
    assert.equal(result.events[0].operation_id,result.events[1].operation_id)
    assert.ok(!process.stdout.includes('DO_NOT_EXPORT'))
    assert.ok(!process.stdout.includes('private-node'))
    const ledger=createNeuralEventLedger('fixture-turn')
    for(const raw of result.events) {
      assert.equal(validateNeuralEvent(raw,'fixture-turn'),null)
      const bound={...raw,ask:'fixture-turn'}
      const accepted=ledger.accept(bound)
      assert.ok(accepted)
      assert.equal(accepted.region,'planning')
      assert.equal(accepted.state,raw.state)
    }
    assert.equal(ledger.accept({...result.events[1],ask:'fixture-turn'}),null)
    ledger.close()
    assert.equal(ledger.accept({...result.events[0],ask:'fixture-turn'}),null)
  })
}
