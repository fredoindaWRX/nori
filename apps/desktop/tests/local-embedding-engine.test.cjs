// The memory-embedding worker uses the pinned native CPU engine when every file
// matches, and falls back to the old engine on any missing or changed file.
const test=require('node:test'),assert=require('node:assert/strict')
const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=require('node:fs'),{join}=require('node:path'),{tmpdir}=require('node:os')
const {fastEngine,FAST_FILES}=require('../desktop/local-embedding-service.cjs')
test('fast engine is chosen only when every pinned file matches',t=>{
  const root=mkdtempSync(join(tmpdir(),'nori-embed-engine-'));t.after(()=>rmSync(root,{recursive:true,force:true}))
  assert.equal(fastEngine(root),null,'missing engine falls back')
  const dir=join(root,'engine/memory-embedding/bin');mkdirSync(dir,{recursive:true})
  for(const name of Object.keys(FAST_FILES))writeFileSync(join(dir,name),'not the real '+name)
  assert.equal(fastEngine(root),null,'changed files fall back')
  assert.equal(Object.keys(FAST_FILES).length,8)
  assert.ok(Object.values(FAST_FILES).every(h=>/^[a-f0-9]{64}$/.test(h)))
})
test('the real built engine passes its pins when present',t=>{
  const built='C:/Users/Studio/AppData/Local/Temp/claude/1960a614670cbc94/68fc6cdc-90ab-493c-9a00-0d8528f0d6ff/scratchpad/fakeroot'
  if(!require('node:fs').existsSync(join(built,'engine/memory-embedding/bin/llama-server.exe')))return t.skip('built engine not staged here')
  assert.match(fastEngine(built),/memory-embedding[\\/]bin[\\/]llama-server\.exe$/)
})
