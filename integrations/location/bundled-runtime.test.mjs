import test from 'node:test'
import assert from 'node:assert/strict'
import {spawn,spawnSync} from 'node:child_process'
import {createServer} from 'node:net'
import {resolve} from 'node:path'
import {mkdtempSync,mkdirSync,copyFileSync,rmSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {tmpdir} from 'node:os'
const root=resolve(import.meta.dirname,'../..')
const packagedRoot=process.env.NORI_LOCATION_TEST_PACKAGED_ROOT
const selfContained=process.env.NORI_LOCATION_TEST_SELF_CONTAINED==='1'
const candidates=[{name:'bundled Nori Electron',suiteRoot:root,
  executable:resolve(root,'runtime/electron/v44.4.5/electron.exe')}]
if(packagedRoot)candidates.push({name:'packaged Nori executable',suiteRoot:resolve(packagedRoot),
  executable:resolve(packagedRoot,'../..','Nori.exe')})
for(const candidate of candidates)test(`${candidate.name} runs the actual receiver without system Node or real credentials`,
  {skip:process.platform!=='win32',timeout:15000},async()=>{
    const componentRoot=selfContained?candidate.suiteRoot:root
    const helper=join(componentRoot,'integrations/location/runtime-path.ps1')
    const resolved=spawnSync('powershell.exe',['-NoProfile','-Command',
      ". '"+helper.replaceAll("'","''")+"'; Resolve-NoriLocationRuntime -NoriRoot '"+
        candidate.suiteRoot.replaceAll("'","''")+"'"],
      {encoding:'utf8',timeout:5000,windowsHide:true})
    assert.equal(resolved.status,0,resolved.stderr)
    assert.equal(resolved.stdout.trim(),candidate.executable)
    const reservation=createServer()
    await new Promise(done=>reservation.listen(0,'127.0.0.1',done))
    const port=reservation.address().port
    await new Promise(done=>reservation.close(done))
    const owner='synthetic-owner-credential-11111111111111111'
    const child=spawn(resolved.stdout.trim(),[join(componentRoot,'integrations/location/start.mjs')],
      {cwd:componentRoot,shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{
        SystemRoot:process.env.SystemRoot,PATH:resolve(process.env.SystemRoot,'System32'),
        ELECTRON_RUN_AS_NODE:'1',NORI_LOCATION_PORT:String(port),
        NORI_LOCATION_PHONE_PASSWORD:'synthetic-phone-credential-22222222222222222',
        NORI_LOCATION_OWNER_PASSWORD:owner}})
    const exited=new Promise(done=>{child.once('exit',done);child.once('error',done)})
    let timer
    try {
      await new Promise((done,reject)=>{
        timer=setTimeout(()=>reject(Error('Bundled receiver readiness timeout')),5000)
        child.once('error',reject)
        child.once('exit',()=>reject(Error('Bundled receiver exited before ready')))
        child.stdout.on('data',bytes=>{if(bytes.toString().includes('sharing paused'))done()})
      })
      clearTimeout(timer)
      const endpoint=`http://127.0.0.1:${port}/location/current`
      const denied=await fetch(endpoint,{signal:AbortSignal.timeout(2000)})
      assert.equal(denied.status,401);await denied.body.cancel()
      const response=await fetch(endpoint,{headers:{authorization:'Basic '+Buffer.from('owner:'+owner).toString('base64')},signal:AbortSignal.timeout(2000)})
      assert.equal(response.status,200)
      const state=await response.json()
      assert.equal(state.enabled,false)
      assert.equal(state.location,null)
      // Copy only the selected integration modules. The relocated probe must
      // import its adapter from this disposable tree, not the source checkout.
      const isolated=mkdtempSync(join(tmpdir(),'nori-location-relocated-'))
      try {
        const paths=['integrations/location/probe-native.mjs',
          'apps/desktop/desktop/native-service.cjs',
          ...['nori-v2-query.mjs','local-image.mjs','local-location.mjs','local-chat.mjs',
            'response-profiles.mjs','nori-identity.mjs','nori-ui-commands.mjs',
            'nori-school.mjs','nori-learning.mjs','local-policy.mjs','native-runtime.mjs']
            .map(name=>'apps/desktop/bridge/'+name)]
        for(const path of paths){
          const destination=join(isolated,path)
          mkdirSync(dirname(destination),{recursive:true})
          copyFileSync(join(componentRoot,path),destination)
        }
        const probe=spawnSync(candidate.executable,[join(isolated,'integrations/location/probe-native.mjs')],
          {cwd:isolated,encoding:'utf8',timeout:5000,windowsHide:true,env:{
            SystemRoot:process.env.SystemRoot,PATH:resolve(process.env.SystemRoot,'System32'),
            ELECTRON_RUN_AS_NODE:'1',NORI_LOCATION_URL:`http://127.0.0.1:${port}`,
            NORI_LOCATION_OWNER_PASSWORD:owner}})
        assert.equal(probe.status,0,probe.stderr)
        assert.deepEqual(JSON.parse(probe.stdout),{
          nativeLocationRead:true,category:'paused',savedHistoryCallbacks:0})
      } finally {rmSync(isolated,{recursive:true,force:true})}
    } finally {
      clearTimeout(timer)
      if(child.exitCode===null)child.kill() // Exact disposable synthetic receiver only.
      await exited
    }
})
