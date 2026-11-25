import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,copyFileSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {buildComponentManifest} from '../scripts/component-integrity.mjs'
import {verifyPortableNative} from '../scripts/verify-portable-native.mjs'

test('packaged executable verifies the actual candidate through relocated tools',
  {skip:!process.env.NORI_PORTABLE_TEST_EXECUTABLE,timeout:120000},()=>{
    const root=mkdtempSync(join(tmpdir(),'nori real backup verifier '))
    try {
      for(const name of ['verify-portable-native.mjs','component-integrity.mjs','desktop-artifacts.mjs','native-distribution-inventory.mjs'])
        copyFileSync(fileURLToPath(new URL('../scripts/'+name,import.meta.url)),join(root,name))
      const desktop=dirname(process.env.NORI_PORTABLE_TEST_EXECUTABLE)
      const receiptPath=join(dirname(desktop),'native-desktop-receipt.json')
      const result=spawnSync(process.env.NORI_PORTABLE_TEST_EXECUTABLE,
        [join(root,'verify-portable-native.mjs'),desktop,receiptPath],{cwd:root,encoding:'utf8',timeout:110000,windowsHide:true,
          env:{SystemRoot:process.env.SystemRoot,PATH:join(process.env.SystemRoot,'System32'),ELECTRON_RUN_AS_NODE:'1',ELECTRON_LOG_FILE:join(root,'electron-diagnostic.log'),NORI_VERIFY_PROGRESS:'1'}})
      assert.equal(result.status,0,result.stderr||result.error?.message)
      const evidence=JSON.parse(result.stdout)
      assert.equal(evidence.desktopIntegrityVerified,true)
      assert.equal(evidence.payloadIntegrityVerified,true)
      assert.equal(evidence.sourceTreeRequired,false)
      assert.equal(evidence.releaseVerified,false)
    }finally{rmSync(root,{recursive:true,force:true})}
})

test('relocated verifier runs under the packaged Nori executable without system Node',
  {skip:!process.env.NORI_PORTABLE_TEST_EXECUTABLE,timeout:10000},()=>{
    const root=mkdtempSync(join(tmpdir(),'nori portable tools ')),desktop=join(root,'win-unpacked')
    const tools=join(desktop,'backup-tools'),suite=join(desktop,'resources/NoriSuite')
    mkdirSync(tools,{recursive:true});mkdirSync(suite,{recursive:true})
    try {
      const names=['verify-portable-native.mjs','component-integrity.mjs','desktop-artifacts.mjs','native-distribution-inventory.mjs']
      for(const name of names)copyFileSync(fileURLToPath(new URL('../scripts/'+name,import.meta.url)),join(tools,name))
      writeFileSync(join(desktop,'Nori.exe'),'fixture executable only')
      writeFileSync(join(desktop,'resources/app.asar'),'fixture archive only')
      writeFileSync(join(suite,'fixture.py'),'synthetic payload')
      const desktopManifest=buildComponentManifest(desktop,['Nori.exe','resources/app.asar',...names.map(name=>'backup-tools/'+name)])
      const nativeManifest=buildComponentManifest(suite,['fixture.py'])
      const receipt={schema:1,packagedPayloadMatches:true,desktopManifest,nativeManifest,
        totalBytes:[...desktopManifest.files,...nativeManifest.files].reduce((sum,file)=>sum+file.bytes,0)}
      const receiptPath=join(root,'receipt.json');writeFileSync(receiptPath,JSON.stringify(receipt))
      const result=spawnSync(process.env.NORI_PORTABLE_TEST_EXECUTABLE,
        [join(tools,names[0]),desktop,receiptPath],{cwd:root,encoding:'utf8',timeout:5000,windowsHide:true,
          env:{SystemRoot:process.env.SystemRoot,PATH:join(process.env.SystemRoot,'System32'),ELECTRON_RUN_AS_NODE:'1',ELECTRON_LOG_FILE:join(root,'electron-diagnostic.log')}})
      assert.equal(result.status,0,result.stderr)
      assert.equal(JSON.parse(result.stdout).sourceTreeRequired,false)
    }finally{rmSync(root,{recursive:true,force:true})}
})

