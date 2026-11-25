const test=require('node:test')
const assert=require('node:assert/strict')
const fs=require('node:fs')
const {join,dirname}=require('node:path')
const {tmpdir}=require('node:os')
const {createHash}=require('node:crypto')
const {EventEmitter}=require('node:events')
const {PassThrough}=require('node:stream')
const {selectPortableModel,startupSampleDigest}=require('../desktop/portable-model-selection.cjs')
const {selectModel}=require('../desktop/model-hardware-selection.cjs')
const {startNativeService}=require('../desktop/native-service.cjs')
const GIB=2**30
test('automatic portable startup refuses an unverified interpreter override',async()=>{
  const f=fixture()
  try{
    f.put('external/python.exe','unverified-interpreter')
    let spawned=false
    await assert.rejects(startNativeService({root:f.root,
      environment:{NORI_MINI_AUTO_MODEL:'1',NORI_RUNTIME_PYTHON:join(f.root,'external/python.exe')},
      scanHardware:async()=>host,spawnChild:()=>{spawned=true;throw Error('Unexpected launch')}}),
      /requires its verified bundled Python/)
    assert.equal(spawned,false)
  }finally{f.cleanup()}
})
test('native startup binds its configuration read to the selected portable digest',async()=>{
  const f=fixture()
  try{
    let checks=0,spawned=false
    const signal={get aborted(){
      // The startup cancellation check follows completed portable verification.
      if(++checks===15)f.put(f.configName,fs.readFileSync(join(f.root,f.configName),'utf8')+'\n')
      return false
    }}
    await assert.rejects(startNativeService({root:f.root,signal,
      environment:{NORI_MINI_AUTO_MODEL:'1'},scanHardware:async()=>host,
      spawnChild:()=>{spawned=true;throw Error('Unexpected launch')}}),
      /configuration changed between selection and native startup/)
    assert.equal(spawned,false)
    assert.equal(checks,15)
  }finally{f.cleanup()}
})
test('artifact changed during the final hardware scan loses its verification before launch',async()=>{
  const f=fixture()
  try{
    let scans=0,spawned=false
    await assert.rejects(startNativeService({root:f.root,environment:{NORI_MINI_AUTO_MODEL:'1'},
      scanHardware:async()=>{
        if(++scans===2)f.put('models/model.gguf','changed-after-verification')
        return host
      },spawnChild:()=>{spawned=true;throw Error('Unexpected launch')}}),/artifact changed after verification/)
    assert.equal(scans,2)
    assert.equal(spawned,false)
  }finally{f.cleanup()}
})
test('post-verification GPU replacement cannot return a READY refusal or switch devices',async()=>{
  const f=fixture()
  try{
    f.profile.supportsGpuSelection=true;f.save()
    let scans=0
    await assert.rejects(selectPortableModel(f.root,{scan:async()=>++scans===1?host:
      {...host,gpus:[{...host.gpus[0],index:1}]}}),error=>{
      assert.equal(error.code,'NORI_NO_COMPATIBLE_MODEL')
      assert.equal(error.selection.status,'NO_COMPATIBLE_MODEL')
      assert.equal(error.selection.selected,null)
      return true
    })
    assert.equal(scans,2)
  }finally{f.cleanup()}
})
test('memory lost while artifacts are verified is rejected before supervised launch',async()=>{
  for(const mode of ['ram','vram']){
    const f=fixture()
    try{
      let scans=0,spawned=false
      await assert.rejects(startNativeService({root:f.root,environment:{NORI_MINI_AUTO_MODEL:'1'},
        scanHardware:async()=>{
          if(++scans===1)return host
          return mode==='ram'?{...host,availableRamBytes:GIB}:
            {...host,gpus:[{...host.gpus[0],freeBytes:GIB}]}
        },spawnChild:()=>{spawned=true;throw Error('Unexpected launch')}}),
        /Hardware availability changed/)
      assert.equal(scans,2)
      assert.equal(spawned,false)
    }finally{f.cleanup()}
  }
})
test('portable cancellation during streamed integrity verification prevents launch',async()=>{
  const f=fixture()
  try{
    let checks=0,spawned=false
    // Startup, selector entry, and post-scan checks pass; first digest chunk cancels.
    // A deterministic signal avoids racing a wall-clock timer against disk I/O.
    const signal={get aborted(){return ++checks>=4}}
    await assert.rejects(startNativeService({root:f.root,signal,
      environment:{NORI_MINI_AUTO_MODEL:'1'},scanHardware:async()=>host,
      spawnChild:()=>{spawned=true;throw Error('Unexpected launch')}}),/cancelled/)
    assert.equal(spawned,false)
    assert.equal(checks,4)
  }finally{f.cleanup()}
})
test('matching startup samples cannot bypass whole-file integrity for a large model',async()=>{
  const f=fixture()
  try{
    const name='models/model.gguf',path=join(f.root,name)
    const handle=fs.openSync(path,'w');try{fs.ftruncateSync(handle,256*1024*1024)}finally{fs.closeSync(handle)}
    const hash=createHash('sha256')
    for await(const chunk of fs.createReadStream(path))hash.update(chunk)
    f.profile.artifactSha256[name]=hash.digest('hex')
    f.profile.startupSampleSha256={[name]:startupSampleDigest(path)}
    f.save()
    // Offset 1 MiB is outside the 64 evenly spaced 64 KiB startup samples.
    const writer=fs.openSync(path,'r+');try{fs.writeSync(writer,Buffer.from([1]),0,1,1024*1024)}finally{fs.closeSync(writer)}
    assert.equal(startupSampleDigest(path),f.profile.startupSampleSha256[name])
    await assert.rejects(selectPortableModel(f.root,{scan:async()=>host}),/artifact integrity check failed/)
  }finally{f.cleanup()}
})
test('explicit temporary bridge is integrity-bound and hardware-gated while SoN remains the target',async()=>{
  const root=join(__dirname,'../../..')
  const catalog=JSON.parse(fs.readFileSync(join(root,'runtime/norllama/mini-model-catalog.json'),'utf8'))
  const config=JSON.parse(fs.readFileSync(join(root,'runtime/norllama/config.json'),'utf8'))
  assert.deepEqual(catalog.requestedModels,['nori-20b-son'])
  assert.equal(catalog.activationStatus,'TEMPORARY_IMPORTED_BRIDGE_ACTIVE_SON_DEVELOPMENT_PENDING')
  assert.equal(catalog.models.length,1)
  const profile=catalog.models[0]
  assert.equal(profile.id,'llama3.2-3b-instruct')
  assert.equal(profile.configPath,'runtime/norllama/config.json')
  assert.equal(profile.qualified,true)
  assert.match(profile.qualificationScope,/Temporary imported local bridge/)
  assert.equal(config.model_id,profile.id)
  assert.equal(config.status,'TEMPORARY_LOCAL_BRIDGE')
  assert.equal(config.provenance.nori_trained,false)
  assert.equal(config.provenance.owner_target,'nori-20b-son')
  const realHost={platform:'win32',arch:'x64',totalRamBytes:16*GIB,availableRamBytes:8*GIB,
    gpus:[{index:0,computeCapability:'8.9',driverVersion:'616.92',totalBytes:16*GIB,freeBytes:12*GIB}]}
  const selected=await selectPortableModel(root,{scan:async()=>realHost})
  assert.equal(selected.selection.status,'READY')
  assert.equal(selected.selection.selected.id,'llama3.2-3b-instruct')
  const rejected=selectModel({...realHost,gpus:[]},catalog.models)
  assert.equal(rejected.status,'NO_COMPATIBLE_MODEL')
  assert.equal(rejected.selected,null)
})
const host={platform:'win32',arch:'x64',totalRamBytes:16*GIB,availableRamBytes:8*GIB,
  gpus:[{index:0,computeCapability:'8.9',driverVersion:'616.92',totalBytes:8*GIB,freeBytes:6*GIB}]}
