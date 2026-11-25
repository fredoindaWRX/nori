const vm=require('node:vm')
if (!vm.SourceTextModule) {
 const test=require('node:test'),assert=require('node:assert/strict')
 test('all nine whole-Source gate cases execute in a bounded VM child',t=>{
  const environment={...process.env};delete environment.NODE_TEST_CONTEXT
  const child=require('node:child_process').spawnSync(process.execPath,['--experimental-vm-modules','--test','--test-reporter=tap',__filename],{env:environment,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024})
  assert.ifError(child.error);assert.equal(child.status,0,child.stdout+child.stderr)
  for(const summary of ['tests 9','pass 9','fail 0','skipped 0','cancelled 0'])assert.match(child.stdout,new RegExp('^# '+summary+'\\s*$','m'))
  assert.equal((child.stdout.match(/^ok \d+ - /gm)||[]).length,9)
  t.diagnostic('Verified nine actual child cases:\n'+child.stdout)
 })
} else {
const {test}=require('node:test'),assert=require('node:assert/strict')
const fixture=require('./helpers/local-chat-active-review-fixture.cjs')
test('Source self-review returns truthful unavailable without loose reads or model inference',async()=>{
 const f=await fixture();const answer=await f.run('look thru your project loiok for ways to improve it')
 assert.match(answer,/could not verify a successful read of my active packaged source/)
 assert.match(answer,/cannot present a code review/);assert.equal(f.requests.length,0);assert.equal(f.forbidden,0)
 assert.deepEqual(f.gateImports,['./active-project-review-evidence.mjs','./active-own-code-reader.mjs'])
})
test('explicit no-tools conversation leaves review helper modules unloaded',async()=>{
 const f=await fixture();assert.equal(await f.run('hello',{projectToolsRequested:false}),'ORDINARY_CHAT_OK')
 assert.equal(f.gateImports.length,0);assert.equal(f.requests.length,1);assert.equal(f.forbidden,0)
})
test('host capability adapter bypasses review and inference',async()=>{
 const f=await fixture({capability:true});assert.equal(await f.run('can you do coding work?'),'CAPABILITY_HOST_FIXTURE')
 assert.equal(f.gateImports.length,0);assert.equal(f.requests.length,0);assert.equal(f.forbidden,0)
})
for(const request of ['Review "C:\\Synthetic\\Project" for bugs','Review "\\\\server\\share\\Project" for bugs',
 'Review "file:///C:/Synthetic/Project" for bugs']){
 test('explicit target requires scoped review without factory/read/model: '+request,async()=>{
  const f=await fixture();const answer=await f.run(request)
  assert.match(answer,/specific project path/);assert.match(answer,/separate scoped review/)
  assert.equal(f.requests.length,0);assert.equal(f.forbidden,0)
  assert.deepEqual(f.gateImports,['./active-project-review-evidence.mjs'])
 })
}
test('recognized relative scope preserves the existing loop without claiming new review quality',async()=>{
 const f=await fixture();assert.equal(await f.run('Review project within apps for bugs'),'ORDINARY_CHAT_OK')
 assert.equal(f.gateImports.length,0);assert.equal(f.requests.length,1);assert.equal(f.forbidden,0)
})
test('pre-aborted review imports nothing and emits no success',async()=>{
 const f=await fixture(),c=new AbortController();c.abort()
 await assert.rejects(f.run('look thru your project loiok for ways to improve it',{signal:c.signal}),{name:'AbortError'})
 assert.equal(f.gateImports.length,0);assert.equal(f.requests.length,0);assert.equal(f.forbidden,0)
})
test('Stop during helper import prevents factory, model and late confirmation',async()=>{
 const c=new AbortController(),f=await fixture({onImport:()=>c.abort()})
 await assert.rejects(f.run('look thru your project loiok for ways to improve it',{signal:c.signal}),{name:'AbortError'})
 assert.deepEqual(f.gateImports,['./active-project-review-evidence.mjs'])
 assert.equal(f.requests.length,0);assert.equal(f.forbidden,0)
})

}
