import test from'node:test'
import assert from'node:assert/strict'
import {requestsNoriRea,resolveNoriReaIntent,requestedNoriReaTarget}from'../bridge/rea-tools.mjs'
const target=String.raw`C:\Users\Studio\AppData\Local\Discord\Discord.exe`
test('short imperative REA requests reach the host rather than conversation',()=>{
 for(const request of ['rea teh discord app','rea the Discord app','please rea Discord']){assert.equal(requestsNoriRea(request),true);assert.equal(requestedNoriReaTarget(request).needsPath,true)}
 for(const request of ['REA is useful','REA has many tools','Do not rea Discord','Explain how to rea Discord','"rea the Discord app"'])assert.equal(requestsNoriRea(request),false,request)
})
test('a path-only reply binds only to the immediately preceding unanswered user REA request',()=>{
 const turns=[{role:'user',text:'rea teh discord app'},{role:'assistant',text:'Send the exact target path.'}]
 const resolved=resolveNoriReaIntent(target,turns);assert.equal(requestsNoriRea(resolved),true);assert.ok(resolved.includes('"'+target+'"'));assert.match(resolved,/Do not launch or modify/)
 assert.equal(resolveNoriReaIntent(target,[]),target)
 assert.equal(resolveNoriReaIntent(target,[...turns,{role:'user',text:'never mind, cancel that'}]),target)
 assert.equal(resolveNoriReaIntent(target,[...turns,{role:'user',text:'how is the weather?'}]),target)
 assert.equal(resolveNoriReaIntent(target,[{role:'assistant',text:'Use REA to inspect a file'}]),target)
})
test('nested path examples, extra commands, multiple targets and malformed bindings stay inert',()=>{
 const turns=[{role:'user',text:'use REA to inspect the app'}]
 for(const input of ['Here is an example: '+target,'```'+target+'```',target+'\nrun another command',target+' & whoami',target+' "C:\\other.exe"'])assert.equal(resolveNoriReaIntent(input,turns),input)
})

