import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request } from 'node:http'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createMonitor } from './server.mjs'
import { evidence, snapshot, gitStatus } from './status.mjs'

test('phone page and status work at root and private /project mount', async () => {
  const server = createMonitor(async()=>({readOnly:true, marker:'test'}))
  server.listen(0, '127.0.0.1'); await once(server,'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    for(const prefix of ['', '/project']) {
      const page=await fetch(base+prefix+'/'); assert.equal(page.status,200)
      assert.match(await page.text(),/Nori · Project Watch/)
      const data=await fetch(base+prefix+'/api/status'); assert.deepEqual(await data.json(),{readOnly:true,marker:'test'})
      assert.equal(data.headers.get('cache-control'),'no-store')
      assert.equal(data.headers.get('access-control-allow-origin'),null)
    }
  } finally { await new Promise(r=>server.close(r)) }
})

test('Git status refuses a parent checkout but accepts its exact repository root',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'nori-monitor-git-'))
  try {
    execFileSync('git',['init',root],{windowsHide:true,stdio:'ignore'})
    await writeFile(path.join(root,'source.txt'),'fixture')
    execFileSync('git',['-C',root,'add','source.txt'],{windowsHide:true})
    execFileSync('git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=','commit','-m','fixture'],{windowsHide:true,stdio:'ignore'})
    const nested=path.join(root,'packaged');await mkdir(nested)
    assert.deepEqual(await gitStatus(nested),{available:false})
    const exact=await gitStatus(root)
    assert.equal(exact.available,true);assert.equal(exact.cleanTracked,true)
    assert.match(exact.head,/^[a-f0-9]{40,64}$/)
  }finally{await rm(root,{recursive:true,force:true})}
})

test('writes, foreign hosts, cross-origin reads and arbitrary files are denied', async () => {
  let calls=0
  const server=createMonitor(async()=>{calls++;return{readOnly:true}})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  const base=`http://127.0.0.1:${server.address().port}`
  try {
    assert.equal((await fetch(base+'/api/status',{method:'POST'})).status,405)
    // Undici's fetch replaces Host; use HTTP directly to exercise DNS-rebinding protection.
    const foreignHostStatus = await new Promise((resolve,reject) => {
      const req=request(base+'/api/status',{headers:{host:'evil.test'}},res=>{
        res.resume(); res.on('end',()=>resolve(res.statusCode))
      })
      req.on('error',reject); req.end()
    })
    assert.equal(foreignHostStatus,403)
    assert.equal((await fetch(base+'/api/status',{headers:{origin:'https://evil.test'}})).status,403)
    assert.equal((await fetch(base+'/C:/Nori/config.yaml')).status,404)
    assert.equal((await fetch(base+'/api/run-worker')).status,404)
    assert.equal(calls,0)
  } finally { await new Promise(r=>server.close(r)) }
})

test('evidence reader is bounded, allowlisted, and rejects traversal', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'nori-monitor-'))
  try {
    await assert.rejects(evidence(root,'../config.json'),/not allowed/)
    await writeFile(path.join(root,'large.md'),'x'.repeat(512*1024+1))
    assert.equal((await evidence(root,'large.md')).unavailable,true)
    assert.deepEqual(await evidence(root,'missing.md'),{exists:false})
  } finally { await rm(root,{recursive:true,force:true}) }
})

test('snapshot does not publish raw handoff contents or falsely claim live worker', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'nori-monitor-'))
  try {
    await writeFile(path.join(root,'SHARED_HANDOFF_TO_CLINE_2026-09-29.md'),'DO_NOT_PUBLISH_PRIVATE_PROMPT')
    await writeFile(path.join(root,'NORI_MERGED_UI_REPLAY_RECEIPT_2026-09-29.json'),JSON.stringify({applied:418,operations:427,held:['a']}))
    await writeFile(path.join(root,'NORI_UI_BUILD_PROGRESS_2026-09-29.json'),JSON.stringify({kind:'nori-ui-build-evidence',buildPassed:true,testsPassed:24,privateLog:'DO_NOT_PUBLISH_PRIVATE_PROMPT'}))
    const result=await snapshot(root,path.join(root,'absent'))
    assert.equal(result.recovery.applied,418)
    assert.match(result.recovery.status,/Recorded build passed/)
    assert.equal(result.recovery.testsPassed,24)
    assert.equal(result.coordinator.returnAvailable,false)
    assert.match(result.coordinator.taskLiveness,/Not established/)
    assert.doesNotMatch(JSON.stringify(result),/DO_NOT_PUBLISH_PRIVATE_PROMPT/)
  } finally { await rm(root,{recursive:true,force:true}) }
})

test('current roadmap counts are summarized without publishing private fields',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'nori-monitor-roadmap-'))
  try {
    await writeFile(path.join(root,'ROADMAP_TRACKING.json'),JSON.stringify({schema_version:1,
      release_state:'NOT_VERIFIED',requirements:[{private:'NEVER_PUBLISH'}],components:[{}],secret:'NEVER_PUBLISH'}))
    const result=await snapshot(root,root)
    assert.equal(result.roadmap.available,true)
    assert.equal(result.roadmap.releaseState,'NOT_VERIFIED')
    assert.equal(result.roadmap.requirementCount,1)
    assert.doesNotMatch(JSON.stringify(result),/NEVER_PUBLISH/)
    assert.match(result.work.summary,/do not establish full release readiness/)
  }finally{await rm(root,{recursive:true,force:true})}
})

test('malformed targets and mismatched local origins fail safely without reading status',async()=>{
  let calls=0
  const server=createMonitor(async()=>{calls++;return {readOnly:true}})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  const port=server.address().port,base=`http://127.0.0.1:${port}`
  const raw=target=>new Promise((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port,path:target},response=>{
      response.resume();response.on('end',()=>resolve(response.statusCode))
    });req.on('error',reject);req.end()
  })
  try {
    assert.equal(await raw('//['),400)
    assert.equal(await raw('http://foreign.test/api/status'),400)
    for(const origin of ['null','http://127.0.0.1:1','ftp://127.0.0.1:'+port,'http://localhost:'+port])
      assert.equal((await fetch(base+'/api/status',{headers:{origin}})).status,403)
    assert.equal(calls,0)
    assert.equal((await fetch(base+'/api/status',{headers:{origin:base}})).status,200)
    assert.equal(calls,1)
  }finally{await new Promise(resolve=>server.close(resolve))}
})
