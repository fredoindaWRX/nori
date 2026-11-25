const test = require('node:test')
const assert = require('node:assert/strict')
const {parseGpus,parseInstalledRam,scanHardware,selectModel} = require('../desktop/model-hardware-selection.cjs')
const GIB = 1024 ** 3
const host = {platform:'win32',arch:'x64',totalRamBytes:16*GIB,availableRamBytes:8*GIB,
  gpus:[{index:0,computeCapability:'8.9',driverVersion:'616.92',totalBytes:8*GIB,freeBytes:6*GIB}]}
const profile = {id:'fixture-small',backend:'norama-cuda',platform:'win32',arch:'x64',bundled:true,
  qualified:true,priority:1,minimumTotalRamBytes:8*GIB,minimumAvailableRamBytes:4*GIB,
  weightBytes:2*GIB,kvCacheBytes:GIB/2,workspaceBytes:GIB,safetyMarginBytes:GIB/2,computeCapabilities:['8.9'],minimumDriverVersion:'600.00'}

test('selects the best fitting qualified bundled model deterministically',()=>{
  const large = {...profile,id:'fixture-large',priority:2,weightBytes:5*GIB}
  assert.equal(selectModel(host,[large,profile]).selected.id,profile.id)
  assert.equal(selectModel({...host,gpus:[{...host.gpus[0],freeBytes:8*GIB}]},[profile,large]).selected.id,large.id)
})
test('current CUDA-only catalog refuses CPU-only and unsupported GPUs',()=>{
  assert.equal(selectModel({...host,gpus:[]},[profile]).status,'NO_COMPATIBLE_MODEL')
  assert.equal(selectModel({...host,gpus:[{...host.gpus[0],computeCapability:'7.5'}]},[profile]).selected,null)
})
test('future CPU model requires its own qualified runtime profile',()=>{
  const cpu = {...profile,backend:'norama-cpu',id:'fixture-cpu'}
  assert.equal(selectModel({...host,gpus:[]},[cpu]).selected.backend,'norama-cpu')
  assert.equal(selectModel({...host,gpus:[]},[{...cpu,qualified:false}]).selected,null)
})
test('available RAM and free VRAM matter independently of installed capacity',()=>{
  assert.equal(selectModel({...host,availableRamBytes:3*GIB},[profile]).selected,null)
  assert.equal(selectModel({...host,gpus:[{...host.gpus[0],freeBytes:3*GIB}]},[profile]).selected,null)
})
test('budgets include weights, cache, workspace and safety margin',()=>{
  const result=selectModel(host,[profile])
  assert.equal(result.selected.requiredGpuBytes,4*GIB)
  assert.equal(selectModel({...host,gpus:[{...host.gpus[0],freeBytes:4*GIB-1}]},[profile]).selected,null)
})

