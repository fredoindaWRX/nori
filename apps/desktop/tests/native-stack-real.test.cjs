const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { startNativeStack } = require('../desktop/native-stack.cjs')
const { acquireStateOwner } = require('../desktop/state-owner.cjs')
function runtimeRoot(){
  const source=resolve(__dirname,'../../..')
  const candidate=process.env.NORI_STACK_TEST_CANDIDATE
  if(candidate===undefined)return source
  if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(candidate))throw Error('Invalid stack test candidate')
  return join(source,`apps/desktop/release/native-desktop-${candidate}/win-unpacked/resources/NoriSuite`)
}

test('real Core restarts from an integrity-verified protected copy of isolated state',
  {skip:process.platform!=='win32'||process.env.NORI_REAL_STACK_TEST!=='1',timeout:120000},async()=>{
    const {stageCorePrivateState}=await import('../scripts/stage-core-private-state.mjs')
    const root=runtimeRoot(),verification=join(root,'verification')
    mkdirSync(verification,{recursive:true})
    const trial=mkdtempSync(join(verification,'.native-state-restart-')),source=join(trial,'old-core')
    mkdirSync(source);writeFileSync(join(source,'migration-fixture.txt'),'synthetic migration marker')
    const environment={...process.env,NORI_INFERENCE_RUNTIME:'norllama',NORI_ALLOW_WRITES:'0'}
    let stack
    let memoryId
      async function memoryTask(body,role='merovingian',route='task'){
        const response=await fetch(`http://127.0.0.1:${stack.status.ports[role]}/${route}`,{
        method:'POST',headers:{Authorization:`Bearer ${stack.environment.NORI_API_TOKEN}`,'Content-Type':'application/json'},
        body:JSON.stringify(body),signal:AbortSignal.timeout(5000),redirect:'error'})
      assert.equal(response.status,200)
      return response.json()
    }
    async function drain(){
      if(!stack)return
      const ids=[stack.core.child.pid,stack.runtime.child.pid,stack.runtime.status.workerPid]
      assert.ok(ids.every(pid=>Number.isSafeInteger(pid)&&pid>0))
      await stack.stop();await stack.exited
      assert.equal((await stack.core.exited).code,0)
      assert.equal((await stack.runtime.exited).code,0)
      for(const pid of ids){let alive=false;try{process.kill(pid,0);alive=true}catch{}assert.equal(alive,false)}
      stack=null
    }
    try{
      stack=await startNativeStack({root,dataRoot:source,environment})
      const knowledge=join(source,'oracle/knowledge')
      mkdirSync(knowledge,{recursive:true})
      writeFileSync(join(knowledge,'native-research-fixture.txt'),'Synthetic lunar habitat contains three towers.')
      for(const role of ['neo','morpheus']){
        const workspace=join(source,role,'workspace')
        mkdirSync(workspace,{recursive:true})
        writeFileSync(join(workspace,'role-fixture.py'),`def synthetic_${role}():\n    return 7\n`)
      }
      const pluginDirectory=join(source,'trinity/plugins/synthetic-fixture')
      mkdirSync(pluginDirectory,{recursive:true})
      writeFileSync(join(pluginDirectory,'nori-plugin.json'),JSON.stringify({schema:1,id:'synthetic-fixture',version:'1.0.0',capabilities:['synthetic-fixture']}))
      writeFileSync(join(pluginDirectory,'plugin.py'),'raise RuntimeError("Synthetic plugin must never run inside Core")\n')
      const indexed=await memoryTask({operation:'index',path:'native-research-fixture.txt'},'oracle')
      assert.equal(indexed.status,'indexed')
      const research=await memoryTask({operation:'report',question:'habitat towers'},'keymaker')
      assert.equal(research.status,'completed')
      assert.equal(research.report.finding_count,1)
      assert.equal(research.report.citations[0].source,'native-research-fixture.txt')
      const remembered=await memoryTask({operation:'remember',scope:'native-restart-fixture',content:'Synthetic native memory restart marker'})
      assert.equal(remembered.storage.backend,'nori-sqlite')
      assert.equal(remembered.storage.primary_available,true)
      memoryId=remembered.entry.id
      const unauthenticatedLearning=await fetch(`http://127.0.0.1:${stack.status.ports.merovingian}/learning`,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({operation:'status'}),
        signal:AbortSignal.timeout(5000),redirect:'error'})
      assert.equal(unauthenticatedLearning.status,401)
      const wrongRoleLearning=await fetch(`http://127.0.0.1:${stack.status.ports.oracle}/learning`,{
        method:'POST',headers:{Authorization:`Bearer ${stack.environment.NORI_API_TOKEN}`,'Content-Type':'application/json'},
        body:JSON.stringify({operation:'status'}),signal:AbortSignal.timeout(5000),redirect:'error'})
      assert.equal(wrongRoleLearning.status,404)
      const experience=await memoryTask({operation:'record',experience:{task_id:'synthetic-learning-fixture',
        knight:'neo',capability:'coding',outcome:'completed',score:0.5,training_opt_in:false,
        sample:'Synthetic non-consented content must not be exported'}},'merovingian','learning')
      assert.equal(experience.status,'completed')
      assert.equal(experience.training_opt_in,false)
      async function verifySharedGraph(){
        const toolStatus=await memoryTask({operation:'tool_status'},'architect')
        assert.equal(toolStatus.isolated_runner_configured,false)
        assert.equal(toolStatus.isolated_execution_qualification.status,'unavailable')
        assert.equal(toolStatus.isolated_execution_qualification.ready_verified,false)
        const hardware=await memoryTask({operation:'hardware_snapshot'},'tank')
        assert.equal(hardware.status,'completed')
        assert.equal(typeof hardware.profile.tier,'string')
        assert.equal(typeof hardware.profile.profile.cpu_count,'number')
        const browserRefusal=await fetch(`http://127.0.0.1:${stack.status.ports.apoc}/task`,{
          method:'POST',headers:{Authorization:`Bearer ${stack.environment.NORI_API_TOKEN}`,'Content-Type':'application/json'},
          body:JSON.stringify({operation:'inspect',url:'https://synthetic-fixture.invalid/'}),
          signal:AbortSignal.timeout(5000),redirect:'error'})
        assert.equal(browserRefusal.status,403)
        const plugins=await memoryTask({operation:'list'},'trinity')
        assert.deepEqual(plugins.plugins,[{id:'synthetic-fixture',version:'1.0.0',capabilities:['synthetic-fixture']}])
        const pluginGraph=await memoryTask({operation:'run_graph',nodes:[
          {id:'discover',capability:'plugins',request:{operation:'list'},depends_on:[]},
          {id:'invoke',capability:'plugins',request:{operation:'invoke',plugin:'synthetic-fixture',request:{}},depends_on:['discover']},
          {id:'dependent',capability:'plugins',request:{operation:'list'},depends_on:['invoke']}
        ]},'architect')
        assert.equal(pluginGraph.status,'incomplete')
        assert.deepEqual(pluginGraph.results.discover.output.plugins,plugins.plugins)
        assert.equal(pluginGraph.results.invoke.output.status,'denied')
        assert.equal(pluginGraph.results.dependent.status,'blocked')
        const eventGraph=await memoryTask({operation:'run_graph',nodes:[
          {id:'publish',capability:'events',request:{operation:'publish',topic:'synthetic.fixture',payload:{synthetic:true}},depends_on:[]}
        ]},'architect')
        assert.equal(eventGraph.status,'completed')
        assert.equal(eventGraph.results.publish.output.status,'queued')
        const eventId=eventGraph.results.publish.output.event.id
        const delivered=await memoryTask({operation:'next'},'sentinel')
        assert.equal(delivered.event.id,eventId)
        assert.deepEqual(delivered.event.payload,{synthetic:true})
        const cancelledEvent=await memoryTask({operation:'publish',topic:'synthetic.cancelled',payload:{}},'sentinel')
        const cancelled=await memoryTask({operation:'cancel',event_id:cancelledEvent.event.id},'sentinel')
        assert.equal(cancelled.status,'cancelled')
        assert.equal((await memoryTask({operation:'next'},'sentinel')).event,null)
        const graph=await memoryTask({operation:'run_graph',nodes:[
          {id:'memory',capability:'memory',request:{operation:'recall',scope:'native-restart-fixture'},depends_on:[]},
          {id:'research',capability:'research',request:{operation:'report',question:'habitat towers'},depends_on:['memory']}
        ]},'architect')
        assert.equal(graph.status,'completed')
        assert.equal(graph.results.memory.knight,'merovingian')
        assert.deepEqual(graph.results.memory.output.entries.map(entry=>entry.id),[memoryId])
        assert.equal(graph.results.memory.output.storage.backend,'nori-sqlite')
        assert.equal(graph.results.research.output.report.finding_count,1)
        assert.equal(graph.results.research.output.report.citations[0].source,'native-research-fixture.txt')
        assert.equal(graph.results.research.output.report.citations[0].evidence_type,'indexed_snapshot')
        const codeGraph=await memoryTask({operation:'run_graph',nodes:[
          {id:'read',capability:'coding',request:{operation:'read',path:'role-fixture.py'},depends_on:[]},
          {id:'navigate',capability:'ide',request:{operation:'symbols',path:'role-fixture.py'},depends_on:['read']}
        ]},'architect')
        assert.equal(codeGraph.status,'completed')
        assert.equal(codeGraph.results.read.knight,'neo')
        assert.equal(codeGraph.results.read.output.content,'def synthetic_neo():\n    return 7\n')
        assert.equal(codeGraph.results.navigate.knight,'morpheus')
        assert.deepEqual(codeGraph.results.navigate.output.symbols,[{name:'synthetic_morpheus',line:1}])
        const learningGraph=await memoryTask({operation:'run_graph',nodes:[
          {id:'learning',capability:'learning',request:{operation:'status'},depends_on:[]}
        ]},'architect')
        assert.equal(learningGraph.status,'completed')
        assert.equal(learningGraph.results.learning.knight,'merovingian')
        assert.equal(learningGraph.results.learning.output.records,1)
        assert.equal(learningGraph.results.learning.output.training_examples,0)
        assert.deepEqual(learningGraph.results.learning.output.routing_scores,{coding:{neo:0.5}})
        const learningExport=await memoryTask({operation:'export'},'merovingian','learning')
        assert.deepEqual(learningExport.examples,[])
        const machine=await memoryTask({operation:'models'},'machine')
        assert.equal(machine.status,'completed')
        assert.equal(machine.result.models.length,1)
        assert.equal(machine.result.models[0].id,stack.runtime.status.modelId)
        assert.equal(machine.result.models[0].backend,'norama-independent')
        assert.equal(machine.result.models[0].assistant_qualified,false)
        const preflight=await memoryTask({operation:'preflight',model:stack.runtime.status.modelId},'machine')
        assert.equal(preflight.result.ready,true)
        assert.equal(preflight.result.inspection_scope,'resident_model_only')
        assert.equal(preflight.result.assistant_qualified,false)
        assert.equal(preflight.result.model_changed,false)
        const unsupported=await memoryTask({operation:'preflight',model:'synthetic-unloaded-model'},'machine')
        assert.equal(unsupported.result.status,'unsupported')
        assert.equal(unsupported.result.ready,false)
        assert.equal(unsupported.result.model_changed,false)
        const runtimeGraph=await memoryTask({operation:'run_graph',nodes:[
          {id:'runtime',capability:'inference',request:{operation:'runtime'},depends_on:[]}
        ]},'architect')
        assert.equal(runtimeGraph.status,'completed')
        assert.equal(runtimeGraph.results.runtime.knight,'machine')
        assert.equal(runtimeGraph.results.runtime.output.result.runtime,'NorLlama')
        assert.equal(runtimeGraph.results.runtime.output.result.model_id,stack.runtime.status.modelId)
        assert.equal(runtimeGraph.results.runtime.output.result.task_execution_qualified,false)
      }
      await verifySharedGraph()
      const forgotten=await memoryTask({operation:'remember',scope:'native-restart-fixture',content:'Synthetic entry to forget'})
      const forgetResult=await memoryTask({operation:'forget',scope:'native-restart-fixture',entry_id:forgotten.entry.id})
      assert.equal(forgetResult.status,'completed')
      assert.equal(forgetResult.storage.logical_forgetting,true)
      assert.equal(forgetResult.storage.physical_erasure,false)
      const protectedWrite=await fetch(`http://127.0.0.1:${stack.status.ports.merovingian}/task`,{
        method:'POST',headers:{Authorization:`Bearer ${stack.environment.NORI_API_TOKEN}`,'Content-Type':'application/json'},
        body:JSON.stringify({operation:'document_write',block:'memory-fixture',content:'Must not overwrite managed memory'}),
        signal:AbortSignal.timeout(5000),redirect:'error'})
      assert.equal(protectedWrite.status,400)
      const written=await memoryTask({operation:'document_write',block:'restart-document-fixture',content:'Synthetic searchable native document'})
      assert.equal(written.backend,'nori-sqlite')
      const searched=await memoryTask({operation:'document_search',query:'searchable native document'})
      assert.deepEqual(searched.matches.map(item=>item.relative_path),['nori/restart-document-fixture'])
      assert.throws(()=>acquireStateOwner(source,{purpose:'migration'}),/EEXIST/)
      assert.throws(()=>stageCorePrivateState(trial,source),/EEXIST/)
      await drain()
      const staged=stageCorePrivateState(trial,source),destination=join(trial,'state/private/core')
      assert.equal(staged.protectedAclVerified,true)
      assert.equal(staged.cooperativeOwnershipHeldThroughoutCopy,true)
      assert.equal(staged.destinationOwnershipHeldThroughoutCopy,true)
      assert.equal(staged.activationAuthorized,false)
      assert.equal(existsSync(join(destination,'.nori-state-owner.json')),false)
      stack=await startNativeStack({root,dataRoot:destination,environment})
      assert.throws(()=>acquireStateOwner(destination,{purpose:'migration'}),/EEXIST/)
      assert.equal(stack.status.taskExecutionQualified,false)
      assert.equal(readFileSync(join(destination,'migration-fixture.txt'),'utf8'),'synthetic migration marker')
      const restoredResearch=await memoryTask({operation:'report',question:'habitat towers'},'keymaker')
      assert.equal(restoredResearch.status,'completed')
      assert.equal(restoredResearch.report.finding_count,1)
      assert.equal(restoredResearch.report.citations[0].source,'native-research-fixture.txt')
      assert.equal(restoredResearch.report.citations[0].evidence_type,'indexed_snapshot')
      assert.match(restoredResearch.report.citations[0].indexed_text_sha256,/^[a-f0-9]{64}$/)
      const recalled=await memoryTask({operation:'recall',scope:'native-restart-fixture'})
      assert.equal(recalled.storage.backend,'nori-sqlite')
      assert.deepEqual(recalled.entries.map(entry=>entry.id),[memoryId])
      await verifySharedGraph()
      const exported=await memoryTask({operation:'export',scope:'native-restart-fixture'})
      assert.deepEqual(exported.export.entries.map(entry=>entry.id),[memoryId])
      const repaired=await memoryTask({operation:'reconcile',scope:'native-restart-fixture'})
      assert.equal(repaired.result.entries_count,1)
      const document=await memoryTask({operation:'document_read',block:'restart-document-fixture'})
      assert.equal(document.backend,'nori-sqlite')
      assert.equal(document.content,'Synthetic searchable native document')
      await drain()
      // Retained original state must remain usable; do not silently replace
      // or delete it after the first successful boot from a copied location.
      assert.equal(readFileSync(join(source,'migration-fixture.txt'),'utf8'),'synthetic migration marker')
      stack=await startNativeStack({root,dataRoot:source,environment})
      assert.equal(stack.status.taskExecutionQualified,false)
      await drain()
      writeFileSync(join(trial,'restart-receipt.json'),JSON.stringify({passed:true,coreBootedFromProtectedCopy:true,
        coreRollbackBootedFromOriginal:true,originalStatePreserved:true,migrationOwnershipHeldThroughoutCopy:true,
        ownedProcessesRemaining:[],normalProfileUsed:false,sensorsUsed:false,fullMigrationVerified:false},null,2))
    }finally{if(stack)await stack.stop()}
  })

