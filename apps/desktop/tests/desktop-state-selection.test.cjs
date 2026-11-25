const test=require('node:test')
const assert=require('node:assert/strict')
const {join}=require('node:path')
const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=require('node:fs')
const {tmpdir}=require('node:os')
const {desktopStateSelection}=require('../desktop/desktop-state-selection.cjs')
const source={suiteRoot:'source-suite',appRoot:'source-app',packaged:false,executable:'unused'}
test('default desktop selection does not inspect, create or silently activate a layout',()=>{
  const select=()=>{throw Error('selector must not run')}
  assert.equal(desktopStateSelection({},select),null)
  assert.equal(desktopStateSelection({...source,stateLayout:''},select),null)
})
test('both packaged production and probe paths select the physical shipped ACL closure',()=>{
  const context={suiteRoot:'package/resources/NoriSuite',appRoot:'package/resources/app.asar',
    packaged:true,executable:join('package','Nori.exe'),stateLayout:'consolidated-v1'}
  const calls=[],select=(...args)=>{calls.push(args);return Object.freeze({selected:true})}
  assert.equal(desktopStateSelection(context,select).selected,true)
  assert.equal(desktopStateSelection({...context,probeLayoutRoot:'generated-layout'},select).selected,true)
  assert.deepEqual(calls,[[context.suiteRoot,'consolidated-v1',{scriptsRoot:join('package','maintenance/scripts')}],
    ['generated-layout','consolidated-v1',{scriptsRoot:join('package','maintenance/scripts')}]])
  assert.ok(calls.every(call=>!call[2].scriptsRoot.includes('app.asar')))
})
test('source generated layouts keep source ACL closure, and unknown modes still refuse',()=>{
  const calls=[],select=(...args)=>{calls.push(args);return {selected:true}}
  desktopStateSelection({...source,probeLayoutRoot:'generated-layout'},select)
  assert.deepEqual(calls,[['generated-layout','consolidated-v1',{scriptsRoot:join('source-app','scripts')}]])
  assert.throws(()=>desktopStateSelection({...source,stateLayout:'unknown'}),/Unknown.*no fallback/)
  assert.throws(()=>desktopStateSelection({stateLayout:'consolidated-v1'}),/context required/)
})
test('packaged development release selects the verified Nori project root state',()=>{
  const parent=mkdtempSync(join(tmpdir(),'nori-root-select-')),root=join(parent,'Nori')
  try{
    const exe=join(root,'apps/desktop/release/candidate/win-unpacked/Nori.exe')
    const suite=join(root,'apps/desktop/release/candidate/win-unpacked/resources/NoriSuite')
    mkdirSync(suite,{recursive:true});writeFileSync(join(root,'ROADMAP_TRACKING.json'),'{}');writeFileSync(exe,'synthetic')
    const calls=[],select=(...args)=>{calls.push(args);return {selected:true}}
    const result=desktopStateSelection({suiteRoot:suite,appRoot:join(root,'app.asar'),packaged:true,executable:exe},select)
    assert.equal(result.selected,true)
    assert.deepEqual(calls,[[root,'consolidated-v1',{scriptsRoot:join(root,'apps/desktop/release/candidate/win-unpacked/maintenance/scripts')} ]])
  }finally{rmSync(parent,{recursive:true,force:true})}
})
test('development root selection refuses lookalike folders and non-release executables',()=>{
  const parent=mkdtempSync(join(tmpdir(),'nori-root-refuse-')),root=join(parent,'Nori')
  try{
    mkdirSync(root)
    writeFileSync(join(root,'ROADMAP_TRACKING.json'),'{}')
    const calls=[],select=(...args)=>{calls.push(args);return {selected:true}}
    const appRoot=join(root,'apps/desktop/release/candidate/win-unpacked')
    assert.equal(desktopStateSelection({suiteRoot:'suite',appRoot:'app',packaged:true,executable:join(appRoot,'Nori.exe')},select),null)
    assert.equal(desktopStateSelection({suiteRoot:'suite',appRoot:'app',packaged:true,executable:join(root,'other/Nori.exe')},select),null)
    assert.deepEqual(calls,[])
  }finally{rmSync(parent,{recursive:true,force:true})}
})
