import assert from 'node:assert/strict'
import{createRequire}from'node:module'
import{execFile}from'node:child_process'
import{promisify}from'node:util'
import{existsSync,writeFileSync}from'node:fs'
const require=createRequire(import.meta.url)
const {startAutomaticTextService}=require('../desktop/automatic-text-service.cjs')
const {createModelCapacityCheck}=require('../desktop/model-resource-fit.cjs')
const {startGptOssService}=require('C:/Nori/.work/model-team-integration/patch/gpt-oss-service.cjs')
const report='C:/Nori/.work/reports/research-real-planner-live-page.json'
assert.ok(!existsSync(report),'Existing evidence preserved')
const root='C:/Program Files/Nori/resources/NoriSuite'
let service
const result={scope:'real local model and installed research cycle; patched report adapter; actual installed page reader and existing host network policy; controlled search seed and gateway fixture; no desktop acceptance',installedChanged:false}
try{
 service=await startAutomaticTextService({port:0,canLoad:createModelCapacityCheck(),startModel:({profile,contextTokens,signal})=>startGptOssService({root,modelProfile:profile,contextTokens,signal})})
 console.log(JSON.stringify({phase:'model-ready',contextTokens:service.contextTokens}))
 const {stdout}=await promisify(execFile)(root+'/python/Python311/python.exe',['-I','-B','C:/Nori/apps/desktop/scripts/probe-research-real-planner.py',service.endpoint,'--live-page'],{windowsHide:true,timeout:180000,maxBuffer:65536})
 Object.assign(result,JSON.parse(stdout.trim()))
}catch(error){result.passed=false;result.error=String(error.message).slice(0,1000);if(error.stdout){try{result.providerResult=JSON.parse(error.stdout.trim())}catch{}};process.exitCode=1}
finally{if(service)await service.stop();result.ownedProcessesStopped=true;writeFileSync(report,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result))}