test('real owned stack drains after owner cancellation following readiness',
  { skip: process.env.NORI_REAL_STACK_TEST !== '1', timeout: 90000 }, async () => {
    const root = runtimeRoot()
    const verification = join(root, 'verification')
    mkdirSync(verification, { recursive: true })
    const state = mkdtempSync(join(verification, '.native-cancel-real-'))
    const controller = new AbortController()
    let stack
    try {
      stack = await startNativeStack({ root, dataRoot: state, signal: controller.signal,
        environment: { ...process.env, NORI_INFERENCE_RUNTIME: 'norllama', NORI_ALLOW_WRITES: '0' } })
      assert.equal(stack.status.taskExecutionQualified, false)
      const ids = [stack.core.child.pid, stack.runtime.child.pid, stack.runtime.status.workerPid]
      assert.ok(ids.every(pid => Number.isSafeInteger(pid) && pid > 0))
      controller.abort()
      await stack.stop(); await stack.exited
      const alive = pid => { try { process.kill(pid, 0); return true } catch { return false } }
      const remaining = ids.filter(alive)
      assert.deepEqual(remaining, [])
      writeFileSync(join(state, 'cancellation-receipt.json'), JSON.stringify({
        passed: true, ownerCancellationAfterReadiness: true, ownedProcessesRemaining: remaining,
        sensorsUsed: false, normalProfileUsed: false, fullMigrationVerified: false
      }, null, 2))
    } finally { if (stack) await stack.stop() }
  })
