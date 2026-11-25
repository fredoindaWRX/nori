import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseToolIntent, chooserContext, referentialFollowUp } from '../bridge/tool-intent.mjs'
const environment={NORI_GPT_OSS_ENABLED:'1',NORI_GPT_OSS_URL:'http://127.0.0.1:1'}
const response=(name,finish_reason='tool_calls',args='{"reason":"task"}')=>new Response(JSON.stringify({choices:[{finish_reason,message:{tool_calls:[{function:{name,arguments:args}}]}}]}))
test('chooser distinguishes conversation, specialists and multi-step work',async()=>{
 for(const [name,result] of [['answer_directly',null],['multi_step','agent'],['project_files','project'],['create_document','documents'],['control_browser','browser']]){
  assert.equal(await chooseToolIntent('fixture request',{environment,fetcher:async()=>response(name)}),result)
 }
})
test('truncated malformed and unavailable chooser responses retain the base catalog',async()=>{
 for(const fetcher of [async()=>response('create_document','length'),async()=>response('create_document','tool_calls','{'),async()=>new Response('',{status:503}),async()=>{throw Error('offline')}]){
  assert.equal(await chooseToolIntent('fixture request',{environment,fetcher}),'base')
 }
})
test('follow-up context stays bounded and does not route unrelated conversation',()=>{
 const turns=[{role:'user',text:'Find notes'},{role:'assistant',text:'Found example.txt '+ 'x'.repeat(5000)}]
 assert.ok(chooserContext(turns).length<1100)
 assert.equal(referentialFollowUp('open the first file',turns),true)
 assert.equal(referentialFollowUp('good evening',turns),false)
})
