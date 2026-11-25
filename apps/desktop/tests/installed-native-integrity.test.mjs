import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,copyFileSync,rmSync,symlinkSync} from 'node:fs'
import {join,resolve,dirname} from 'node:path'
import {spawnSync} from 'node:child_process'
import {buildComponentManifest} from '../scripts/component-integrity.mjs'
import {desktopArtifactPaths} from '../scripts/desktop-artifacts.mjs'
import {nativeDistributionPaths} from '../scripts/native-distribution-inventory.mjs'
import {verifyInstalledNative} from '../scripts/verify-installed-native.mjs'
import {verifyPortableNative} from '../scripts/verify-portable-native.mjs'
import {publishFreshInstalledLayout} from '../scripts/publish-installed-layout.mjs'

const windows={skip:process.platform!=='win32',timeout:60000}
function fixture(run){
  const root=mkdtempSync(join(resolve(import.meta.dirname,'../../../verification'),'.installed-integrity-'))
  const suite=join(root,'resources/NoriSuite'),scripts=join(root,'maintenance/scripts')
  const put=(path,text)=>{const target=join(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,text)}
  const powershell=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
  try{
    mkdirSync(suite,{recursive:true});mkdirSync(scripts,{recursive:true})
    put('Nori.exe','synthetic file; never execute');put('resources/app.asar','synthetic archive')
    put('resources/NoriSuite/runtime/service.py','synthetic runtime')
    for(const name of ['verify-private-state-acl.ps1','verify-browser-state-acl.ps1','browser-capability-sid.ps1',
      'verify-installed-native.mjs','component-integrity.mjs','desktop-artifacts.mjs','native-distribution-inventory.mjs'])
      copyFileSync(join(import.meta.dirname,'../scripts',name),join(scripts,name))
    const desktopHelpers=join(root,'maintenance/desktop');mkdirSync(desktopHelpers)
    for(const name of ['installed-state-policy.cjs','consolidated-state-selection.cjs','native-state-layout.cjs'])
      copyFileSync(join(import.meta.dirname,'../desktop',name),join(desktopHelpers,name))
    const desktopManifest=buildComponentManifest(root,desktopArtifactPaths(root))
    const nativeManifest=buildComponentManifest(suite,nativeDistributionPaths(suite))
    const receipt={schema:1,packagedPayloadMatches:true,desktopManifest,nativeManifest,
      totalBytes:[...desktopManifest.files,...nativeManifest.files].reduce((sum,file)=>sum+file.bytes,0)}
    for(const storageClass of ['private','browser']){
      const result=spawnSync(powershell,['-NoProfile','-File',join(import.meta.dirname,'../scripts/provision-private-state.ps1'),
        '-Root',suite,'-StorageClass',storageClass,'-Apply'],{shell:false,windowsHide:true,encoding:'utf8',timeout:10000})
      assert.equal(result.status,0,result.stderr)
    }
    mkdirSync(join(suite,'state/private/core'));mkdirSync(join(suite,'state/private/desktop'))
    run({root,suite,receipt,put,powershell,marker:join(root,'nori-install-layout.json'),
      publish:()=>publishFreshInstalledLayout(root,{freshInstall:true},{legacyProfiles:()=>[join(root,'absent-legacy')]})})
  }finally{rmSync(root,{recursive:true,force:true})}
}

test('installed checker requires policy; portable checking remains strict after publication',windows,()=>fixture(({root,receipt,publish})=>{
  assert.throws(()=>verifyInstalledNative(root,receipt),/policy missing/)
  assert.equal(verifyPortableNative(root,receipt).desktopIntegrityVerified,true)
  publish()
  const evidence=verifyInstalledNative(root,receipt)
  assert.equal(evidence.installedPolicyBytesVerified,true);assert.equal(evidence.preparedStateAclVerified,true)
  assert.equal(evidence.privateStateContentsRead,false);assert.equal(evidence.installedSuiteVerified,false)
  assert.equal(evidence.releaseVerified,false);assert.equal(evidence.publisherAuthenticated,false)
  assert.throws(()=>verifyPortableNative(root,receipt),/required components/)
}))

