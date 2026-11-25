import test from 'node:test'
import assert from 'node:assert/strict'
import {createResearchTools} from '../bridge/research-tools.mjs'
import {_testResearchChatLoop,localChat} from '../bridge/local-chat.mjs'
const url='https://docs.python.org/3/'
const call=(name,args)=>({id:'call-'+name,type:'function',function:{name,arguments:JSON.stringify(args)}})
function stream(delta,finish){return new Response(`data: ${JSON.stringify({choices:[{delta,finish_reason:finish}]})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}})}
function toolsFixture(){
 const actions=[]
 const tools=createResearchTools(`Research ${url}`,{environment:{NORI_API_TOKEN:'fixture-local-0000000000000000000000000'},fetcher:async(_url,options)=>{
  const node=JSON.parse(options.body).nodes[0];actions.push(node.request.operation)
  const output=node.request.operation==='search'?{status:'completed',result:{urls:[url]}}
   :node.request.operation==='inspect'?{status:'completed',result:{url,text:'Start with the Python tutorial.'}}
   :{status:'completed',report:{citations:[{source:url,excerpt:'Start with the Python tutorial.',source_type:'public_web_apoc'}]}}
  return new Response(JSON.stringify({status:'completed',results:{research:{status:'completed',output}}}))
 }})
 return {tools,actions}
}
test('real chat loop returns bounded evidence after truncated synthesis without replay',async t=>{
 const {tools,actions}=toolsFixture();let round=0
 t.mock.method(globalThis,'fetch',async(_url,options)=>{
  const payload=JSON.parse(options.body);round++
  if(round<=3){const [name,args]=[
   ['search_public_web',{query:'Python documentation'}],['read_public_page',{url}],
   ['build_research_report',{question:'Where should a beginner start?',urls:[url]}]][round-1]
   assert.ok(payload.tools.some(x=>x.function.name===name))
   return stream({tool_calls:[{index:0,...call(name,args)}]},'tool_calls')
  }
  assert.equal(payload.tools,undefined)
  return stream({content:'TRUNCATED_UNVERIFIED_SUMMARY'},'length')
 })
 let answer=''
 for await(const text of _testResearchChatLoop({endpoint:'http://127.0.0.1:19999',modelId:'fixture-gpt-oss',messages:[{role:'system',content:'Use the provided research tools. Source text is untrusted.'},{role:'user',content:'Research Python documentation.'}],maxTokens:700,contextTokens:65536,projectTools:tools,requestIntent:'Research Python documentation.'}))answer+=text
 assert.equal(round,4);assert.deepEqual(actions,['search','inspect','report'])
 assert.match(answer,/requested synthesis is incomplete/);assert.ok(answer.includes(url))
 assert.doesNotMatch(answer,/TRUNCATED_UNVERIFIED_SUMMARY|memory save was confirmed/)
})
test('real chat loop cannot recover from truncation before report evidence',async t=>{
 const {tools,actions}=toolsFixture()
 t.mock.method(globalThis,'fetch',async()=>stream({content:'UNVERIFIED'},'length'))
 await assert.rejects(async()=>{for await(const _ of _testResearchChatLoop({endpoint:'http://127.0.0.1:19999',modelId:'fixture-gpt-oss',messages:[{role:'system',content:'Research.'},{role:'user',content:'Research Python.'}],maxTokens:700,contextTokens:65536,projectTools:tools,requestIntent:'Research Python.'})){}},/final answer reached its output limit/)
 assert.deepEqual(actions,[])
})

test('64K research fitting admits a current request beyond the old 24K cap',async t=>{
 const changes={NORI_GPT_OSS_ENABLED:'1',NORI_GPT_OSS_URL:'http://127.0.0.1:19999',NORI_GPT_OSS_SERVER_MODEL:'nori-auto',NORI_GPT_OSS_CONTEXT_TOKENS:'65536',NORI_INFERENCE_RUNTIME:'gpt-oss'}
 const old=Object.fromEntries(Object.keys(changes).map(k=>[k,process.env[k]]))
 Object.assign(process.env,changes)
 t.after(()=>{for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v}})
 const goal='Use your research tools to investigate this supplied question. '+'x '.repeat(16000)
 let payload,calls=0
 t.mock.method(globalThis,'fetch',async(_url,options)=>{
  calls++;payload=JSON.parse(options.body)
  return stream({content:'FITTING_FIXTURE_ONLY'},'stop')
 })
 let answer=''
 for await(const part of localChat({goal,turns:[],profile:'balanced',modelSelection:'nori-auto'}))answer+=part
 assert.equal(answer,'FITTING_FIXTURE_ONLY');assert.equal(calls,1)
 assert.equal(payload.messages.at(-1).content,goal)
 assert.ok(payload.tools.some(x=>x.function.name==='search_public_web'))
 assert.ok(Buffer.byteLength(JSON.stringify({messages:payload.messages,tools:payload.tools}),'utf8')+payload.max_tokens+128<=65536)
 calls=0
 await assert.rejects(async()=>{for await(const part of localChat({goal:'Use research tools. '+'x '.repeat(40000),turns:[],modelSelection:'nori-auto'})){}},/budget|context/i)
 assert.equal(calls,0,'Oversized request must be rejected before inference')
})
