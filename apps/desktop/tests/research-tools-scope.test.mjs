import test from 'node:test'
import assert from 'node:assert/strict'
import {createResearchTools,researchEvidenceFallback} from '../bridge/research-tools.mjs'
const url='https://docs.python.org/3/'
function fixture({extraCitation=false,denyReport=false}={}){
 const requests=[]
 const tools=createResearchTools(`Use research tools to read ${url}`,{
  environment:{NORI_COUNCIL_URL:'http://127.0.0.1:9107',NORI_API_TOKEN:'synthetic-fixture-token-0000000000000000'},
  fetcher:async(_endpoint,options)=>{
   const node=JSON.parse(options.body).nodes[0];requests.push(node)
   let output
   if(node.request.operation==='search')output={status:'completed',result:{urls:[url]}}
   else if(node.request.operation==='inspect')output={status:'completed',result:{url,text:'Official tutorial for beginners.'}}
   else if(node.request.operation==='report')output=denyReport?{status:'denied'}:{status:'completed',report:{citations:[{source:url,excerpt:'Official tutorial.',source_type:'public_web_apoc'},...(extraCitation?[{source:'https://unadmitted.example/',excerpt:'Unadmitted'}]:[])]}}
   else assert.fail('Unexpected tool operation')
   return new Response(JSON.stringify({status:'completed',results:{research:{status:'completed',output}}}))
  },
 })
 return {tools,requests}
}
async function readPage(tools){
 await tools.call('search_public_web',{query:'Python documentation'})
 await tools.call('read_public_page',{url})
}
test('foreground research passes explicit web-only scope through the guarded graph',async()=>{
 const {tools,requests}=fixture();assert.equal(tools.completedEvidence(),null);await readPage(tools)
 const result=JSON.parse(await tools.call('build_research_report',{question:'Where to start?',urls:[url]}))
 assert.equal(requests.at(-1).request.source_scope,'public_web')
 assert.equal(result.status,'completed');assert.equal(result.report.citations[0].source,url)
 assert.deepEqual(tools.definitions,[])
 const snapshot=tools.completedEvidence();snapshot.report.citations[0].source='https://changed.example/'
 assert.equal(tools.completedEvidence().report.citations[0].source,url)
 const before=requests.length
 const fallback=researchEvidenceFallback(tools.completedEvidence())
 assert.match(fallback,/requested synthesis is incomplete/)
 assert.ok(fallback.includes(url));assert.match(fallback,/does not confirm a research memory save/)
 assert.equal(requests.length,before,'Fallback must not replay tools')
 await assert.rejects(tools.call('remember_research',{summary:'Not authorized'}),/Unknown research tool/)
})
test('foreground research still rejects unadmitted citations',async()=>{
 const {tools}=fixture({extraCitation:true});await readPage(tools)
 await assert.rejects(tools.call('build_research_report',{question:'Python',urls:[url]}),/not bound to a source/)
})
test('foreground research does not report a denied worker as completed',async()=>{
 const {tools}=fixture({denyReport:true});await readPage(tools)
 await assert.rejects(tools.call('build_research_report',{question:'Python',urls:[url]}),/no success is confirmed/)
 assert.equal(tools.completedEvidence(),null)
})
test('truncated research fallback requires bounded completed source evidence',()=>{
 for(const evidence of [null,{status:'failed'},{status:'completed',report:{citations:[]}},
  {status:'completed',report:{citations:[{source:'http://localhost/',excerpt:'No'}]}},
  {status:'completed',report:{citations:[{source:url,excerpt:'x'.repeat(281)}]}}])
  assert.equal(researchEvidenceFallback(evidence),null)
})
test('a multi-part request can search up to three times; a fourth search is refused',async()=>{
 const {tools,requests}=fixture()
 const names=()=>tools.definitions.map(tool=>tool.function.name)
 assert.deepEqual(names(),['search_public_web'])
 await tools.call('search_public_web',{query:'RTX 5080 power draw'})
 assert.ok(names().includes('search_public_web'),'a second search stays available after the first')
 await tools.call('search_public_web',{query:'RTX 4080 Super power draw'})
 await tools.call('search_public_web',{query:'third part'})
 assert.equal(names().includes('search_public_web'),false)
 await assert.rejects(tools.call('search_public_web',{query:'fourth'}),/At most 3 web searches/)
 assert.equal(requests.filter(node=>node.request.operation==='search').length,3)
})