function fixture(){
  const root=fs.mkdtempSync(join(tmpdir(),'Nori mini with spaces '))
  const put=(name,data)=>{const p=join(root,name);fs.mkdirSync(dirname(p),{recursive:true});fs.writeFileSync(p,data)}
  const config={model_id:'fixture-small',engine_binary:'engine/worker.exe',model_path:'models/model.gguf'}
  const configName='runtime/norllama/small.json'
  put(configName,JSON.stringify(config))
  put('runtime/norllama/config.json',JSON.stringify({...config,model_id:'default-not-selected'}))
  for(const name of ['engine/worker.exe','models/model.gguf','runtime/norllama/norllama.py','python/Python311/python.exe'])put(name,'fixture-never-executed')
  const profile={id:config.model_id,configPath:configName,backend:'norama-cuda',platform:'win32',arch:'x64',
    bundled:true,qualified:true,priority:1,minimumTotalRamBytes:8*GIB,minimumAvailableRamBytes:4*GIB,
    weightBytes:2*GIB,kvCacheBytes:GIB/2,workspaceBytes:GIB,safetyMarginBytes:GIB/2,computeCapabilities:['8.9'],minimumDriverVersion:'600.00',artifactSha256:{}}
  for(const name of [configName,config.engine_binary,config.model_path,'runtime/norllama/norllama.py','python/Python311/python.exe'])
    profile.artifactSha256[name]=createHash('sha256').update(fs.readFileSync(join(root,name))).digest('hex')
  const catalog={schema:1,models:[profile]}
  const save=()=>put('runtime/norllama/mini-model-catalog.json',JSON.stringify(catalog))
  save()
  return {root,put,profile,catalog,save,configName,cleanup:()=>{
    assert.equal(dirname(root),tmpdir());assert.ok(root.startsWith(join(tmpdir(),'Nori mini with spaces ')))
    fs.rmSync(root,{recursive:true,force:true})
  }}
}

