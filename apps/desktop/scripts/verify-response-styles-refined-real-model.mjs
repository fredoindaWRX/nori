import assert from 'node:assert/strict'
import{createRequire}from'node:module'
import{readFileSync,writeFileSync,mkdirSync,existsSync,rmSync,realpathSync}from'node:fs'
import{dirname,resolve}from'node:path'
const require=createRequire(import.meta.url),asar=require('@electron/asar')
const {startAutomaticTextService}=require('../desktop/automatic-text-service.cjs')
const {createModelCapacityCheck}=require('../desktop/model-resource-fit.cjs')
const {startGptOssService}=require('C:/Program Files/Nori/resources/NoriSuite/apps/desktop/desktop/gpt-oss-service.cjs')
const root='C:/Nori/apps/desktop/.response-style-live-check',report='C:/Nori/.work/reports/response-styles-real-model-refined-20261029.json'
assert.ok(!existsSync(root)&&!existsSync(report),'Existing test evidence preserved')
mkdirSync(root);let service
const saved={...process.env},originalFetch=globalThis.fetch,rows=[]
try{
 const archive='C:/Program Files/Nori/resources/app.asar';let bytes=0
 for(const name of asar.listPackage(archive)){
  const path=name.slice(1).replaceAll('\\','/');if(!/^(bridge|desktop)\/.*\.(mjs|cjs|json)$/.test(path))continue
  const content=asar.extractFile(archive,name.slice(1));bytes+=content.length;assert.ok(bytes<32*1024*1024)
  mkdirSync(dirname(root+'/'+path),{recursive:true});writeFileSync(root+'/'+path,content)
 }
 writeFileSync(root+'/bridge/response-profiles.mjs',readFileSync('C:/Nori/apps/desktop/bridge/response-profiles.mjs'))
 writeFileSync(root+'/package.json','{"type":"module"}');mkdirSync(root+'/isolated-state')
 service=await startAutomaticTextService({port:0,canLoad:createModelCapacityCheck(),startModel:({profile,contextTokens,signal})=>startGptOssService({root:'C:/Program Files/Nori/resources/NoriSuite',modelProfile:profile,contextTokens,signal})})
 Object.assign(process.env,service.environment,{NORI_INFERENCE_RUNTIME:'gpt-oss',NORI_SETTINGS_DIR:root+'/isolated-state',NORI_APP_DATA_ROOT:root+'/isolated-state',NORI_LEARNING_FILE:root+'/isolated-state/learning.json',NORI_RUNTIME_CONFIG_PATH:root+'/isolated-state/no-runtime-config.json'})
 const {localChat}=await import(new URL('file:///'+root+'/bridge/local-chat.mjs'))
 for(const [profile,expectedBudget]of Object.entries({'lightning-fast':384,balanced:1024,deep:3072,'adult-companion':700})){
  let payload,requests=0
  globalThis.fetch=async(url,options)=>{if(String(url)===service.endpoint+'/v1/chat/completions'){payload=JSON.parse(options.body);requests++}return originalFetch(url,options)}
  let reply='';const started=Date.now()
  for await(const part of localChat({goal:'Explain how a turbocharger works to someone who likes cars. Match the selected response style. Keep it friendly.',turns:[],profile,modelSelection:'nori-auto',projectToolsRequested:false}))reply+=part
  assert.ok(reply.trim());assert.equal(payload.max_tokens,expectedBudget);assert.equal(payload.tools,undefined)
  rows.push({profile,passed:true,maxTokens:payload.max_tokens,requests,elapsedMs:Date.now()-started,words:reply.trim().split(/\s+/).length,reply})
  console.log(JSON.stringify({profile,passed:true,maxTokens:payload.max_tokens,words:rows.at(-1).words,elapsedMs:rows.at(-1).elapsedMs}))
 }
}catch(error){rows.push({passed:false,error:String(error.message).slice(0,1000)});process.exitCode=1}
finally{
 globalThis.fetch=originalFetch;if(service)await service.stop()
 for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key]
 Object.assign(process.env,saved)
 writeFileSync(report,JSON.stringify({passed:rows.length===4&&rows.every(x=>x.passed),scope:'installed chat module with real local model; isolated settings; no desktop UI or microphone interaction',contextTokens:65536,rows,ownedModelStopped:true},null,2),{flag:'wx'})
 assert.equal(realpathSync(root).toLowerCase(),resolve(root).toLowerCase());rmSync(root,{recursive:true})
}

