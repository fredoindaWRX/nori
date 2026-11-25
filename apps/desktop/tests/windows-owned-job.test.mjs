import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,existsSync,mkdtempSync,symlinkSync,rmSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {prepareOwnedJobFixture,runOwnedJobFixture} from '../scripts/owned-job-fixture.mjs'
const {acquireStateOwner}=createRequire(import.meta.url)('../desktop/state-owner.cjs')
const windows={skip:process.platform!=='win32',timeout:35000}
const fixtures=new Set(),fixtureParents=new Set()
function ownedFixture(){const root=prepareOwnedJobFixture();fixtures.add(root);return root}
test.afterEach(()=>{
  for(const path of fixtureParents)rmSync(path,{recursive:true,force:true,maxRetries:10,retryDelay:100})
  fixtureParents.clear()
  for(const path of fixtures)rmSync(path,{recursive:true,force:true,maxRetries:10,retryDelay:100})
  fixtures.clear()
})
const wait=ms=>new Promise(done=>setTimeout(done,ms))
const alive=pid=>{try{process.kill(pid,0);return true}catch{return false}}
async function until(check,message,timeout=5000){
  const end=Date.now()+timeout
  while(!check()){if(Date.now()>end)throw Error(message);await wait(10)}
}

test('creation-time Job retains ownership after root exit until its delayed descendant finishes',windows,async()=>{
  const fixture=ownedFixture()
  const result=await runOwnedJobFixture({fixture,onReady:async({state,owner})=>{
    assert.equal(owner.release,undefined)
    assert.equal(Object.isFrozen(owner),true)
    await until(()=>existsSync(join(fixture,'root-leaving.txt')),'Root did not launch its descendant')
    owner.assertHeld()
    assert.equal(existsSync(join(fixture,'child-finished.txt')),false)
    assert.throws(()=>acquireStateOwner(state,{purpose:'migration'}),/EEXIST/)
  }})
  assert.equal(result.result.rootExitedWithDescendants,true)
  // Windows may add contained console helpers. At least the root+delayed child
  // must be accounted; every Job member, including helpers, must be gone.
  assert.ok(result.result.totalProcesses>=2)
  assert.equal(result.result.activeProcesses,0)
  assert.equal(result.result.rootHandleExited,true)
  assert.equal(readFileSync(join(fixture,'child-finished.txt'),'utf8'),'synthetic descendant completed')
  assert.equal(result.ownerReleased,true);assert.equal(result.ownerRecordPreserved,false)
  assert.equal(result.result.forced,false);assert.equal(result.exit.code,0)
  assert.equal(result.sourcesUnchanged,true)
  assert.ok(result.sourceSha256['apps/desktop/desktop/state-owner.cjs'])
})

test('readiness callback cannot obtain lease release authority and a never-settling callback is bounded',windows,async()=>{
  const fixture=ownedFixture(),start=Date.now()
  await assert.rejects(runOwnedJobFixture({fixture,mode:'argv',callbackTimeoutMs:100,onReady:({owner})=>{
    assert.equal(owner.release,undefined)
    return new Promise(()=>{})
  }}),/callback deadline/)
  assert.ok(Date.now()-start<5000)
  const receipt=JSON.parse(readFileSync(join(fixture,'job-guardian-receipt.json'),'utf8'))
  assert.equal(receipt.ownerReleased,false);assert.equal(receipt.ownerRecordPreserved,true)
  assert.equal(receipt.protocolAccepted,false)
})

test('direct Windows argv round-trips empty, quotes, Unicode, whitespace and trailing backslashes',windows,async()=>{
  const fixture=ownedFixture()
  const argv=['','two words','"quoted"','C:\\trailing\\','café 🌌','\t','line\nbreak','a\\"b']
  const result=await runOwnedJobFixture({fixture,mode:'argv',argv})
  const encoded=readFileSync(join(fixture,'argv-base64.txt'),'utf8').split(/\r?\n/)
  if(encoded.at(-1)==='')encoded.pop()
  assert.deepEqual(encoded.map(value=>Buffer.from(value,'base64').toString('utf8')),argv)
  assert.equal(result.ownerReleased,true)
})

test('actual invalid creation-time Job association refuses without running child or releasing lease',windows,async()=>{
  const fixture=ownedFixture()
  const result=await runOwnedJobFixture({fixture,mode:'argv',fault:'assignment'})
  assert.equal(result.ready,undefined)
  assert.equal(result.result.kind,'owned-job-failed')
  assert.equal(result.result.launchResumed,false)
  assert.equal(existsSync(join(fixture,'argv-started.txt')),false)
  assert.equal(result.ownerReleased,false);assert.equal(result.ownerRecordPreserved,true)
  assert.equal(result.jobExitProven,false);assert.equal(result.exit.code,1)
})