test('explicit large CPU cache must fit the catalog memory budget before any launch',async()=>{
  for(const mode of ['valid','unsupported-budget','underbudgeted-workspace','insufficient-ram']){
    const f=fixture()
    try{
      const config=JSON.parse(fs.readFileSync(join(f.root,f.configName),'utf8'))
      config.compute_backend='cpu';config.cpu_weight_cache_budget=mode==='unsupported-budget'?7*GIB:8*GIB
      f.profile.backend='norama-cpu';f.profile.workspaceBytes=mode==='underbudgeted-workspace'?4*GIB:8*GIB
      f.put(f.configName,JSON.stringify(config))
      f.profile.artifactSha256[f.configName]=createHash('sha256').update(fs.readFileSync(join(f.root,f.configName))).digest('hex')
      f.save()
      const selectedHost={...host,gpus:[],totalRamBytes:32*GIB,availableRamBytes:mode==='insufficient-ram'?8*GIB:20*GIB}
      if(mode==='valid'){
        const result=await selectPortableModel(f.root,{scan:async()=>selectedHost})
        assert.equal(result.selection.status,'READY')
        assert.equal(result.selection.selected.backend,'norama-cpu')
      }else await assert.rejects(selectPortableModel(f.root,{scan:async()=>selectedHost}),error=>{
        assert.equal(error.code,'NORI_NO_COMPATIBLE_MODEL')
        assert.equal(error.selection.status,'NO_COMPATIBLE_MODEL')
        return true
      })
    }finally{f.cleanup()}
  }
})
test('portable selection verifies artifacts and preserves original configuration at relocated path',async()=>{
  const f=fixture()
  try{
    const before=fs.readFileSync(join(f.root,'runtime/norllama/config.json'))
    let scans=0
    const refreshed={...host,availableRamBytes:7*GIB,gpus:[{...host.gpus[0],freeBytes:5*GIB}]}
    const result=await selectPortableModel(f.root,{scan:async()=>++scans===1?host:refreshed})
    assert.equal(scans,2)
    assert.deepEqual(result.hardware,refreshed)
    assert.equal(result.selection.selected.id,'fixture-small')
    assert.equal(result.configPath,join(f.root,f.configName))
    assert.deepEqual(fs.readFileSync(join(f.root,'runtime/norllama/config.json')),before)
  }finally{f.cleanup()}
})
test('large startup sample covers first, last and spaced regions deterministically',()=>{
  const root=fs.mkdtempSync(join(tmpdir(),'Nori startup sample '))
  try{
    const path=join(root,'large.bin'),size=5*1024*1024
    fs.writeFileSync(path,Buffer.alloc(size,17))
    const before=startupSampleDigest(path)
    assert.equal(before,startupSampleDigest(path))
    for(const offset of [0,Math.floor((size-64*1024)*31/63),size-1]){
      const handle=fs.openSync(path,'r+');try{fs.writeSync(handle,Buffer.from([99]),0,1,offset)}finally{fs.closeSync(handle)}
      assert.notEqual(startupSampleDigest(path),before)
      fs.writeFileSync(path,Buffer.alloc(size,17))
    }
  }finally{
    assert.equal(dirname(root),tmpdir());assert.ok(root.startsWith(join(tmpdir(),'Nori startup sample ')))
    fs.rmSync(root,{recursive:true,force:true})
  }
})
test('unfit hardware, unqualified profile, missing model and corruption all refuse launch',async()=>{
  for(const mode of ['cpu','unqualified','missing','corrupt','no-hash','unbound-launcher','corrupt-python']){
    const f=fixture()
    try{
      if(mode==='unqualified'){f.profile.qualified=false;f.save()}
      if(mode==='missing')fs.unlinkSync(join(f.root,'models/model.gguf'))
      if(mode==='corrupt')f.put('models/model.gguf','corrupt-data')
      if(mode==='no-hash'){f.profile.artifactSha256={};f.save()}
      if(mode==='unbound-launcher'){delete f.profile.artifactSha256['runtime/norllama/norllama.py'];f.save()}
      if(mode==='corrupt-python')f.put('python/Python311/python.exe','changed-python')
      let spawned=false
      await assert.rejects(startNativeService({root:f.root,environment:{NORI_MINI_AUTO_MODEL:'1'},
        scanHardware:async()=>mode==='cpu'?{...host,gpus:[]}:host,
        spawnChild:()=>{spawned=true;throw Error('Unexpected spawn')}}),/No bundled|integrity/)
      assert.equal(spawned,false)
    }finally{f.cleanup()}
  }
})
test('supporting libraries require intact contained files and integrity bindings before launch',async()=>{
  for(const mode of ['valid','missing','corrupt','unbound','escape','malformed','oversized']){
    const f=fixture()
    try{
      const name='engine/support.dll'
      f.put(name,'support-library-fixture')
      f.profile.runtimeFiles=[name]
      f.profile.artifactSha256[name]=createHash('sha256').update(fs.readFileSync(join(f.root,name))).digest('hex')
      if(mode==='missing')fs.unlinkSync(join(f.root,name))
      if(mode==='corrupt')f.put(name,'changed-library')
      if(mode==='unbound')delete f.profile.artifactSha256[name]
      if(mode==='escape'){
        f.profile.runtimeFiles=['../outside.dll']
        f.profile.artifactSha256['../outside.dll']='a'.repeat(64)
      }
      if(mode==='malformed')f.profile.runtimeFiles='support.dll'
      if(mode==='oversized')f.profile.runtimeFiles=Array(33).fill(name)
      f.save()
      if(mode==='valid'){
        const result=await selectPortableModel(f.root,{scan:async()=>host})
        assert.equal(result.selection.selected.id,f.profile.id)
      }else{
        let spawned=false
        await assert.rejects(startNativeService({root:f.root,environment:{NORI_MINI_AUTO_MODEL:'1'},
          scanHardware:async()=>host,spawnChild:()=>{spawned=true;throw Error('Unexpected spawn')}}))
        assert.equal(spawned,false)
      }
    }finally{f.cleanup()}
  }
})

