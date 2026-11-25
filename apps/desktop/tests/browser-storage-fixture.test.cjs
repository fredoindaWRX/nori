const test=require('node:test')
const assert=require('node:assert/strict')
const {validateStorageFixtureUrl,browserStorageFixture}=require('../desktop/browser-storage-fixture.cjs')
test('browser storage fixture accepts only a token-bound exact loopback URL',async()=>{
  const valid='http://127.0.0.1:54321/nori-storage-fixture?fixture='+'a'.repeat(64)
  assert.equal(validateStorageFixtureUrl(valid),valid)
  for(const invalid of [undefined,'https://example.com/',valid.replace('127.0.0.1','localhost'),
    valid.replace('54321','0'),valid.replace('54321','65536'),valid+'#fragment',valid.replace('a'.repeat(64),'short')])
    assert.throws(()=>validateStorageFixtureUrl(invalid),/fixture/i)
  await assert.rejects(browserStorageFixture({mode:'other',url:valid}),/mode/)
})
test('storage fixture refuses redirected origins and prevents foreign navigation or new windows',async()=>{
  const url='http://127.0.0.1:54321/nori-storage-fixture?fixture='+'a'.repeat(64)
  const handlers={},result={localStorageVerified:true,indexedDbVerified:true}
  let destroyed=false,executed=false,openHandler
  class Window{
    constructor(){this.webContents={on:(name,handler)=>{handlers[name]=handler},
      setWindowOpenHandler:handler=>{openHandler=handler},getURL:()=> 'https://foreign.invalid/',
      executeJavaScript:async()=>{executed=true;return result}}}
    async loadURL(){}
    destroy(){destroyed=true}
  }
  await assert.rejects(browserStorageFixture({BrowserWindow:Window,session:{},mode:'check',url}),/exact loopback/)
  assert.equal(executed,false);assert.equal(destroyed,true)
  for(const name of ['will-redirect','will-navigate']){
    let prevented=false;handlers[name]({preventDefault(){prevented=true}},'https://foreign.invalid/')
    assert.equal(prevented,true)
  }
  assert.deepEqual(openHandler(),{action:'deny'})
})