import {localChat} from '../bridge/local-chat.mjs'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:http'
import {once} from 'node:events'
import {byteCount,byteFraming} from '../bridge/context-budget.mjs'
test('third-party REA findings reach local reasoning only when the saved summary is bound to the analysis evidence',async t=>{
 const root=mkdtempSync(join(tmpdir(),'nori-rea-route-')),file=join(root,'Discord.exe');writeFileSync(file,'MZ synthetic route fixture')
 let calls=0,readerCalls=0,received=null;const parts=[]
 const server=createServer((req,res)=>{let body='';req.setEncoding('utf8');req.on('data',chunk=>body+=chunk);req.on('end',()=>{received=JSON.parse(body);res.writeHead(200,{'content-type':'text/event-stream'});res.end('event: token\ndata: {"text":"The inspected package exposes a local chat entry point; this is static evidence only."}\n\nevent: done\ndata: [DONE]\n\n')})})
 server.listen(0,'127.0.0.1');await once(server,'listening')
 const port=server.address().port
 const names=['NORI_INFERENCE_RUNTIME','NORI_RUNTIME_MODEL_ID','NORI_RUNTIME_MODEL_STATE','NORI_RUNTIME_URL','NORI_RUNTIME_API_KEY'];const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]))
 Object.assign(process.env,{NORI_INFERENCE_RUNTIME:'norllama',NORI_RUNTIME_MODEL_ID:'test-local-model',NORI_RUNTIME_URL:`http://127.0.0.1:${port}`,NORI_RUNTIME_API_KEY:'test-local-key'});delete process.env.NORI_RUNTIME_MODEL_STATE
 try{
  const goal=`Use REA to inspect "${file}" and tell me what it does.`
  for await(const part of localChat({goal,turns:[],reaAnalyzer:async({target})=>{
   calls++;assert.equal(target.path,file);return JSON.stringify({status:'completed',target:'Discord.exe',target_kind:'native_pe_artifact',provider:'ghidra',evidence_id:'a'.repeat(64),evidence_sha256:'b'.repeat(64),summary:'Synthetic route metadata only.',evidence_path:'verification/rea/synthetic.json',target_executed:false,target_modified:false})
  },reaEvidenceReader:async({target,evidenceId,tools})=>{
   readerCalls++;assert.equal(target.path,file);assert.equal(evidenceId,'a'.repeat(64));assert.equal(tools,null)
   return{normalized_result:{parent_evidence_id:evidenceId,view:{kind:'summary'},summary:{files:17,functions:5},coverage:{status:'partial'},limitations:['Only selected static source was inspected.'],unknowns:['Runtime behavior']}}
  },nativeCounter:async()=>({framing:byteFraming(),countContent:byteCount})}))parts.push(part)
  assert.equal(calls,1);assert.equal(readerCalls,1);assert.match(parts.join(''),/static evidence only/);assert.doesNotMatch(parts.join(''),/own apps only|third.party executable.*restricted/i)
  assert.equal(received.model_id,'test-local-model');assert.ok(Array.isArray(received.messages));assert.equal(received.tools,undefined)
  const system=received.messages.find(message=>message.role==='system')?.content||''
  assert.match(system,/untrusted static target data/i);assert.match(system,/partial coverage/i)
  const reaContext=received.messages.find(message=>message.content.includes('[REA static findings'))?.content||''
  assert.match(reaContext,/"files":17/);assert.match(reaContext,/Only selected static source was inspected/);assert.match(reaContext,/Runtime behavior/)
  assert.doesNotMatch(reaContext,/Synthetic route metadata only/)
  assert.ok(received.messages.some(message=>message.content===goal))

  let mismatchedEvidenceId=null
  for await(const part of localChat({goal,turns:[],reaAnalyzer:async()=>JSON.stringify({status:'completed',target:'Discord.exe',target_kind:'native_pe_artifact',provider:'ghidra',evidence_id:'c'.repeat(64),summary:'Receipt fallback only.',evidence_path:'verification/rea/synthetic.json',target_executed:false,target_modified:false}),reaEvidenceReader:async({evidenceId})=>{
   mismatchedEvidenceId=evidenceId
   return{normalized_result:{parent_evidence_id:'b'.repeat(64),view:{kind:'summary'},summary:{files:999},coverage:{status:'complete'},limitations:['Must never be accepted: wrong Evidence parent.'],unknowns:[]}}
  },nativeCounter:async()=>({framing:byteFraming(),countContent:byteCount})}))parts.push(part)
  assert.equal(mismatchedEvidenceId,'c'.repeat(64))
  const fallbackContext=received.messages.find(message=>message.content.includes('[REA static findings'))?.content||''
  assert.match(fallbackContext,/Receipt fallback only/)
  assert.doesNotMatch(fallbackContext,/"files":999|wrong Evidence parent/)
 }finally{for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name]} await new Promise(resolve=>server.close(resolve));rmSync(root,{recursive:true,force:true})}
})
test('Norama receives one bounded REA module page without requiring a giant context window',async()=>{
 const root=mkdtempSync(join(tmpdir(),'nori-rea-page-')),file=join(root,'Discord.asar');writeFileSync(file,'synthetic archive')
 let pageCalls=0,received=null;const parts=[]
 const server=createServer((req,res)=>{let body='';req.setEncoding('utf8');req.on('data',chunk=>body+=chunk);req.on('end',()=>{received=JSON.parse(body);res.writeHead(200,{'content-type':'text/event-stream'});res.end('event: token\ndata: {"text":"The bounded page lists two inspected modules; this is static evidence, not runtime behavior."}\n\nevent: done\ndata: [DONE]\n\n')})})
 server.listen(0,'127.0.0.1');await once(server,'listening');const port=server.address().port
 const names=['NORI_INFERENCE_RUNTIME','NORI_RUNTIME_MODEL_ID','NORI_RUNTIME_MODEL_STATE','NORI_RUNTIME_URL','NORI_RUNTIME_API_KEY'];const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]))
 Object.assign(process.env,{NORI_INFERENCE_RUNTIME:'norllama',NORI_RUNTIME_MODEL_ID:'test-local-model',NORI_RUNTIME_URL:`http://127.0.0.1:${port}`,NORI_RUNTIME_API_KEY:'test-local-key'});delete process.env.NORI_RUNTIME_MODEL_STATE
 try{
  const goal=`Use REA to inspect "${file}" and tell me what it does.`
  const evidenceDefinition={type:'function',function:{name:'rea_inspect_latest_evidence',parameters:{type:'object'}}}
  for await(const part of localChat({goal,turns:[],reaAnalyzer:async()=>JSON.stringify({status:'completed',target:'Discord.asar',target_kind:'electron_application',provider:'rea-static',evidence_id:'d'.repeat(64),summary:'Synthetic summary.',target_executed:false,target_modified:false}),reaEvidenceReader:async({evidenceId})=>({normalized_result:{parent_evidence_id:evidenceId,view:{kind:'summary'},summary:{modules:12},coverage:{status:'partial'},limitations:['Only selected modules were inspected.'],unknowns:['Runtime behavior']}}),reaEvidenceToolFactory:async()=>({reaEvidenceWorker:true,definitions:[evidenceDefinition],call:async(name,args)=>{pageCalls++;assert.equal(name,'rea_inspect_latest_evidence');assert.deepEqual(args,{view:{kind:'page',collection:'modules',offset:0,limit:2}});return JSON.stringify({normalized_result:{parent_evidence_id:'d'.repeat(64),view:{kind:'page',collection:'modules',offset:0,limit:2},items:[{node_id:'jag_node_'+'e'.repeat(64),path:'bridge/chat.mjs',summary:'Local chat routing.'},{node_id:'jag_node_'+'f'.repeat(64),path:'bridge/rea.mjs',summary:'REA adapter.'}],coverage:{status:'partial'},limitations:['Only two modules are shown.'],unknowns:['Uninspected behavior']}})}}),nativeCounter:async()=>({framing:byteFraming(),countContent:byteCount})}))parts.push(part)
  assert.equal(pageCalls,1);assert.match(parts.join(''),/bounded page lists two inspected modules/)
  assert.ok(received.messages.some(message=>message.content.includes('bridge/chat.mjs')))
  const reaContext=received.messages.find(message=>message.content.includes('[REA static findings'))?.content||''
  assert.match(reaContext,/"module_page"/);assert.match(reaContext,/Only two modules are shown/)
 }finally{for(const name of names){if(previous[name]===undefined)delete process.env[name];else process.env[name]=previous[name]}await new Promise(resolve=>server.close(resolve));rmSync(root,{recursive:true,force:true})}
})
test('tool-capable local route can request one item from the exact REA module page',async t=>{
 const root=mkdtempSync(join(tmpdir(),'nori-rea-tool-route-')),file=join(root,'Discord.asar');writeFileSync(file,'synthetic archive')
 const names=['NORI_INFERENCE_RUNTIME','NORI_GPT_OSS_ENABLED','NORI_GPT_OSS_URL','NORI_GPT_OSS_SERVER_MODEL','NORI_GPT_OSS_CONTEXT_TOKENS'];const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]))
 const payloads=[],views=[];const nodeId='jag_node_'+'e'.repeat(64)
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;payloads.push(JSON.parse(raw));res.writeHead(200,{'content-type':'text/event-stream'})
  if(payloads.length===1){const call={index:0,id:'rea_item_01',type:'function',function:{name:'rea_inspect_latest_evidence',arguments:JSON.stringify({view:{kind:'item',selector:{node_id:nodeId}}})}};res.end(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[call]},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`)}
  else res.end(`data: ${JSON.stringify({choices:[{delta:{content:'The selected module contains a local chat handler; this is static source evidence.'},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`)
 })
 server.listen(0,'127.0.0.1');await once(server,'listening');Object.assign(process.env,{NORI_INFERENCE_RUNTIME:'gpt-oss',NORI_GPT_OSS_ENABLED:'1',NORI_GPT_OSS_URL:`http://127.0.0.1:${server.address().port}`,NORI_GPT_OSS_SERVER_MODEL:'fixture-qwen-local',NORI_GPT_OSS_CONTEXT_TOKENS:'65536'})
 try{
  const definition={type:'function',function:{name:'rea_inspect_latest_evidence',description:'Read bounded REA evidence for this analysis only.',parameters:{type:'object',additionalProperties:false,properties:{view:{type:'object',properties:{kind:{type:'string'},collection:{type:'string'},offset:{type:'integer'},limit:{type:'integer'},selector:{type:'object',properties:{node_id:{type:'string'}},required:['node_id']}},required:['kind']}},required:['view']}}}
  const goal=`Use REA to inspect "${file}" and explain the chat implementation.`;const parts=[]
  const options={
   goal,turns:[],modelSelection:'fixture-qwen-local',
   reaAnalyzer:async()=>JSON.stringify({status:'completed',target:'Discord.asar',target_kind:'electron_application',provider:'rea-static',evidence_id:'d'.repeat(64),summary:'Synthetic summary.',target_executed:false,target_modified:false}),
   reaEvidenceReader:async({evidenceId})=>({normalized_result:{parent_evidence_id:evidenceId,view:{kind:'summary'},summary:{modules:12},coverage:{status:'partial'},limitations:[],unknowns:[]}}),
   reaEvidenceToolFactory:async()=>({
    reaEvidenceWorker:true,reaEvidenceModulePages:true,optionalTools:true,definitions:[definition],
    call:async(_name,args)=>{
     views.push(args.view)
     if(args.view.kind==='page')return JSON.stringify({normalized_result:{parent_evidence_id:'d'.repeat(64),view:{kind:'page'},items:[{node_id:nodeId,path:'bridge/chat.mjs'}]}})
     assert.equal(args.view.kind,'item');assert.equal(args.view.selector.node_id,nodeId)
     return JSON.stringify({normalized_result:{parent_evidence_id:'d'.repeat(64),view:{kind:'item'},item:{node_id:nodeId,path:'bridge/chat.mjs',summary:'Known local module detail.'}}})
    },
   }),
  }
  for await(const part of localChat(options))parts.push(part)
  assert.equal(views.length,2);assert.deepEqual(views[0],{kind:'page',collection:'modules',offset:0,limit:2});assert.equal(views[1].kind,'item')
  assert.equal(payloads.length,2);assert.deepEqual(payloads[0].tools.map(tool=>tool.function.name),['rea_inspect_latest_evidence']);assert.equal(payloads[0].tool_choice,'auto')
  assert.ok(payloads[1].messages.some(message=>message.role==='tool'&&message.content.includes('Known local module detail.')))
  assert.match(parts.join(''),/static source evidence/)
 }finally{for(const [name,value]of Object.entries(previous)){if(value===undefined)delete process.env[name];else process.env[name]=value}await new Promise(resolve=>server.close(resolve));rmSync(root,{recursive:true,force:true})}
})
test('short REA request asks for a target truthfully without invoking inference',async()=>{
 let calls=0;const parts=[]
 for await(const part of localChat({goal:'rea teh discord app',turns:[],reaAnalyzer:async()=>{calls++;throw Error('No target supplied')},nativeChatGenerator:async function*(){throw Error('Must use host capability answer')}}))parts.push(part)
 assert.equal(calls,0);assert.match(parts.join(''),/third-party apps/)
})

import {mkdirSync} from 'node:fs'
import {checkNoriReaConnection} from '../bridge/rea-tools.mjs'
test('REA and Node resolve from the canonical Nori state home even with redirected shell AppData',async()=>{
 const root=mkdtempSync(join(tmpdir(),'nori-rea-profile-')),home=join(root,'Nori'),desktop=join(home,'state','desktop'),script=join(home,'integrations','rea','node_modules','rea-agents','scripts','rea.mjs'),node=join(home,'tools','node-v26.12.1-win-x64','node.exe')
 mkdirSync(desktop,{recursive:true});mkdirSync(join(script,'..'),{recursive:true});writeFileSync(script,'// mock CLI');writeFileSync(join(script,'..','..','package.json'),JSON.stringify({name:'rea-agents',version:'6.8.0'}));mkdirSync(join(node,'..'),{recursive:true});writeFileSync(node,'mock node')
 const oldScript=join(root,'old-rea','scripts','rea.mjs');mkdirSync(join(oldScript,'..'),{recursive:true});writeFileSync(oldScript,'// old CLI');writeFileSync(join(oldScript,'..','..','package.json'),JSON.stringify({name:'rea-agents',version:'6.5.0'}))
 try{const status=await checkNoriReaConnection({noriRoot:root,environment:{NORI_REA_SCRIPT:oldScript,NORI_APP_DATA_ROOT:desktop,LOCALAPPDATA:join(root,'redirected-cache'),APPDATA:join(root,'roaming'),PATH:''},nodeVersionProbe:async selected=>{assert.equal(selected,node);return 'v26.12.1'},mcpFactory:async selected=>{assert.equal(selected.script,script);return{async listTools(){return{tools:['analyze_javascript_application','get_evidence_bundle','inspect_analysis_view','open_binary','binary_overview','export_evidence_bundle','close_binary'].map(name=>({name}))}},async close(){}}}});assert.equal(status.status,'connected')}finally{rmSync(root,{recursive:true,force:true})}
})

import {existsSync} from 'node:fs'
import {noriReaEvidenceDirectory} from '../bridge/rea-tools.mjs'
test('production-style evidence uses the canonical user state instead of the installed code root',()=>{
 const root=mkdtempSync(join(tmpdir(),'nori-rea-evidence-')),code=join(root,'installed'),home=join(root,'Nori'),desktop=join(home,'state','desktop');mkdirSync(code);mkdirSync(desktop,{recursive:true})
 try{const result=noriReaEvidenceDirectory(code,{NORI_APP_DATA_ROOT:desktop});assert.equal(result,join(desktop,'verification','rea'));assert.equal(existsSync(join(code,'verification')),false);assert.equal(existsSync(result),true);assert.throws(()=>noriReaEvidenceDirectory(code,{NORI_APP_DATA_ROOT:join(root,'unverified')}),/verified canonical/)}finally{rmSync(root,{recursive:true,force:true})}
})

test('REA managed tools support the actual legacy and consolidated private desktop layouts',async()=>{
 const root=mkdtempSync(join(tmpdir(),'nori-rea-layout-')),home=join(root,'Nori'),script=join(home,'integrations','rea','node_modules','rea-agents','scripts','rea.mjs'),node=join(home,'tools','node-v26.12.1-win-x64','node.exe');mkdirSync(join(script,'..'),{recursive:true});writeFileSync(script,'// test');writeFileSync(join(script,'..','..','package.json'),JSON.stringify({name:'rea-agents',version:'6.8.0'}));mkdirSync(join(node,'..'),{recursive:true});writeFileSync(node,'test');mkdirSync(join(home,'state','private','desktop'),{recursive:true})
 try{for(const state of [home,join(home,'state','private','desktop')]){const status=await checkNoriReaConnection({noriRoot:root,environment:{NORI_APP_DATA_ROOT:state,PATH:''},nodeVersionProbe:async selected=>{assert.equal(selected,node);return 'v26.12.1'},mcpFactory:async selected=>{assert.equal(selected.script,script);return{async listTools(){return{tools:['analyze_javascript_application','get_evidence_bundle','inspect_analysis_view','open_binary','binary_overview','export_evidence_bundle','close_binary'].map(name=>({name}))}},async close(){}}}});assert.equal(status.status,'connected')}}finally{rmSync(root,{recursive:true,force:true})}
})

test('a separate state home without tools cannot hide the managed LocalAppData REA installation',async()=>{
 const root=mkdtempSync(join(tmpdir(),'nori-rea-roots-')),desktop=join(root,'Nori','state','private','desktop'),roaming=join(root,'profile','AppData','Roaming'),home=join(root,'profile','AppData','Local','Nori'),script=join(home,'integrations','rea','node_modules','rea-agents','scripts','rea.mjs'),node=join(home,'tools','node-v26.12.1-win-x64','node.exe');mkdirSync(desktop,{recursive:true});mkdirSync(roaming,{recursive:true});mkdirSync(join(script,'..'),{recursive:true});writeFileSync(script,'// test');writeFileSync(join(script,'..','..','package.json'),JSON.stringify({name:'rea-agents',version:'6.8.0'}));mkdirSync(join(node,'..'),{recursive:true});writeFileSync(node,'test')
 try{const status=await checkNoriReaConnection({noriRoot:root,environment:{NORI_APP_DATA_ROOT:desktop,APPDATA:roaming,PATH:''},nodeVersionProbe:async selected=>{assert.equal(selected,node);return 'v26.12.1'},mcpFactory:async selected=>{assert.equal(selected.script,script);return{async listTools(){return{tools:['analyze_javascript_application','get_evidence_bundle','inspect_analysis_view','open_binary','binary_overview','export_evidence_bundle','close_binary'].map(name=>({name}))}},async close(){}}}});assert.equal(status.status,'connected')}finally{rmSync(root,{recursive:true,force:true})}
})

test('packaged REA and Node are selected without any shell or user-profile discovery',async()=>{
 const root=mkdtempSync(join(tmpdir(),'nori-rea-owned-')),node=join(root,'tools','rea','node.exe'),script=join(root,'tools','rea','node_modules','rea-agents','scripts','rea.mjs');mkdirSync(join(script,'..'),{recursive:true});writeFileSync(script,'// packaged test');writeFileSync(join(script,'..','..','package.json'),JSON.stringify({name:'rea-agents',version:'6.8.0'}));writeFileSync(node,'packaged test node')
 try{const status=await checkNoriReaConnection({noriRoot:root,environment:{PATH:''},nodeVersionProbe:async selected=>{assert.equal(selected,node);return 'v26.12.1'},mcpFactory:async selected=>{assert.equal(selected.script,script);return{async listTools(){return{tools:['analyze_javascript_application','get_evidence_bundle','inspect_analysis_view','open_binary','binary_overview','export_evidence_bundle','close_binary'].map(name=>({name}))}},async close(){}}}});assert.equal(status.status,'connected')}finally{rmSync(root,{recursive:true,force:true})}
})