test('catalog backend must match the actual configuration before any launch',async()=>{
  for(const mode of ['cpu-labelled-cuda','cuda-labelled-cpu','cpu-half-cache','cpu-extended-context']){
    const f=fixture()
    try{
      const config=JSON.parse(fs.readFileSync(join(f.root,f.configName),'utf8'))
      f.profile.backend=mode==='cuda-labelled-cpu'?'norama-cuda':'norama-cpu'
      config.compute_backend=mode==='cpu-labelled-cuda'?'cuda':'cpu'
      if(mode==='cpu-half-cache')config.cache_precision='f16'
      if(mode==='cpu-extended-context')config.prompt_limit=4096
      f.put(f.configName,JSON.stringify(config))
      f.profile.artifactSha256[f.configName]=createHash('sha256').update(fs.readFileSync(join(f.root,f.configName))).digest('hex')
      f.save()
      let spawned=false
      await assert.rejects(startNativeService({root:f.root,environment:{NORI_MINI_AUTO_MODEL:'1'},
        scanHardware:async()=>host,spawnChild:()=>{spawned=true;throw Error('Unexpected spawn')}}),/No bundled/)
      assert.equal(spawned,false)
    }finally{f.cleanup()}
  }
})

test('portable startup accepts readiness after 30 seconds and stays bounded at 90 seconds',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']})
  for(const mode of ['late-ready','never-ready','explicit-deadline']){
    const f=fixture()
    let service
    try{
      const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough()
      child.exitCode=null;child.pid=1234
      child.stdin.on('finish',()=>{child.exitCode=0;child.emit('exit',0)})
      child.kill=()=>{child.exitCode=0;child.emit('exit',0)}
      let launched
      const spawned=new Promise(resolve=>{launched=resolve})
      const pending=startNativeService({root:f.root,environment:{NORI_MINI_AUTO_MODEL:'1'},scanHardware:async()=>host,
        ...(mode==='explicit-deadline'?{startupTimeout:20}:{}),
        spawnChild:()=>{queueMicrotask(launched);return child},
        fetcher:async()=>new Response(JSON.stringify({ready:true,backend:'norama-independent',worker_pid:4321,
          model_id:'fixture-small',cache_precision:'f32'}))})
      pending.catch(()=>{})
      await spawned
      if(mode==='late-ready'){
        t.mock.timers.tick(31000)
        assert.equal(child.exitCode,null,'portable startup was prematurely stopped')
        child.stdout.write(JSON.stringify({runtime:'NorLlama',backend:'norama-independent',port:45678,
          worker_pid:4321,cache_precision:'f32'})+'\n')
        service=await pending
        assert.equal(service.status.modelId,'fixture-small')
        await service.stop();service=null
      }else{
        t.mock.timers.tick(mode==='explicit-deadline'?21:90001)
        await assert.rejects(pending,/startup deadline exceeded/)
      }
      assert.equal(child.exitCode,0,'owned child cleanup must complete')
    }finally{if(service)await service.stop();f.cleanup()}
  }
})

