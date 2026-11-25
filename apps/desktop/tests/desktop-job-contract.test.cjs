const test=require('node:test')
const assert=require('node:assert/strict')
const {mkdtempSync,mkdirSync,writeFileSync,existsSync,symlinkSync,rmSync}=require('node:fs')
const {join,resolve}=require('node:path')
const {desktopJobPaths,readDesktopJobSpec}=require('../desktop/desktop-job-contract.cjs')
const fixtures=new Set()
function fixture(){
  const root=mkdtempSync(join(resolve(__dirname,'../../../verification'),'.native-desktop-job-contract-'))
  fixtures.add(root)
  mkdirSync(join(root,'verification'))
  const profileFixture='.native-desktop-probe-job-contract'
  mkdirSync(join(root,'verification',profileFixture,'core'),{recursive:true})
  mkdirSync(join(root,'verification','.native-browser-session-job-contract'))
  const layoutFixture='.native-browser-migration-job-contract'
  for(const path of ['state/private/desktop','state/private/core','state/browser'])
    mkdirSync(join(root,'verification',layoutFixture,path),{recursive:true})
  const common={schema:1,mode:'desktop',fault:'none',argv:[],nonce:'a'.repeat(64)}
  return {root,isolated:{...common,desktopLayout:'isolated-v1',profileFixture},
    consolidated:{...common,desktopLayout:'consolidated-v1',layoutFixture}}
}
test.afterEach(()=>{for(const root of fixtures)rmSync(root,{recursive:true,force:true});fixtures.clear()})
test('isolated contract identifies only the exact prepared desktop/browser/Core destinations',()=>{
  const {root,isolated}=fixture(),paths=desktopJobPaths(root,isolated)
  assert.equal(paths.desktop,join(root,'verification',isolated.profileFixture))
  assert.equal(paths.browser,join(root,'verification','.native-browser-session-job-contract'))
  assert.equal(paths.core,join(paths.desktop,'core'))
  assert.equal(paths.layoutRoot,undefined);assert.equal(Object.isFrozen(paths),true)
  assert.equal(Object.isFrozen(paths.guardedDirectories),true)
})
test('consolidated contract uses the production fixed relative state structure without relocation',()=>{
  const {root,consolidated}=fixture(),paths=desktopJobPaths(root,consolidated)
  const layoutRoot=join(root,'verification',consolidated.layoutFixture)
  assert.equal(paths.layoutRoot,layoutRoot)
  assert.deepEqual(paths.guardedDirectories,[join(layoutRoot,'state/private/desktop'),
    join(layoutRoot,'state/browser'),join(layoutRoot,'state/private/core')])
  assert.equal(paths.privateRoot,join(layoutRoot,'state/private'))
})
test('unknown, mixed, traversal, malformed nonce and nonempty argv manifests refuse',()=>{
  const {root,isolated,consolidated}=fixture()
  for(const spec of [{...isolated,desktopLayout:'unknown'}, {...isolated,layoutFixture:consolidated.layoutFixture},
    {...consolidated,profileFixture:isolated.profileFixture},{...consolidated,layoutFixture:'../escape'},
    {...isolated,nonce:'bad'},{...isolated,argv:['unexpected']},{...isolated,argv:undefined},
    {...isolated,profileFixture:'.native-desktop-probe-owner-data'}])
    assert.throws(()=>desktopJobPaths(root,spec),/required|fallback/)
})
test('missing prepared Core is refused and never created or replaced by a fallback',()=>{
  const {root,isolated}=fixture(),profileFixture='.native-desktop-probe-job-missing'
  const desktop=join(root,'verification',profileFixture)
  mkdirSync(desktop);mkdirSync(join(root,'verification','.native-browser-session-job-missing'))
  assert.throws(()=>desktopJobPaths(root,{...isolated,profileFixture}),/ENOENT/)
  assert.equal(existsSync(join(desktop,'core')),false)
  assert.equal(existsSync(join(desktop,'.nori-state-owner.json')),false)
})
test('a linked generated layout is refused even when its target has the expected directories',()=>{
  const {root,consolidated}=fixture(),name='.native-browser-migration-job-alias'
  symlinkSync(join(root,'verification',consolidated.layoutFixture),join(root,'verification',name),
    process.platform==='win32'?'junction':'dir')
  assert.throws(()=>desktopJobPaths(root,{...consolidated,layoutFixture:name}),/Linked|Unlinked/)
})
test('the actual manifest reader enforces generated names and its bound before parsing',()=>{
  const {root,consolidated}=fixture(),name='.native-job-guardian-contract'
  const directory=join(root,'verification',name);mkdirSync(directory)
  writeFileSync(join(directory,'launch-spec.json'),JSON.stringify(consolidated),{flag:'wx'})
  assert.equal(readDesktopJobSpec(root,name).paths.desktopLayout,'consolidated-v1')
  assert.throws(()=>readDesktopJobSpec(root,'../contract'),/generated/)
  const large='.native-job-guardian-large';mkdirSync(join(root,'verification',large))
  writeFileSync(join(root,'verification',large,'launch-spec.json'),' '.repeat(65537),{flag:'wx'})
  assert.throws(()=>readDesktopJobSpec(root,large),/bounded/)
})
test('continuity requires paired exact consolidated loopback fields; foreign or mixed fields refuse',()=>{
  const {root,isolated,consolidated}=fixture()
  const browserFixtureUrl='http://127.0.0.1:54321/nori-storage-fixture?fixture='+'a'.repeat(64)
  const spec={...consolidated,browserCookieMode:'seed',browserFixtureUrl}
  assert.equal(desktopJobPaths(root,spec).desktopLayout,'consolidated-v1')
  for(const invalid of [{...consolidated,browserCookieMode:'seed'}, {...consolidated,browserFixtureUrl},
    {...spec,browserCookieMode:'SEED'}, {...spec,browserCookieMode:null}, {...spec,browserFixtureUrl:'https://example.com/'},
    {...spec,browserFixtureUrl:browserFixtureUrl.replace('54321','0')},
    {...isolated,browserCookieMode:'check',browserFixtureUrl}, {...spec,BrowserCookieMode:'check'}, {...spec,unknown:true}])
    assert.throws(()=>desktopJobPaths(root,invalid),/required|fixture|Unknown/)
})