test('failed Job accounting is not mistaken for zero and preserves ownership despite exact cleanup',windows,async()=>{
  const fixture=ownedFixture()
  const result=await runOwnedJobFixture({fixture,mode:'hang',fault:'query'})
  assert.equal(result.result.kind,'owned-job-failed')
  assert.equal(result.result.cleanupVerified,true)
  assert.equal(result.jobExitProven,false)
  assert.equal(result.ownerReleased,false);assert.equal(result.ownerRecordPreserved,true)
  await until(()=>!alive(result.ready.rootPid),'Failed query left owned root running')
})

test('forced exact Job drain preserves lease and leaves unrelated test process untouched',windows,async()=>{
  const unrelated=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,shell:false,stdio:'ignore'})
  const unrelatedExit=new Promise(done=>unrelated.once('exit',done))
  try{
    const fixture=ownedFixture()
    const result=await runOwnedJobFixture({fixture,mode:'hang',onReady:async({child})=>{
      await until(()=>existsSync(join(fixture,'hang-started.txt')),'Owned root never started')
      child.stdin.end()
    }})
    assert.equal(result.jobExitProven,true)
    assert.equal(result.result.forced,true)
    assert.equal(result.result.forceReason,'control-closed')
    assert.equal(result.ownerReleased,false);assert.equal(result.ownerRecordPreserved,true)
    assert.equal(alive(unrelated.pid),true)
    assert.equal(alive(result.ready.rootPid),false)
  }finally{unrelated.kill();await unrelatedExit}
})

test('real guardian deadline terminates the owned Job but does not authorize lease release',windows,async()=>{
  const fixture=ownedFixture()
  const result=await runOwnedJobFixture({fixture,mode:'hang',timeoutMs:150})
  assert.equal(result.result.forceReason,'deadline')
  assert.equal(result.result.forced,true);assert.equal(result.jobExitProven,true)
  assert.equal(result.ownerReleased,false);assert.equal(result.ownerRecordPreserved,true)
  assert.equal(alive(result.ready.rootPid),false)
})

test('changed compiled fixture is refused before launch or ownership creation',windows,async()=>{
  const fixture=ownedFixture()
  const executable=join(fixture,'job-fixture.exe'),bytes=readFileSync(executable)
  bytes[bytes.length-1]^=1
  writeFileSync(executable,bytes)
  await assert.rejects(runOwnedJobFixture({fixture,mode:'argv'}),/changed since compilation/)
  assert.equal(existsSync(join(fixture,'browser-state')),false)
  assert.equal(existsSync(join(fixture,'launch-spec.json')),false)
  assert.equal(existsSync(join(fixture,'argv-started.txt')),false)
})

test('guardian crash kills only its contained child and preserves lease for explicit recovery',windows,async()=>{
  const fixture=ownedFixture()
  const result=await runOwnedJobFixture({fixture,mode:'hang',onReady:async({child})=>{
    await until(()=>existsSync(join(fixture,'hang-started.txt')),'Owned root never started')
    child.kill()
  }})
  assert.equal(result.result,undefined)
  assert.equal(result.ownerReleased,false);assert.equal(result.ownerRecordPreserved,true)
  assert.equal(result.jobExitProven,false)
  await until(()=>!alive(result.ready.rootPid),'Guardian crash left contained root running')
})

test('foreign lease replacement survives graceful proof byte-for-byte',windows,async()=>{
  const fixture=ownedFixture(),foreign='foreign synthetic owner record; never delete'
  const result=await runOwnedJobFixture({fixture,mode:'delayed',onReady:({state})=>{
    writeFileSync(join(state,'.nori-state-owner.json'),foreign)
  }})
  assert.equal(result.jobExitProven,true)
  assert.equal(result.ownerReleased,false);assert.equal(result.ownerReleaseError,true)
  assert.equal(readFileSync(join(fixture,'browser-state/.nori-state-owner.json'),'utf8'),foreign)
})

test('fixture runner refuses outside roots, traversal, aliases and invalid argv before state creation',windows,async()=>{
  const fixture=ownedFixture()
  await assert.rejects(runOwnedJobFixture({fixture:resolve(fixture,'..')}),/Generated/)
  await assert.rejects(runOwnedJobFixture({fixture,argv:['nul\0argument']}),/contract/)
  assert.equal(existsSync(join(fixture,'browser-state')),false)
  const verification=fileURLToPath(new URL('../../../verification/',import.meta.url))
  const alias=mkdtempSync(join(verification,'.native-job-guardian-alias-parent-'))
  fixtureParents.add(alias)
  const junction=join(alias,'.native-job-guardian-alias')
  symlinkSync(fixture,junction,'junction')
  await assert.rejects(runOwnedJobFixture({fixture:junction}),/Generated|Linked/)
  assert.equal(existsSync(join(fixture,'browser-state')),false)
})