test('installed checker rejects unexpected code and native corruption without reading memory',windows,()=>fixture(({root,receipt,publish,put})=>{
  publish();put('resources/NoriSuite/state/private/core/memory.json','synthetic memory stays private')
  assert.equal(verifyInstalledNative(root,receipt).privateStateContentsRead,false)
  assert.equal(readFileSync(join(root,'resources/NoriSuite/state/private/core/memory.json'),'utf8'),'synthetic memory stays private')
  put('unexpected.dll','unexpected executable component')
  assert.throws(()=>verifyInstalledNative(root,receipt),/required components/)
  rmSync(join(root,'unexpected.dll'))
  put('resources/NoriSuite/runtime/service.py','altered runtime')
  assert.throws(()=>verifyInstalledNative(root,receipt),/integrity mismatch/)
}))

test('installed marker is fixed bytes, not an arbitrary excluded metadata file',windows,()=>fixture(({root,receipt,publish,marker})=>{
  publish();const original=readFileSync(marker)
  writeFileSync(marker,JSON.stringify(JSON.parse(original.toString()),null,2))
  assert.throws(()=>verifyInstalledNative(root,receipt),/publication contract/)
  writeFileSync(marker,'{"schema":"unsupported"}')
  assert.throws(()=>verifyInstalledNative(root,receipt),/Invalid installed/)
  writeFileSync(marker,original)
  const external=join(root,'external-parent'),linked=join(root,'linked-parent')
  mkdirSync(external);writeFileSync(join(external,'nori-install-layout.json'),original)
  // Directory junctions work without granting this test symlink privilege.
  // The linked parent must be refused before any payload/ACL check is run.
  symlinkSync(external,linked,'junction')
  assert.throws(()=>verifyInstalledNative(linked,receipt),/Unsafe installed/)
}))

test('installed checker refuses broadened private state ACL and preserves data',windows,()=>fixture(({root,receipt,publish})=>{
  publish()
  const memory=join(root,'resources/NoriSuite/state/private/core/memory.json');writeFileSync(memory,'keep synthetic memory')
  const changed=spawnSync(join(process.env.SystemRoot,'System32/icacls.exe'),[memory,'/grant','*S-1-1-0:(RX)'],
    {shell:false,windowsHide:true,encoding:'utf8',timeout:10000})
  assert.equal(changed.status,0,changed.stderr)
  assert.throws(()=>verifyInstalledNative(root,receipt),/permissions refused/)
  assert.equal(readFileSync(memory,'utf8'),'keep synthetic memory')
}))

test('relocated installed verifier runs with actual packaged Nori executable and Windows-only PATH',
  {skip:process.platform!=='win32'||!process.env.NORI_PORTABLE_TEST_EXECUTABLE,timeout:60000},
  ()=>fixture(({root,suite,receipt,publish})=>{
    publish()
    const diagnostics=join(suite,'verification');mkdirSync(diagnostics)
    const receiptPath=join(diagnostics,'synthetic-receipt.json');writeFileSync(receiptPath,JSON.stringify(receipt),{flag:'wx'})
    const result=spawnSync(process.env.NORI_PORTABLE_TEST_EXECUTABLE,
      [join(root,'maintenance/scripts/verify-installed-native.mjs'),root,receiptPath],
      {shell:false,windowsHide:true,encoding:'utf8',timeout:20000,cwd:root,
        env:{SystemRoot:process.env.SystemRoot,PATH:join(process.env.SystemRoot,'System32'),
          ELECTRON_RUN_AS_NODE:'1',ELECTRON_LOG_FILE:join(diagnostics,'electron.log')}})
    assert.equal(result.status,0,result.stderr||result.error?.message)
    const evidence=JSON.parse(result.stdout)
    assert.equal(evidence.installedPolicyBytesVerified,true);assert.equal(evidence.preparedStateAclVerified,true)
    assert.equal(evidence.sourceTreeRequired,false);assert.equal(evidence.privateStateContentsRead,false)
    assert.equal(evidence.installedSuiteVerified,false);assert.equal(evidence.releaseVerified,false)
  }))
