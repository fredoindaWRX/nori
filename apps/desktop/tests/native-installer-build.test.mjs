import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {buildNativeInstaller} from '../scripts/build-native-installer.mjs'
import {seedSingleAppPolicy,seedSingleAppArchive} from './fixtures/single-app-policy.mjs'

test('normal Windows suite command selects native installer runner and forwards arguments',()=>{
  const metadata=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))
  assert.equal(metadata.scripts['package:windows'],'npm run package:windows:suite --')
  assert.equal(metadata.scripts['package:windows:suite'],'node scripts/build-native-installer.mjs')
})

test('installer runner calls only compiler, verifies afterward, hashes outputs, and never starts Setup',async()=>{
  const root=mkdtempSync(join(tmpdir(),'nori installer builder ')),output=join(root,'output'),recipe=join(root,'native.iss')
  writeFileSync(recipe,'synthetic recipe')
  let verified=0,calls=0
  const desktop=join(root,'desktop')
  const dependencies={plan:()=>({output,desktop,compiler:'explicit compiler.exe',argv:[`/DNativeDesktopRoot=${desktop}`,recipe]}),
    mapSourceRoot:source=>({root:'fixture:',dispose(){}}),
    verify:()=>verified++,run:(file,args,settings)=>{
      calls++;assert.equal(file,'explicit compiler.exe');assert.equal(args[0],'/DNativeDesktopRoot=fixture:');assert.equal(args.at(-1),recipe)
      assert.equal(settings.shell,false);assert.equal(settings.windowsHide,true)
      assert.equal(settings.maxBuffer,128*1024*1024)
      writeFileSync(join(output,'Nori-Native-Suite-Setup-x64.exe'),'synthetic installer')
      writeFileSync(join(output,'Nori-Native-Suite-Setup-x64-1a.bin'),'synthetic slice')
      return {status:0}
    }}
  try {
    seedSingleAppPolicy(root)
    await seedSingleAppArchive(root,join(root,'desktop'))
    const receipt=buildNativeInstaller(root,{candidate:'fixture'},dependencies)
    assert.equal(calls,1);assert.equal(verified,1)
    assert.equal(receipt.setupLaunched,false);assert.equal(receipt.installedSuiteVerified,false)
    assert.equal(receipt.manifest.files.length,2)
    assert.equal(receipt.packagedAppIdentityVerified,true)
    assert.equal(receipt.singleAppPolicy.releaseVerified,false)
    assert.equal(JSON.parse(readFileSync(join(output,'native-installer-receipt.json'))).compiled,true)
    assert.throws(()=>buildNativeInstaller(root,{candidate:'fixture'},dependencies),/EEXIST/)
    assert.equal(calls,1)
  } finally {rmSync(root,{recursive:true,force:true})}
})

test('compiler failure preserves partial outputs without a success receipt',async()=>{
  const root=mkdtempSync(join(tmpdir(),'nori installer failure ')),output=join(root,'output'),recipe=join(root,'native.iss')
  writeFileSync(recipe,'synthetic recipe')
  try {
    seedSingleAppPolicy(root)
    await seedSingleAppArchive(root,join(root,'desktop'))
    assert.throws(()=>buildNativeInstaller(root,{candidate:'fixture'},{
      plan:()=>({output,desktop:join(root,'desktop'),compiler:'compiler',argv:[recipe]}),
      mapSourceRoot:source=>({root:source,dispose(){}}),verify:()=>assert.fail('No postcheck after failure'),
      run:()=>{writeFileSync(join(output,'partial.bin'),'preserve me');return {status:1,stdout:'compiler diagnostic'}},
    }),/compiler failed[\s\S]*compiler diagnostic/)
    assert.equal(readFileSync(join(output,'partial.bin'),'utf8'),'preserve me')
    assert.equal(existsSync(join(output,'native-installer-receipt.json')),false)
  } finally {rmSync(root,{recursive:true,force:true})}
})
