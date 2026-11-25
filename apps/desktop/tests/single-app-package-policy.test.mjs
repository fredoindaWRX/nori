import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync,symlinkSync,renameSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {inspectSingleAppPolicy,recheckSingleAppPolicy,verifyPackagedAppIdentity} from '../scripts/single-app-package-policy.mjs'
import {packageNativeDesktop} from '../scripts/package-native-desktop.mjs'
import {buildNativeInstaller} from '../scripts/build-native-installer.mjs'
import {seedSingleAppPolicy,seedSingleAppArchive} from './fixtures/single-app-policy.mjs'

function fixture(t) {
  const root=mkdtempSync(join(tmpdir(),'nori-single-app-policy-'))
  t.after(()=>rmSync(root,{recursive:true,force:true}))
  seedSingleAppPolicy(root)
  return root
}
test('current source keeps one identity without claiming release qualification',()=>{
  const root=fileURLToPath(new URL('../../../',import.meta.url))
  const policy=inspectSingleAppPolicy(root)
  assert.equal(policy.files.length,5)
  assert.equal(policy.releaseVerified,false)
})
for(const [label,mutate] of [
  ['foreign identity',p=>{p.productName='Other app'}],
  ['foreign entry',p=>{p.main='other.cjs'}],
  ['non-suite route',p=>{p.scripts['package:windows']='electron-builder'}],
])test(label+' blocks desktop and installer before build dispatch',async t=>{
  const root=fixture(t),metadata=join(root,'apps/desktop/package.json')
  const value=JSON.parse(readFileSync(metadata));mutate(value);writeFileSync(metadata,JSON.stringify(value))
  let called=false
  await assert.rejects(packageNativeDesktop(root,async()=>{called=true}),/Single-app packaging policy/)
  assert.throws(()=>buildNativeInstaller(root,{candidate:'fixture'},{plan:()=>{called=true}}),/Single-app packaging policy/)
  assert.equal(called,false)
  assert.equal(existsSync(join(root,'apps/desktop/release')),false)
})
test('changed installer AppId and duplicate setup directives are refused',t=>{
  const root=fixture(t),recipe=join(root,'apps/desktop/native-suite-installer.iss')
  const original=readFileSync(recipe,'utf8')
  writeFileSync(recipe,original.replace('6CB18C76-1A3F-4A15-AF16-FF098C2B91B4','another-product'))
  assert.throws(()=>inspectSingleAppPolicy(root),/appid differs/)
  writeFileSync(recipe,original.replace('[Setup]','[Setup]\nAppName=N.O.R.I.'))
  assert.throws(()=>inspectSingleAppPolicy(root),/duplicate installer directive/)
})
test('same-validity source edits still invalidate the original build snapshot',t=>{
  const root=fixture(t),before=inspectSingleAppPolicy(root)
  const main=join(root,'apps/desktop/desktop/main.cjs')
  writeFileSync(main,readFileSync(main,'utf8')+'\n// changed during build\n')
  assert.throws(()=>recheckSingleAppPolicy(root,before),/inputs changed during build/)
})
test('a linked parent cannot redirect an identity input',t=>{
  const root=fixture(t),original=join(root,'verification'),moved=join(root,'moved-verification')
  renameSync(original,moved);symlinkSync(moved,original,'junction')
  assert.throws(()=>inspectSingleAppPolicy(root),/linked identity path/)
})
test('real archive identity and entry bytes must agree with source',async t=>{
  const root=fixture(t),desktop=join(root,'desktop'),policy=inspectSingleAppPolicy(root)
  await seedSingleAppArchive(root,desktop)
  assert.equal(verifyPackagedAppIdentity(desktop,policy).identityVerified,true)
  const changed={...policy,files:policy.files.map(file=>({...file,sha256:'0'.repeat(64)}))}
  assert.throws(()=>verifyPackagedAppIdentity(desktop,changed),/entry differs/)
})
test('compiler-time identity edits preserve output without publishing a success receipt',async t=>{
  const root=fixture(t),desktop=join(root,'desktop'),output=join(root,'output')
  const recipe=join(root,'apps/desktop/native-suite-installer.iss')
  await seedSingleAppArchive(root,desktop)
  assert.throws(()=>buildNativeInstaller(root,{candidate:'fixture'},{
    plan:()=>({desktop,output,compiler:'fixture-only',argv:[`/DNativeDesktopRoot=${desktop}`,recipe]}),
    mapSourceRoot:source=>({root:source,dispose(){}}),
    verify:()=>assert.fail('Must refuse the altered source before downstream verification'),
    run:()=>{
      writeFileSync(join(output,'preserved.bin'),'fixture output')
      const metadata=join(root,'apps/desktop/package.json')
      writeFileSync(metadata,readFileSync(metadata,'utf8')+'\n')
      return {status:0}
    },
  }),/inputs changed during build/)
  assert.equal(readFileSync(join(output,'preserved.bin'),'utf8'),'fixture output')
  assert.equal(existsSync(join(output,'native-installer-receipt.json')),false)
})