test('qualified label cannot admit zero weights or a zero safety reserve',()=>{
  for(const backend of ['norama-cuda','norama-cpu']){
    for(const change of [{weightBytes:0},{safetyMarginBytes:0}]){
      const result=selectModel(host,[{...profile,backend,...change}])
      assert.equal(result.status,'NO_COMPATIBLE_MODEL')
      assert.equal(result.selected,null)
      assert.deepEqual(result.evaluated[0].reasons,['Invalid or incomplete runtime profile'])
    }
  }
})
test('refuses missing files, unqualified candidates, wrong OS/arch and incomplete budgets',()=>{
  for(const change of [{bundled:false},{qualified:false},{platform:'linux'},{arch:'arm64'},
    {workspaceBytes:undefined},{computeCapabilities:[]},{weightBytes:-1}])
    assert.equal(selectModel(host,[{...profile,...change}]).selected,null)
})
test('selects another GPU only when the qualified runtime supports explicit device selection',()=>{
  const result=selectModel({...host,gpus:[{...host.gpus[0],freeBytes:GIB},
    {...host.gpus[0],index:1}]},[{...profile,supportsGpuSelection:true}])
  assert.equal(result.selected.gpuIndex,1)
  assert.equal(selectModel({...host,gpus:[{...host.gpus[0],freeBytes:GIB},
    {...host.gpus[0],index:1}]},[profile]).selected,null)
})
test('GPU parser refuses unknown or corrupt capabilities rather than assuming support',()=>{
  assert.equal(parseGpus('0, Test GPU, 8192, 4096, 8.9, 616.92')[0].freeBytes,4*GIB)
  assert.throws(()=>parseGpus('0, GPU, 8192, N/A, N/A, 616.92'))
  assert.throws(()=>parseGpus('0, GPU, 8192, 9999, 8.9, 616.92'))
  assert.throws(()=>parseGpus('9007199254740993, GPU, 8192, 4096, 8.9, 616.92'))
})
test('explicit GPU selection rejects malformed indices and missing GPU records',()=>{
  const selectable = {...profile,supportsGpuSelection:true}
  for (const index of [-1, .5, '1', undefined, NaN, Infinity, Number.MAX_SAFE_INTEGER+1])
    assert.equal(selectModel({...host,gpus:[{...host.gpus[0],index}]},[selectable]).selected,null)
  assert.equal(selectModel({...host,gpus:[null]},[selectable]).selected,null)
  assert.equal(selectModel({...host,gpus:[null,{...host.gpus[0],index:1}]},[selectable]).selected.gpuIndex,1)
})
test('scan is read-only, bounded, hidden and uses no shell',async()=>{
  let calls=0
  const result=await scanHardware({system:{platform:()=> 'win32',arch:()=> 'x64',totalmem:()=>16*GIB,
    freemem:()=>8*GIB,cpus:()=>[{},{}]},run:async(command,args,options)=>{
      calls++;assert.equal(options.shell,false)
      assert.equal(options.windowsHide,true);assert.equal(options.timeout,5000)
      if (command.endsWith('powershell.exe')) {
        assert.ok(command.includes('System32\\WindowsPowerShell\\v1.0\\powershell.exe'))
        assert.deepEqual(args.slice(0,3),['-NoProfile','-NonInteractive','-Command'])
        assert.ok(args[3].includes('Get-CimInstance -ClassName Win32_PhysicalMemory'))
        return {stdout:JSON.stringify([String(8*GIB),String(8*GIB)])}
      }
      assert.equal(command,'nvidia-smi')
      assert.ok(args[0].includes('memory.free'))
      return {stdout:'0, Test GPU, 8192, 4096, 8.9, 616.92'}
    }})
  assert.equal(calls,2);assert.equal(result.gpus.length,1)
  assert.equal(result.installedRamBytes,16*GIB)
  assert.equal(result.installedRamSource,'Win32_PhysicalMemory.Capacity')
})

test('hardware scan refreshes available RAM after external queries finish',async()=>{
  let reads=0,queries=0
  const result=await scanHardware({system:{platform:()=> 'win32',arch:()=> 'x64',
    totalmem:()=>16*GIB,cpus:()=>[{}],freemem:()=>{
      reads++
      if(reads===1)return 8*GIB
      assert.equal(queries,2)
      return 2*GIB
    }},run:async command=>{
      queries++
      return {stdout:command.endsWith('powershell.exe')?JSON.stringify([String(16*GIB)]):
        '0, Test GPU, 8192, 4096, 8.9, 616.92'}
    }})
  assert.equal(reads,2)
  assert.equal(result.availableRamBytes,2*GIB)
  assert.equal(selectModel(result,[profile]).selected,null)
})
test('missing NVIDIA scan fails closed for CUDA without starting any model',async()=>{
  const result=await scanHardware({run:async()=>{throw Error('missing')}})
  assert.deepEqual(result.gpus,[]);assert.ok(result.gpuScanError)
  assert.equal(selectModel(result,[profile]).selected,null)
})
test('old, missing and malformed drivers cannot qualify an otherwise compatible GPU',()=>{
  for(const driverVersion of ['599.99',undefined,'N/A'])
    assert.equal(selectModel({...host,gpus:[{...host.gpus[0],driverVersion}]},[profile]).selected,null)
  assert.equal(selectModel(host,[{...profile,minimumDriverVersion:'616.92'}]).selected.id,profile.id)
  assert.equal(selectModel(host,[{...profile,minimumDriverVersion:undefined}]).selected,null)
  assert.equal(selectModel({...host,gpus:[{...host.gpus[0],driverVersion:'600.10'}]},
    [{...profile,minimumDriverVersion:'600.9'}]).selected.id,profile.id)
})
test('CPU selection accounts for the entire working budget rather than a low declared RAM minimum',()=>{
  const cpu={...profile,backend:'norama-cpu',weightBytes:7*GIB}
  assert.equal(selectModel({...host,gpus:[]},[cpu]).selected,null)
  const result=selectModel({...host,availableRamBytes:10*GIB,gpus:[]},[cpu])
  assert.equal(result.selected.requiredRamBytes,9*GIB)
})

