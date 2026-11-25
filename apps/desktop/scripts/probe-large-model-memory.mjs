import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {freemem} from 'node:os'
import {existsSync,writeFileSync,createReadStream} from 'node:fs'
import {createHash} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
const require=createRequire(import.meta.url),exec=promisify(execFile)
const {startGptOssService}=require('C:/Nori/.work/model-team-integration/patch/gpt-oss-service.cjs')
const {importedModelProfile}=require('../desktop/imported-model-profile.cjs')
const profile=importedModelProfile('qwen3.8-27b'),root='C:/Program Files/Nori/resources/NoriSuite'
const report='C:/Nori/.work/reports/large-model-memory-probe.json'
assert.ok(!existsSync(report),'Existing evidence preserved')
const gpu=async()=>{
 const {stdout}=await exec('C:/Windows/System32/nvidia-smi.exe',['--query-gpu=memory.used,memory.free','--format=csv,noheader,nounits'],{windowsHide:true,timeout:5000})
 assert.match(stdout.trim(),/^\d+,\s*\d+$/)
 const [used,free]=stdout.trim().split(',').map(Number);return {usedMiB:used,freeMiB:free}
}
const before=await gpu();assert.ok(before.freeMiB>=10240&&freemem()>=6*1024**3,'Not enough room for a bounded large-profile qualification')
const hash=createHash('sha256');for await(const chunk of createReadStream(root+'/'+profile.relativePath))hash.update(chunk)
assert.equal(hash.digest('hex'),profile.sha256)
const samples=[before];let monitoring=true,service
const monitor=(async()=>{while(monitoring){samples.push(await gpu());await delay(500)}})()
const evidence={model:profile.id,contextTokens:65536,gpuLayers:profile.gpuLayers,checkpointSha256:profile.sha256,
 before,full64KPromptQualified:false,installedAppVerified:false,processVramAccountingExact:false}
try{
 service=await startGptOssService({root,modelProfile:profile.id,contextTokens:65536})
 const response=await fetch(service.endpoint+'/v1/chat/completions',{method:'POST',headers:{'content-type':'application/json'},
  signal:AbortSignal.timeout(90000),body:JSON.stringify({model:service.modelId,messages:[{role:'user',content:'What is 19 times 23? Reply only with the integer.'}],
   max_tokens:64,temperature:0,chat_template_kwargs:{enable_thinking:false}})})
 assert.equal(response.status,200);const result=await response.json()
 assert.equal(result.choices[0].message.content.trim(),'437')
 evidence.reply='437';evidence.timings=result.timings;evidence.passed=true
}catch(error){evidence.passed=false;evidence.failure=String(error.message).slice(0,1000);throw error}
finally{
 monitoring=false;await monitor
 evidence.peakHostGpuUsedMiB=Math.max(...samples.map(sample=>sample.usedMiB))
 evidence.observedGpuDeltaMiB=evidence.peakHostGpuUsedMiB-before.usedMiB
 if(service){await service.stop();const exit=await service.exited;evidence.engineMemoryLines=(exit.stderrTail??'').split('\n').filter(line=>/buffer.*size|size.*buffer/i.test(line)).slice(-12)}
 evidence.after=await gpu();evidence.ownedEngineStopped=true
 writeFileSync(report,JSON.stringify(evidence,null,2),{flag:'wx'});console.log(JSON.stringify(evidence))
}
