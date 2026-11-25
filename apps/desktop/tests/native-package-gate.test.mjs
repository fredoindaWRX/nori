import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,rmSync,existsSync,symlinkSync,readFileSync,readdirSync,writeFileSync,statSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {packageNativeDesktop,nativeBuilderConfig,copyNativeMaintenanceScripts,nativeMaintenanceScripts,
  restorePackagedModelLinks} from '../scripts/package-native-desktop.mjs'
import {getConfig} from 'app-builder-lib/out/util/config/config.js'
import {fileURLToPath} from 'node:url'

test('actual maintenance copy ships exact recovery bytes and preserves existing output',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-maintenance-package-'))
  const appRoot=fileURLToPath(new URL('..',import.meta.url))
  try{
    const result=copyNativeMaintenanceScripts(appRoot,root)
    assert.equal(result.copyIntegrityVerified,true)
    assert.equal(result.files,nativeMaintenanceScripts.length)
    assert.ok(nativeMaintenanceScripts.includes('recover-state-owner.ps1'))
    assert.deepEqual(readFileSync(join(root,'maintenance/scripts/recover-state-owner.ps1')),
      readFileSync(join(appRoot,'scripts/recover-state-owner.ps1')))
    assert.equal(result.stateModified,false)
    assert.throws(()=>copyNativeMaintenanceScripts(appRoot,root),/Existing maintenance output preserved/)
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('linked release directory cannot redirect native build output',async()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-package-linked-'))
  const outside=mkdtempSync(join(tmpdir(),'nori-package-outside-'))
  mkdirSync(join(root,'apps/desktop'),{recursive:true})
  try{
    symlinkSync(outside,join(root,'apps/desktop/release'),'junction')
    await assert.rejects(packageNativeDesktop(root,async()=>{throw Error('must not dispatch')}),/Linked native build output/)
    assert.equal(existsSync(join(outside,'native-desktop-current')),false)
  }finally{rmSync(root,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true})}
})

test('external package output cannot mutate its staged payload',async()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-package-external-root-'))
  const stageParent=mkdtempSync(join(tmpdir(),'nori-package-external-stage-'))
  const stage=join(stageParent,'NoriSuite')
  mkdirSync(stage)
  let dispatched=false
  try{
    await assert.rejects(packageNativeDesktop(root,async()=>{dispatched=true},{
      candidate:'external-test',stageCandidate:'external-stage',stagePath:stage,
      outputPath:join(stage,'desktop-output')}),/cannot be nested inside the staged payload/)
    assert.equal(dispatched,false)
    assert.deepEqual(readdirSync(stage),[])
  }finally{rmSync(root,{recursive:true,force:true});rmSync(stageParent,{recursive:true,force:true})}
})

