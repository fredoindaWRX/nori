// Explicit opt-in source service verification. Does not launch Electron or use user state.
const assert=require('node:assert/strict')
const {resolve,join}=require('node:path')
const {existsSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,statSync}=require('node:fs')
const {createHash}=require('node:crypto')
const {startNativeService}=require('../desktop/native-service.cjs')
const {startNativeCore}=require('../desktop/native-core.cjs')
async function main(){
  if(process.env.NORI_QWEN_SERVICE_LIVE!=='1')throw Error('Explicit NORI_QWEN_SERVICE_LIVE=1 required')
  const root=resolve(__dirname,'../../..')
  const source=join(process.env.TEMP,'nori-qwen-native-verify','qwen-worker.exe')
  const target=join(root,'engine/norama/tests/builds/qwen-native-verify/qwen-worker.exe')
  const configName='runtime/norllama/qwen-native-verification.json'
  assert.ok(existsSync(source)&&statSync(source).size<4*1024**2)
  const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex')
  mkdirSync(resolve(target,'..'),{recursive:true})
  if(existsSync(target)&&hash(target)!==hash(source))throw Error('Existing verification worker differs; review before replacement')
  if(!existsSync(target))copyFileSync(source,target)
  assert.equal(hash(source),hash(target))
  const config={port:11435,architecture:'imported-qwen35',engine_binary:'engine/norama/tests/builds/qwen-native-verify/qwen-worker.exe',
    model_path:'models/language/qwen3.8-27b-bartowski-87410e7b/Qwen3.8-27B-Q3_K_M.gguf',model_id:'qwen35-native-verification',cache_precision:'f32',prompt_limit:65536}
  const configPath=join(root,configName)
  const bytes=JSON.stringify(config,null,2)+'\n'
  if(existsSync(configPath)&&readFileSync(configPath,'utf8')!==bytes)throw Error('Existing verification profile differs')
  if(!existsSync(configPath))writeFileSync(configPath,bytes)
  let service,core,coreMemoryVerified=false,readOnlyGraphVerified=false
  try{
    service=await startNativeService({root,configName,environment:{...process.env,
      NORI_RUNTIME_PYTHON:'C:\\Users\\Studio\\AppData\\Local\\Programs\\Python\\Python311\\python.exe'},startupTimeout:120000})
    console.log('PASS real desktop service startup and health acknowledgement')
    const auth={Authorization:`Bearer ${service.environment.NORI_RUNTIME_API_KEY}`,'Content-Type':'application/json'}
    const response=await fetch(`${service.environment.NORI_RUNTIME_URL}/v1/chat`,{method:'POST',headers:auth,redirect:'error',signal:AbortSignal.timeout(180000),
      body:JSON.stringify({model_id:config.model_id,messages:[{role:'user',content:'Say hello.'}],max_tokens:16,stream:false})})
    assert.equal(response.status,200);const reply=await response.json();assert.equal(reply.text,'Hello! How can I help you today?')
    const {nativeRuntimeChat}=await import('../bridge/native-runtime.mjs')
    let streamed=''
    for await(const part of nativeRuntimeChat({endpoint:service.environment.NORI_RUNTIME_URL,
      apiKey:service.environment.NORI_RUNTIME_API_KEY,modelId:config.model_id,
      messages:[{role:'user',content:'Say hello.'}],maxTokens:16,signal:AbortSignal.timeout(180000)}))streamed+=part
    assert.equal(streamed,'Hello! How can I help you today?')
    console.log('PASS real desktop bridge streamed reply')
    if(process.env.NORI_QWEN_CORE_LIVE==='1'){
      const dataRoot=join(root,'verification','.qwen-core-live-20261025','state')
      const workspace=join(dataRoot,'neo/workspace');mkdirSync(workspace,{recursive:true})
      writeFileSync(join(workspace,'qwen-fixture.py'),'def synthetic_value():\n    return 7\n')
      const coreOptions={root,runtime:service,environment:{...process.env,NORI_RUNTIME_PYTHON:'C:\\Users\\Studio\\AppData\\Local\\Programs\\Python\\Python311\\python.exe'},dataRoot}
      const memory=async body=>{
        const response=await fetch(`http://127.0.0.1:${core.status.ports.merovingian}/task`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
          headers:{Authorization:`Bearer ${core.environment.NORI_API_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(body)})
        assert.equal(response.status,200);return response.json()
      }
      core=await startNativeCore(coreOptions)
      console.log('PASS real Qwen-owned Core startup; sensors disabled')
      const scope=`qwen-synthetic-${require('node:crypto').randomUUID()}`
      const remembered=await memory({operation:'remember',scope,content:'Synthetic Qwen native Core persistence marker'})
      assert.equal(remembered.storage.backend,'nori-sqlite');const id=remembered.entry.id
      const graphResponse=await fetch(`http://127.0.0.1:${core.status.ports.architect}/task`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),
        headers:{Authorization:`Bearer ${core.environment.NORI_API_TOKEN}`,'Content-Type':'application/json'},
        body:JSON.stringify({operation:'run_graph',nodes:[
          {id:'memory',capability:'memory',request:{operation:'recall',scope},depends_on:[]},
          {id:'code_read',capability:'coding',request:{operation:'read',path:'qwen-fixture.py'},depends_on:['memory']}
        ]})})
      assert.equal(graphResponse.status,200);const graph=await graphResponse.json()
      assert.equal(graph.status,'completed');assert.equal(graph.results.memory.knight,'merovingian')
      assert.deepEqual(graph.results.memory.output.entries.map(entry=>entry.id),[id])
      assert.equal(graph.results.code_read.knight,'neo');assert.equal(graph.results.code_read.output.content,'def synthetic_value():\n    return 7\n')
      readOnlyGraphVerified=true;console.log('PASS real Core routed synthetic memory-to-code-read dependency graph (caller supplied)')
      await core.stop();assert.equal((await core.exited).code,0);core=null
      core=await startNativeCore(coreOptions)
      const recalled=await memory({operation:'recall',scope})
      assert.deepEqual(recalled.entries.map(entry=>entry.id),[id])
      await core.stop();assert.equal((await core.exited).code,0);core=null;coreMemoryVerified=true
      console.log('PASS synthetic native memory persisted across Core restart')
    }
    await service.stop();const exit=await service.exited;assert.equal(exit.code,0)
    writeFileSync(join(root,'verification/native-qwen-desktop-service-20261025.json'),JSON.stringify({status:'PASS',reply,
      core_read_only_graph:readOnlyGraphVerified,graph_model_planned:false,core_memory_persistence:coreMemoryVerified,streamed_reply:streamed,worker_sha256:hash(target),launcher:'real startNativeService',installed_app_tested:false,personal_state_used:false,context_capacity_tested:false},null,2)+'\n')
    console.log('PASS real authenticated local reply and clean service shutdown')
  }finally{try{if(core)await core.stop()}finally{if(service)await service.stop()}}
}
main().catch(error=>{console.error(error);process.exitCode=1})
