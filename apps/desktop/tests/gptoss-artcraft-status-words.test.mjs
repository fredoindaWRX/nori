import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {createHash} from 'node:crypto'
import {localChat} from '../bridge/local-chat.mjs'
import {needsSonStatusFactCheck} from '../bridge/son-status-output-guard.mjs'

test('status-like filenames do not withhold the scoped ArtCraft plan tool',async t=>{
  const names=['NORI_GPT_OSS_ENABLED','NORI_GPT_OSS_URL','NORI_GPT_OSS_SERVER_MODEL','NORI_INFERENCE_RUNTIME','NORI_ROOT']
  const previous=Object.fromEntries(names.map(n=>[n,process.env[n]]))
  const tool='artcraft_wordcraft_new_document'
  const opcode=Number.parseInt(createHash('sha256').update(tool).digest('hex').slice(0,8),16)
  const plan={schema:'nori.neuralese.artcraft-plan.v1',app_id:'wordcraft',status:'complete',
    nodes:[{id:'n0',opcode,slots:{0:'Proof',1:'docx'},depends_on:[]}],clarification:null}
  let requests=0,executions=0
  const server=createServer(async(req,res)=>{
    let raw='';for await(const chunk of req)raw+=chunk
    const payload=JSON.parse(raw);requests++
    assert.equal(needsSonStatusFactCheck(payload.messages),true,'the existing response fact-check remains active')
    assert.deepEqual(payload.tools.map(t=>t.function.name),['artcraft_wordcraft_neuralese_plan'])
    res.writeHead(200,{'content-type':'text/event-stream'})
    res.end(`data: ${JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'fixture',type:'function',function:{
      name:'artcraft_wordcraft_neuralese_plan',arguments:JSON.stringify(plan)}}]},finish_reason:'tool_calls'}]})}\n\ndata: [DONE]\n\n`)
  })
  await new Promise(r=>server.listen(0,'127.0.0.1',r))
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));for(const n of names)if(previous[n]===undefined)delete process.env[n];else process.env[n]=previous[n]})
  Object.assign(process.env,{NORI_GPT_OSS_ENABLED:'1',NORI_GPT_OSS_URL:`http://127.0.0.1:${server.address().port}`,
    NORI_GPT_OSS_SERVER_MODEL:'fixture',NORI_INFERENCE_RUNTIME:'gpt-oss',NORI_ROOT:'C:/Nori'})
  const definitions=[{type:'function',function:{name:tool,description:'Create document',parameters:{type:'object',additionalProperties:false,
    properties:{title:{type:'string'},format:{type:'string',enum:['docx']}},required:['title','format']}}}]
  let answer=''
  for await(const part of localChat({goal:'Use WordCraft to create nori-model-smoke.docx.',turns:[],modelSelection:'gpt-oss:20b',
    artCraftMcpFactory:async appId=>({appId,definitions,async call(name,args){executions++;assert.equal(name,tool);
      assert.deepEqual(args,{title:'Proof',format:'docx'});return JSON.stringify({isError:false,content:[{type:'text',text:'Fixture document created.'}]})},async close(){}})}))answer+=part
  assert.equal(requests,1);assert.equal(executions,1);assert.match(answer,/Neuralese-validated action/)
})