// Synthetic policy fixtures only: these are not SoN model hardware requirements.
const catalog = [
  { ...profile, id: 'fixture-cuda', priority: 100 },
  { ...profile, id: 'fixture-cpu-cached', backend: 'norama-cpu', priority: 60,
    minimumTotalRamBytes: 24 * GIB, minimumAvailableRamBytes: 15 * GIB,
    weightBytes: 2 * GIB, kvCacheBytes: .75 * GIB, workspaceBytes: 8 * GIB,
    safetyMarginBytes: 4 * GIB },
  { ...profile, id: 'fixture-cpu-streaming', backend: 'norama-cpu', priority: 50,
    minimumTotalRamBytes: 16 * GIB, minimumAvailableRamBytes: 12 * GIB,
    weightBytes: 2 * GIB, kvCacheBytes: .75 * GIB, workspaceBytes: GIB,
    safetyMarginBytes: 4 * GIB },
]
test('installed RAM with reserved capacity can select a synthetic streaming CPU profile',()=>{
  const laptop={...host,gpus:[],totalRamBytes:15.5*GIB,availableRamBytes:13*GIB,installedRamBytes:16*GIB}
  assert.equal(selectModel(laptop,catalog).selected.id,'fixture-cpu-streaming')
  assert.equal(selectModel({...laptop,installedRamBytes:null},catalog).selected,null)
  // Installed capacity never replaces the actual free-memory safety gate.
  assert.equal(selectModel({...laptop,availableRamBytes:12*GIB-1},catalog).selected,null)
  assert.equal(selectModel({...laptop,totalRamBytes:11*GIB,availableRamBytes:10*GIB},catalog).selected,null)
})

test('installed RAM parser rejects malformed, missing, inconsistent and unsafe capacities',()=>{
  assert.equal(parseInstalledRam(JSON.stringify([String(8*GIB),String(8*GIB)]),15.5*GIB),16*GIB)
  for (const value of ['not-json','null','[]','{}','[0]','["0"]','["-1"]','["1e12"]',
    '["9007199254740992"]',JSON.stringify([String(8*GIB)]),
    JSON.stringify(['9007199254740991','9007199254740991'])])
    assert.throws(()=>parseInstalledRam(value,15.5*GIB),value)
  assert.throws(()=>selectModel({...host,installedRamBytes:8*GIB},catalog))
})

test('unavailable or corrupt installed RAM scans fall back conservatively',async()=>{
  const system={platform:()=> 'win32',arch:()=> 'x64',totalmem:()=>15.5*GIB,
    freemem:()=>13*GIB,cpus:()=>[{}]}
  for (const stdout of [undefined,'[]','["1"]','not-json']) {
    const result=await scanHardware({system,run:async(command)=>{
      if(command==='nvidia-smi')throw Error('No NVIDIA GPU')
      if(stdout===undefined)throw Error('Provider unavailable')
      return {stdout}
    }})
    assert.equal(result.installedRamBytes,null)
    assert.ok(result.installedRamScanError)
    assert.equal(result.totalRamBytes,15.5*GIB)
    assert.equal(result.availableRamBytes,13*GIB)
    assert.equal(selectModel(result,catalog).selected,null)
  }
})

test('missing NVIDIA tools still permit a safely budgeted CPU model after a valid RAM scan',async()=>{
  const result=await scanHardware({system:{platform:()=> 'win32',arch:()=> 'x64',totalmem:()=>15.5*GIB,
    freemem:()=>13*GIB,cpus:()=>[{}]},run:async(command)=>{
      if(command==='nvidia-smi')throw Error('No NVIDIA GPU')
      return {stdout:JSON.stringify([String(16*GIB)])}
    }})
  assert.ok(result.gpuScanError)
  assert.equal(selectModel(result,catalog).selected.backend,'norama-cpu')
})

test('non-Windows scans do not invoke Windows memory providers',async()=>{
  let calls=0
  const result=await scanHardware({system:{platform:()=> 'linux',arch:()=> 'x64',totalmem:()=>16*GIB,
    freemem:()=>13*GIB,cpus:()=>[{}]},run:async(command)=>{
      calls++;assert.equal(command,'nvidia-smi');throw Error('Missing')
    }})
  assert.equal(calls,1)
  assert.equal(result.installedRamBytes,null)
  assert.equal(selectModel(result,catalog).selected,null)
})

test('reserved RAM also respects installed-capacity requirements for CUDA and cached CPU profiles',()=>{
  const gpuLaptop={...host,totalRamBytes:7.5*GIB,installedRamBytes:8*GIB,availableRamBytes:4*GIB}
  assert.equal(selectModel(gpuLaptop,catalog).selected.id,'fixture-cuda')
  assert.equal(selectModel({...gpuLaptop,availableRamBytes:4*GIB-1},catalog).selected,null)
  const cpuLaptop={...host,gpus:[],totalRamBytes:23.5*GIB,installedRamBytes:24*GIB,availableRamBytes:16*GIB}
  assert.equal(selectModel(cpuLaptop,catalog).selected.id,'fixture-cpu-cached')
  assert.equal(selectModel({...cpuLaptop,installedRamBytes:null},catalog).selected.id,'fixture-cpu-streaming')
})
