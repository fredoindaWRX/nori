import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {existsSync,writeFileSync} from 'node:fs'
const require=createRequire(import.meta.url)
const {startAutomaticTextService}=require('../desktop/automatic-text-service.cjs')
const {startVideoCapableModelService}=require('../desktop/video-capable-model.cjs')
const {createModelCapacityCheck}=require('../desktop/model-resource-fit.cjs')
const {startGptOssService}=require('C:/Nori/.work/model-team-integration/patch/gpt-oss-service.cjs')
const report='C:/Nori/.work/reports/model-capacity-recovery-live.json'
assert.ok(!existsSync(report),'Existing evidence preserved')
const physicalCapacity=createModelCapacityCheck()
let allowed=true,starts=0,owner,ownerExited=false
const capacity=async(...args)=>allowed&&physicalCapacity(...args)
capacity.recheckAfterUnload=true
const evidence={scope:'source endpoints and real GPU text inference with injected capacity refusal; not installed desktop acceptance',capacityRefusalInjected:true,mediaGenerationTested:false,contextTokens:65536,installedAppUpdated:false,passed:false}
try{
 owner=await startVideoCapableModelService({}, {cleanupVideo:async()=>{},startService:()=>startAutomaticTextService({port:0,canLoad:capacity,startModel:options=>{
  starts++;return startGptOssService({root:'C:/Program Files/Nori/resources/NoriSuite',modelProfile:options.profile,contextTokens:options.contextTokens,signal:options.signal})
 }})})
 owner.exited.then(()=>{ownerExited=true})
 const endpoint=owner.endpoint,environment=owner.environment
 const chat=marker=>fetch(endpoint+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'nori-auto',messages:[{role:'user',content:'Reply exactly '+marker+'.'}],max_tokens:32,temperature:0}),signal:AbortSignal.timeout(90000)})
 const control=(path,lease)=>fetch(environment.NORI_VIDEO_LEASE_URL+path,{method:'POST',headers:{authorization:'Bearer '+environment.NORI_VIDEO_LEASE_TOKEN,...(lease?{'x-nori-video-lease':lease}:{})},signal:AbortSignal.timeout(120000)})
 const before=await chat('NORI_RECOVERY_BEFORE');assert.equal(before.status,200)
 assert.equal((await before.json()).choices[0].message.content.trim(),'NORI_RECOVERY_BEFORE')
 const acquire=await control('/acquire');assert.equal(acquire.status,200)
 const {leaseId}=await acquire.json();allowed=false
 const release=await control('/release',leaseId);assert.equal(release.status,409);await release.json()
 assert.equal(owner.videoModelState,'unavailable');assert.equal(ownerExited,false)
 const denied=await chat('MUST_NOT_RUN');assert.equal(denied.status,503)
 assert.equal((await denied.json()).error.code,'LOCAL_MODEL_CAPACITY_UNAVAILABLE')
 assert.equal(starts,1);allowed=true
 const recovered=await chat('NORI_RECOVERY_AFTER');assert.equal(recovered.status,200)
 assert.equal((await recovered.json()).choices[0].message.content.trim(),'NORI_RECOVERY_AFTER')
 assert.equal(owner.endpoint,endpoint);assert.equal(owner.videoModelState,'ready');assert.equal(ownerExited,false)
 evidence.realRepliesVerified=2;evidence.starts=starts;evidence.sameEndpointRecovered=true;evidence.ownerKeptRunning=true;evidence.passed=true
}catch(error){evidence.error=String(error.stack||error);process.exitCode=1}
finally{
 await owner?.stop();evidence.ownedProcessesStopped=true
 writeFileSync(report,JSON.stringify(evidence,null,2),{flag:'wx'})
 console.log(JSON.stringify(evidence))
}