test('packaged model restoration verifies a copy when stage and output are on different volumes',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-package-cross-volume-'))
  const stage=join(root,'stage'),desktop=join(root,'desktop')
  const modelPath='models/language/test.gguf',model=Buffer.from('synthetic model bytes')
  const sha256=createHash('sha256').update(model).digest('hex')
  mkdirSync(join(stage,'runtime/norllama'),{recursive:true})
  mkdirSync(join(stage,'models/language'),{recursive:true})
  mkdirSync(desktop)
  writeFileSync(join(stage,'runtime/norllama/config.json'),JSON.stringify({model_path:modelPath}))
  writeFileSync(join(stage,...modelPath.split('/')),model)
  try{
    const result=restorePackagedModelLinks(stage,desktop,{manifest:{files:[{path:modelPath,bytes:model.length,sha256}] }},{
      createHardlink(){throw Object.assign(new Error('different volume'),{code:'EXDEV'})}
    })
    assert.deepEqual(result,[{path:modelPath,bytes:model.length,status:'copied',sha256}])
    assert.equal(statSync(join(desktop,'resources/NoriSuite',...modelPath.split('/'))).size,model.length)
    assert.deepEqual(readFileSync(join(desktop,'resources/NoriSuite',...modelPath.split('/'))),model)
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('GPT-OSS packaged model is copied independently rather than hard-linked',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-package-gptoss-copy-'))
  const stage=join(root,'stage'),desktop=join(root,'desktop')
  const modelPath='models/language/gpt-oss-20b-ggmlorg-mxfp4-a7443ebb/gpt-oss-20b-mxfp4.gguf'
  const model=Buffer.from('synthetic GPT-OSS model bytes')
  const sha256=createHash('sha256').update(model).digest('hex')
  mkdirSync(join(stage,'runtime/norllama'),{recursive:true})
  mkdirSync(join(stage,...modelPath.split('/').slice(0,-1)),{recursive:true})
  mkdirSync(desktop)
  writeFileSync(join(stage,'runtime/norllama/config.json'),JSON.stringify({model_path:modelPath}))
  writeFileSync(join(stage,...modelPath.split('/')),model)
  try{
    const result=restorePackagedModelLinks(stage,desktop,{manifest:{files:[{path:modelPath,bytes:model.length,sha256}]}})
    const packaged=join(desktop,'resources/NoriSuite',...modelPath.split('/'))
    assert.deepEqual(result,[{path:modelPath,bytes:model.length,status:'copied',sha256}])
    assert.deepEqual(readFileSync(packaged),model)
    assert.notEqual(statSync(join(stage,...modelPath.split('/'))).ino,statSync(packaged).ino)
  }finally{rmSync(root,{recursive:true,force:true})}
})

test('resolved builder config has exactly one candidate resource source',async()=>{
  const appRoot=fileURLToPath(new URL('..',import.meta.url))
  const stage=join(appRoot,'release/native-suite-regression/NoriSuite')
  const output=join(appRoot,'release/native-desktop-regression')
  const config=await getConfig(appRoot,undefined,nativeBuilderConfig(appRoot,stage,output))
  assert.equal(config.extraResources.length,1)
  assert.equal(config.extraResources[0].from,stage)
  assert.equal(config.extraResources[0].to,'NoriSuite')
  assert.equal(config.directories.output,output)
  assert.equal(config.electronVersion,'44.4.5')
  assert.ok(config.extraResources[0].filter.includes('!state{,/**/*}'))
  assert.ok(config.extraResources[0].filter.includes('!models/language{,/**/*}'),
    'large model bytes are linked after packaging instead of duplicated by electron-builder')
})

test('candidate names cannot escape release directories or dispatch a build',async()=>{
  for(const candidate of ['../escape','C:\\elsewhere','UPPER','',null]) {
    await assert.rejects(packageNativeDesktop('unused',async()=>{throw Error('must not dispatch')},
      {candidate}),/Unsafe native candidate name/)
  }
})

test('named packager preserves its existing candidate',async()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-named-package-gate-'))
  const output=join(root,'apps/desktop/release/native-desktop-test-phone')
  mkdirSync(output,{recursive:true})
  try {
    await assert.rejects(packageNativeDesktop(root,async()=>{throw Error('must not dispatch')},
      {candidate:'test-phone'}),/previous candidate preserved/)
    assert.equal(existsSync(output),true)
  } finally {rmSync(root,{recursive:true,force:true})}
})
test('missing native staging cannot dispatch the packager or create output',async()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-package-gate-'))
  let dispatched=false
  try {
    await assert.rejects(packageNativeDesktop(root,async()=>{dispatched=true}))
    assert.equal(dispatched,false)
    assert.equal(existsSync(join(root,'apps/desktop/release/native-desktop-current')),false)
  } finally {rmSync(root,{recursive:true,force:true})}
})
test('native packager preserves an existing candidate before checking source',async()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-package-gate-'))
  const output=join(root,'apps/desktop/release/native-desktop-current')
  mkdirSync(output,{recursive:true})
  try {
    await assert.rejects(packageNativeDesktop(root,async()=>{throw Error('must not dispatch')}),/previous candidate preserved/)
    assert.equal(existsSync(output),true)
  } finally {rmSync(root,{recursive:true,force:true})}
})

test('candidate token normalizes native-desktop- prefix preventing double-prefix outputs',async()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-package-gate-prefix-'))
  const output=join(root,'apps/desktop/release/native-desktop-live-123')
  const doublePrefixOutput=join(root,'apps/desktop/release/native-desktop-native-desktop-live-123')
  mkdirSync(output,{recursive:true})
  try {
    await assert.rejects(packageNativeDesktop(root,async()=>{throw Error('must not dispatch')},
      {candidate:'native-desktop-live-123'}),/previous candidate preserved/)
    assert.equal(existsSync(output),true)
    assert.equal(existsSync(doublePrefixOutput),false)
  } finally {rmSync(root,{recursive:true,force:true})}
})
