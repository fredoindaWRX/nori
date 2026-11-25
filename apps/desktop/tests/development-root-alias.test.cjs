const test=require('node:test')
const assert=require('node:assert/strict')
const {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync}=require('node:fs')
const {join}=require('node:path')
const {tmpdir}=require('node:os')
const {desktopStateSelection}=require('../desktop/desktop-state-selection.cjs')

test('packaged development state selection refuses a Nori root reached through a directory alias',()=>{
  const parent=mkdtempSync(join(tmpdir(),'nori-root-alias-'))
  const root=join(parent,'storage','Nori'),alias=join(parent,'Nori')
  try{
    const executable=join(root,'apps/desktop/release/candidate/win-unpacked/Nori.exe')
    const suiteRoot=join(root,'apps/desktop/release/candidate/win-unpacked/resources/NoriSuite')
    mkdirSync(suiteRoot,{recursive:true})
    writeFileSync(join(root,'ROADMAP_TRACKING.json'),'{}')
    writeFileSync(executable,'synthetic')
    symlinkSync(root,alias,process.platform==='win32'?'junction':'dir')

    const selectorCalls=[]
    const direct=desktopStateSelection({suiteRoot,appRoot:join(root,'app.asar'),packaged:true,executable},
      (...args)=>{selectorCalls.push(args);return {selected:true}})
    assert.equal(direct.selected,true)
    assert.deepEqual(selectorCalls,[[root,'consolidated-v1',{scriptsRoot:join(root,'apps/desktop/release/candidate/win-unpacked/maintenance/scripts')} ]])
    selectorCalls.length=0

    const result=desktopStateSelection({
      suiteRoot:join(alias,'apps/desktop/release/candidate/win-unpacked/resources/NoriSuite'),
      appRoot:join(alias,'apps/desktop/release/candidate/win-unpacked/app.asar'),
      packaged:true,
      executable:join(alias,'apps/desktop/release/candidate/win-unpacked/Nori.exe'),
    },(...args)=>{selectorCalls.push(args);return {selected:true}})

    assert.equal(result,null)
    assert.deepEqual(selectorCalls,[])
  }finally{rmSync(parent,{recursive:true,force:true})}
})