test('portable backup verifies without source or stage and rejects corruption and extras',()=>{
  const root=mkdtempSync(join(tmpdir(),'nori-portable-'))
  const put=(path,text)=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,text)}
  try {
    put('Nori.exe','fixture exe');put('resources/app.asar','fixture archive')
    put('resources/NoriSuite/runtime/service.py','fixture runtime')
    const desktopManifest=buildComponentManifest(root,['Nori.exe','resources/app.asar'])
    const nativeManifest=buildComponentManifest(join(root,'resources/NoriSuite'),['runtime/service.py'])
    const receipt={schema:1,packagedPayloadMatches:true,desktopManifest,nativeManifest,
      totalBytes:[...desktopManifest.files,...nativeManifest.files].reduce((sum,file)=>sum+file.bytes,0)}
    assert.equal(verifyPortableNative(root,receipt).sourceTreeRequired,false)
    assert.equal(verifyPortableNative(root,receipt).releaseVerified,false)
    const receiptPath=join(dirname(root),`${root.split(/[\\/]/).at(-1)}-receipt.json`)
    const cli=fileURLToPath(new URL('../scripts/verify-portable-native.mjs',import.meta.url))
    try {
      writeFileSync(receiptPath,JSON.stringify(receipt),{flag:'wx'})
      const accepted=spawnSync(process.execPath,[cli,root,receiptPath],{encoding:'utf8',timeout:5000})
      assert.equal(accepted.status,0,accepted.stderr)
      assert.equal(JSON.parse(accepted.stdout).sourceTreeRequired,false)
      const malformed=spawnSync(process.execPath,[cli],{encoding:'utf8',timeout:5000})
      assert.equal(malformed.status,1)
      assert.equal(JSON.parse(malformed.stderr).verified,false)
      put('resources/NoriSuite/runtime/service.py','changed runtime')
      const rejected=spawnSync(process.execPath,[cli,root,receiptPath],{encoding:'utf8',timeout:5000})
      assert.equal(rejected.status,1)
      assert.match(JSON.parse(rejected.stderr).error,/integrity mismatch/)
      put('resources/NoriSuite/runtime/service.py','fixture runtime')
    }finally{rmSync(receiptPath,{force:true})}
    assert.throws(()=>verifyPortableNative(root,{...receipt,nativeManifest:undefined}),/incomplete/)
    const events=[]
    verifyPortableNative(root,receipt,{profileHashes:true,progress:(phase,details)=>events.push({phase,details})})
    const summary=events.find(event=>event.phase==='native-hash-groups').details.groups
    assert.equal(summary.reduce((sum,group)=>sum+group.files,0),nativeManifest.files.length)
    assert.equal(summary[0].group,'runtime/<files>','Top-level files must not consume one group per filename')
    assert.equal(summary.reduce((sum,group)=>sum+group.bytes,0),nativeManifest.files.reduce((sum,file)=>sum+file.bytes,0))
    assert.ok(summary.every(group=>Number.isFinite(group.elapsedMs)&&group.elapsedMs>=0))
    const ordinary=[]
    verifyPortableNative(root,receipt,{progress:phase=>ordinary.push(phase)})
    assert.ok(!ordinary.includes('native-hash-groups'),'Profiling is explicitly opt-in')
    assert.throws(()=>verifyPortableNative(root,receipt,{profileHashes:'yes'}),/diagnostic options/)
    assert.throws(()=>verifyPortableNative(root,{...receipt,totalBytes:1}),/size receipt/)
    put('resources/NoriSuite/runtime/service.py','changed runtime')
    assert.throws(()=>verifyPortableNative(root,receipt),/integrity mismatch/)
    put('resources/NoriSuite/runtime/service.py','fixture runtime')
    put('unexpected.dll','fixture')
    assert.throws(()=>verifyPortableNative(root,receipt),/required components/)
  }finally{rmSync(root,{recursive:true,force:true})}
})
