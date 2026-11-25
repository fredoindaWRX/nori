const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');

if(!vm.SourceTextModule){
 test('all three public context regressions actually execute in the isolated child',t=>{
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const result=require('node:child_process').spawnSync(process.execPath,
   ['--experimental-vm-modules','--test','--test-reporter=tap',__filename],
   {env,encoding:'utf8',timeout:15000,windowsHide:true,maxBuffer:1024*1024});
  assert.ifError(result.error);assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  for(const summary of ['tests 3','pass 3','fail 0','skipped 0'])
   assert.match(result.stdout,new RegExp('^# '+summary+'\\s*$','m'));
  assert.equal((result.stdout.match(/^ok \d+ - /gm)||[]).length,3);
  t.diagnostic(result.stdout);
 });
}else{
 const {contextFixture}=require('./helpers/local-chat-context-fixture.cjs');
 function bounded(payload){
  const wireBytes=Buffer.byteLength(JSON.stringify(payload),'utf8');
  assert.ok(wireBytes+128+payload.max_tokens<=65536,
   `Conservative full-wire bound: ${wireBytes}+128+${payload.max_tokens}>65536`);
  assert.ok(payload.max_tokens>=64);
 }
 test('public late-context request preserves complete UTF-8 user text after small-context import',async()=>{
  const fixture=await contextFixture({configured:'4096'});
  fixture.env.NORI_GPT_OSS_CONTEXT_TOKENS='65536';
  const goal='Current request, preserve its exact characters: '+ 'ñ\\"'.repeat(6000);
  assert.ok(Buffer.byteLength(goal)>8192);
  assert.equal(await fixture.run(goal,{projectToolsRequested:false,profile:'balanced',learned:'optional historical context '.repeat(3000)}),'CONTEXT_OK');
  assert.equal(fixture.requests.length,1);
  assert.equal(fixture.requests[0].messages.at(-1).content,goal);
  bounded(fixture.requests[0]);assert.equal(fixture.forbidden,0);
 });
 test('public nested schema and observed tool result remain within one captured 64K request',async()=>{
  let fixture,dispatches=0;
  const definitions=[{type:'function',function:{name:'check_pc',parameters:{type:'object',properties:{
   topic:{type:'string',enum:['apps']},
   details:{type:'object',properties:{items:{type:'array',items:{type:'object',properties:{
    description:{type:'string',description:'Nested schema UTF-8 and escaped content: '+ 'ñ\\"'.repeat(2800)},
   },additionalProperties:false}}},additionalProperties:false},
  },required:['topic'],additionalProperties:false}}}];
  const tools={definitions,async call(name,args,limits){
   assert.equal(this,tools);assert.equal(name,'check_pc');assert.equal(args.topic,'apps');
   assert.ok(limits.maxBytes>0&&limits.maxBytes<=8192);dispatches++;
   fixture.env.NORI_GPT_OSS_CONTEXT_TOKENS='4096';
   return JSON.stringify({observation:'SYNTHETIC ONLY: '+ 'ñ\\"'.repeat(400)});
  }};
  fixture=await contextFixture({configured:'65536',tools,rounds:[
   {call:{name:'check_pc',args:{topic:'apps'}}},{text:'PUBLIC_CONTEXT_OBSERVATION_OK'},
  ]});
  const goal='Current bounded request '+ 'q'.repeat(26000);
  assert.equal(await fixture.run(goal,{projectToolsRequested:true,profile:'balanced'}),'PUBLIC_CONTEXT_OBSERVATION_OK');
  assert.equal(dispatches,1);assert.equal(fixture.requests.length,2);
  for(const payload of fixture.requests){
   assert.deepEqual(payload.tools,definitions);
   assert.ok(payload.messages.some(message=>message.role==='user'&&message.content===goal));
   bounded(payload);
  }
  assert.ok(fixture.requests[1].messages.some(message=>message.role==='tool'&&message.content.includes('SYNTHETIC ONLY')));
  assert.equal(fixture.forbidden,0);
 });
 test('near-window first and follow-up retain full wire envelope and output reserve',async()=>{
  let dispatches=0;
  const definitions=[{type:'function',function:{name:'check_pc',description:'d'.repeat(1000),
   parameters:{type:'object',properties:{topic:{type:'string'}},required:['topic'],additionalProperties:false}}}];
  const tools={definitions,async call(name,args){
   assert.equal(name,'check_pc');assert.equal(args.topic,'apps');dispatches++;
   return JSON.stringify({path:'safe.py',content:'x=1'});
  }};
  const fixture=await contextFixture({configured:'65536',tools,rounds:[
   {call:{name:'check_pc',args:{topic:'apps'}}},{text:'READ_RETURNED'},
  ]});
  fixture.env.NORI_GPT_OSS_SERVER_MODEL='m'.repeat(128);
  const goal='Required owner request '+'x'.repeat(61000);
  assert.equal(await fixture.run(goal,{projectToolsRequested:true,profile:'deep'}),'READ_RETURNED');
  assert.equal(dispatches,1);assert.equal(fixture.requests.length,2);
  for(const payload of fixture.requests){
   assert.equal(payload.model,'m'.repeat(128));
   assert.deepEqual(payload.tools,definitions);
   assert.ok(payload.messages.some(message=>message.role==='user'&&message.content===goal));
   assert.ok(payload.max_tokens>=64&&payload.max_tokens<=2048);
   bounded(payload);
  }
  assert.equal(fixture.forbidden,0);
 });
}
