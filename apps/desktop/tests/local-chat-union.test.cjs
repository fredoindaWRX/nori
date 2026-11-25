const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
if(!vm.SourceTextModule){
 test('public union chat cases execute in isolated VM child',()=>{
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const result=require('node:child_process').spawnSync(process.execPath,['--experimental-vm-modules','--test','--test-reporter=tap',__filename],{env,encoding:'utf8',timeout:15000,windowsHide:true});
  assert.equal(result.status,0,result.stdout+result.stderr);
  assert.match(result.stdout,/# pass 5\s/);assert.match(result.stdout,/# fail 0\s/);
 });
}else{
 const {contextFixture}=require('./helpers/local-chat-context-fixture.cjs');
 const empty=()=>({definitions:[],call(){assert.fail('unoffered tool')}});
 function factories(call){return {research:empty,files:empty,project:empty,paths:()=>({noriRoot:'C:/synthetic'}),pc:()=>({
  definitions:[{type:'function',function:{name:'check_pc',parameters:{type:'object',properties:{},additionalProperties:false}}}],call,
 })}}
 test('ordinary public chat receives catalog but makes no tool call',async()=>{
  const f=await contextFixture({configured:'65536',agentFactories:factories(()=>assert.fail('unexpected call')),rounds:[{text:'Hello Will.'}]});
  assert.equal(await f.run('Good evening',{projectToolsRequested:null}),'Hello Will.');
  assert.equal(f.requests.length,1);assert.equal(f.requests[0].tools[0].function.name,'check_pc');
  assert.match(f.requests[0].messages[0].content,/current tool definitions/);
 });
 test('public chat dispatches through real union and codec then reports model response',async()=>{
  let calls=0;
  const f=await contextFixture({configured:'65536',agentFactories:factories(async()=>{calls++;return JSON.stringify({available:true,source:'fixture'})}),
   rounds:[{call:{name:'check_pc',args:{}}},{text:'The status check returned fixture evidence.'}]});
  assert.equal(await f.run('Tell me the current status',{projectToolsRequested:null}),'The status check returned fixture evidence.');
  assert.equal(calls,1);assert.equal(f.requests.length,2);
  assert.ok(f.requests[1].messages.some(x=>x.role==='tool'&&x.content.includes('fixture')));
 });
 test('public union chat rejects late model reply after cancellation',async()=>{
  const controller=new AbortController();
  const f=await contextFixture({configured:'65536',agentFactories:factories(()=>assert.fail('late call')),onFetch:()=>controller.abort(),rounds:[{text:'Late reply'}]});
  await assert.rejects(f.run('Good evening',{projectToolsRequested:null,signal:controller.signal}),{name:'AbortError'});
 });
 test('personal-file result withdraws public search and rejects a subsequent attempted search',async()=>{
  let reads=0, searches=0;
  const definition=name=>({type:'function',function:{name,parameters:{type:'object',properties:{},additionalProperties:false}}});
  const adapters=factories(()=>assert.fail('unexpected PC call'));
  adapters.files=()=>({definitions:[definition('read_my_file')],call:async()=>{reads++;return JSON.stringify({content:'SYNTHETIC_PRIVATE_MARKER'})}});
  adapters.research=()=>({definitions:[definition('search_public_web')],call:async()=>{searches++;return '{}'}});
  const f=await contextFixture({configured:'65536',agentFactories:adapters,rounds:[
   {call:{name:'read_my_file',args:{}}},{call:{name:'search_public_web',args:{}}},{text:'I can answer from the local result; no public search ran.'},
  ]});
  assert.match(await f.run('Help with this task',{projectToolsRequested:null}),/no public search ran/);
  assert.equal(reads,1);assert.equal(searches,0);
  assert.ok(f.requests[0].tools.some(x=>x.function.name==='search_public_web'));
  assert.ok(!f.requests[1].tools.some(x=>x.function.name==='search_public_web'));
  assert.ok(f.requests[2].messages.some(x=>x.role==='tool'&&/public web search is off/.test(x.content)));
 });
 test('denied file read permits recovery through public search without claiming a read succeeded',async()=>{
  let searches=0;
  const definition=name=>({type:'function',function:{name,parameters:{type:'object',properties:{},additionalProperties:false}}});
  const adapters=factories(()=>assert.fail('unexpected PC call'));
  adapters.files=()=>({definitions:[definition('read_my_file')],call:async()=>{throw Error('fixture permission denied')}});
  adapters.research=()=>({definitions:[definition('search_public_web')],call:async()=>{searches++;return JSON.stringify({source:'public fixture'})}});
  const f=await contextFixture({configured:'65536',agentFactories:adapters,rounds:[
   {call:{name:'read_my_file',args:{}}},{call:{name:'search_public_web',args:{}}},{text:'The file read was denied; the public lookup returned a result.'},
  ]});
  assert.match(await f.run('Help with this task',{projectToolsRequested:null}),/file read was denied/);
  assert.equal(searches,1);
  assert.ok(f.requests[1].tools.some(x=>x.function.name==='search_public_web'));
  assert.ok(f.requests[1].messages.some(x=>x.role==='tool'&&/permission denied/.test(x.content)));
 });
}
