const test=require('node:test'),assert=require('node:assert/strict')
const {createModelCapacityCheck}=require('../desktop/model-resource-fit.cjs')
// Each model has its own qualified context (9B 196608, 27B 65536).
const ctx=profile=>({contextTokens:profile==='qwen3.8-27b'?32768:196608})
test('verified capacity chooses only fitting models without lowering context',async()=>{
 const fit=createModelCapacityCheck({readCommit:async()=>64*1024**3,readFreeRam:()=>8*1024**3,queryGpu:async()=> '12000\n'})
 assert.equal(await fit('qwen3.5-9b',ctx('qwen3.5-9b')),true)
 assert.equal(await fit('qwen3.8-27b',ctx('qwen3.8-27b')),false)
 await assert.rejects(fit('qwen3.5-9b',{contextTokens:4096}),/qualified context/)
 await assert.rejects(fit('qwen3.8-27b',{contextTokens:196608}),/qualified context/)
 await assert.rejects(fit('untrusted-model',ctx('untrusted-model')),/Unknown/)
})
test('a ready owned engine is reused, but a dead process does not count as capacity',async()=>{
 const fit=createModelCapacityCheck({readCommit:async()=>64*1024**3,readFreeRam:()=>0,queryGpu:async()=>{throw Error('Must not query')}})
 const current={modelId:'qwen3.5-9b',contextTokens:196608,child:{exitCode:null,signalCode:null}}
 assert.equal(await fit('qwen3.5-9b',{...ctx('qwen3.5-9b'),current}),true)
 current.child.exitCode=1
 assert.equal(await fit('qwen3.5-9b',{...ctx('qwen3.5-9b'),current}),false)
})
test('ambiguous GPU inventory fails closed and only owned known weights are reclaimable',async()=>{
 for(const output of ['12000\n8000','N/A','-1','Infinity']){
  const fit=createModelCapacityCheck({readCommit:async()=>64*1024**3,readFreeRam:()=>12*1024**3,queryGpu:async()=>output})
  await assert.rejects(fit('qwen3.8-27b',ctx('qwen3.8-27b')),/inventory/)
 }
 const fit=createModelCapacityCheck({readCommit:async()=>64*1024**3,readFreeRam:()=>12*1024**3,queryGpu:async()=> '9000'})
 assert.equal(await fit('qwen3.8-27b',{...ctx('qwen3.8-27b'),current:{modelId:'unowned',child:{exitCode:null}}}),false)
 assert.equal(await fit('qwen3.8-27b',{...ctx('qwen3.8-27b'),current:{modelId:'qwen3.5-9b',child:{exitCode:null}}}),true)
})

test('the 35B MoE needs both its GPU share and its RAM floor; an owned 35B is credited only its GPU share', async () => {
 const GIB = 1024 ** 3
 const fitWith = (ramGiB, gpuMiB) => createModelCapacityCheck({readCommit:async()=>64*1024**3, readFreeRam: () => ramGiB * GIB, queryGpu: async () => `${gpuMiB}\n` })
 assert.equal(await fitWith(15, 14000)('qwen3.6-35b', { contextTokens: 65536 }), true)
 assert.equal(await fitWith(6, 14000)('qwen3.6-35b', { contextTokens: 65536 }), false)
 assert.equal(await fitWith(15, 9000)('qwen3.6-35b', { contextTokens: 65536 }), false)
 const owned = { modelId: 'qwen3.6-35b', contextTokens: 65536, child: { exitCode: null, signalCode: null } }
 // Releasing the owned 35B frees only its ~13 GiB GPU share: with 2 GiB free that is room for the 9B at 64K.
 assert.equal(await fitWith(12, 2048)('qwen3.5-9b', { contextTokens: 65536, current: owned }), true)
})

test('2026-11-14: headroom must remain after loading, and Windows commit must have room, or the smaller model is used', async () => {
 const GIB = 1024 ** 3
 const fit = (ramGiB, commitGiB, read) => createModelCapacityCheck({ readFreeRam: () => ramGiB * GIB,
  readCommit: read ?? (async () => commitGiB * GIB), queryGpu: async () => '14000' })
 // The crash case: ~12 GiB free passed the old 10 GiB floor and left ~0.5 GiB after the 35B loaded.
 assert.equal(await fit(12, 40)('qwen3.6-35b', { contextTokens: 65536 }), false)
 assert.equal(await fit(15, 40)('qwen3.6-35b', { contextTokens: 65536 }), true)
 // Plenty of RAM but Windows' commit limit nearly used up (the 01:35 low-virtual-memory case).
 assert.equal(await fit(20, 20)('qwen3.6-35b', { contextTokens: 65536 }), false)
 assert.equal(await fit(20, 24)('qwen3.6-35b', { contextTokens: 65536 }), true)
 // The 9B still fits where the 35B does not, so she stays up on the fallback.
 assert.equal(await fit(12, 20)('qwen3.5-9b', { contextTokens: 65536 }), true)
 // An unreadable commit counter does not block loading.
 assert.equal(await fit(15, 0, async () => { throw Error('no counter') })('qwen3.6-35b', { contextTokens: 65536 }), true)
})