test('selected configuration reaches supervised startup and model health agreement',async()=>{
  const f=fixture()
  try{
    const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough()
    child.exitCode=null;child.pid=1234
    child.stdin.on('finish',()=>{child.exitCode=0;child.emit('exit',0)})
    child.kill=()=>{child.exitCode=0;child.emit('exit',0)}
    let commandArgs
    const service=await startNativeService({root:f.root,environment:{NORI_MINI_AUTO_MODEL:'1',
      NORI_RUNTIME_PYTHON:join(f.root,'python/Python311/python.exe')},scanHardware:async()=>host,
      spawnChild:(command,args)=>{
        commandArgs=args
        queueMicrotask(()=>child.stdout.write(JSON.stringify({runtime:'NorLlama',backend:'norama-independent',
          port:45678,worker_pid:4321,cache_precision:'f32'})+'\n'))
        return child
      },fetcher:async()=>new Response(JSON.stringify({ready:true,backend:'norama-independent',worker_pid:4321,
        model_id:'fixture-small',cache_precision:'f32'}))})
    assert.equal(commandArgs[commandArgs.indexOf('--config')+1],join(f.root,f.configName))
    assert.equal(service.status.modelId,'fixture-small')
    assert.equal(service.status.automaticModelSelection.status,'READY')
    assert.equal(service.environment.NORI_RUNTIME_MODEL_ID,'fixture-small')
    await service.stop()
    assert.equal(child.exitCode,0)
  }finally{f.cleanup()}
})
test('catalog path escape, duplicate IDs, nonzero GPU and cancellation are refused',async()=>{
  for(const mode of ['escape','duplicate','gpu','cancel']){
    const f=fixture()
    try{
      if(mode==='escape')f.profile.configPath='../outside.json'
      if(mode==='duplicate')f.catalog.models.push({...f.profile})
      if(mode==='gpu')f.profile.supportsGpuSelection=true
      f.save()
      const controller=new AbortController();if(mode==='cancel')controller.abort()
      await assert.rejects(selectPortableModel(f.root,{signal:controller.signal,
        scan:async()=>mode==='gpu'?{...host,gpus:[{...host.gpus[0],index:1}]}:host}))
    }finally{f.cleanup()}
  }
})
