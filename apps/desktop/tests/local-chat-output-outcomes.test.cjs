const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
// A normal node --test invocation verifies the nested TAP counts explicitly.
if(!vm.SourceTextModule){
 test('all eleven actual-Source output outcome cases execute in a VM-enabled child',t=>{
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const result=require('node:child_process').spawnSync(process.execPath,['--experimental-vm-modules','--test','--test-reporter=tap',__filename],{env,encoding:'utf8',timeout:15000,windowsHide:true,maxBuffer:1024*1024});
  assert.ifError(result.error);assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  for(const summary of ['tests 11','pass 11','fail 0','skipped 0','cancelled 0'])assert.match(result.stdout,new RegExp('^# '+summary+'\\s*$','m'),'All actual child cases must finish: '+result.stdout);
  assert.equal((result.stdout.match(/^ok \d+ - /gm)||[]).length,11);
  t.diagnostic('Verified eleven actual-Source cases:\n'+result.stdout);
 });
}else{
 const {scenario}=require('./helpers/local-chat-outcome-fixture.cjs');
test('no adapter request is distinct and partial text is never published',async()=>{const r=await scenario({rounds:[{}]});assert.equal(r.output,'');assert.equal(r.entered,0);assert.equal(r.error.code,'LOCAL_TOOL_SUMMARY_OUTPUT_LIMIT');assert.match(r.error.message,/this model loop/);assert.equal(r.error.toolOutcome.attempts,0);assert.ok(Object.isFrozen(r.error.toolOutcome))});
test('real codec pre-dispatch scope rejection records zero adapter entries',async()=>{const r=await scenario({intent:'Inspect inside allowed',readOnly:true,rounds:[{call:{args:{path:'other/file.py',max_lines:2}}},{},{}]});assert.equal(r.output,'');assert.equal(r.entered,0);assert.equal(r.error?.code,'LOCAL_TOOL_SUMMARY_OUTPUT_LIMIT',String(r.error?.stack));assert.equal(r.error.toolOutcome.attempts,1);assert.match(r.error.message,/no tool adapter was entered/i)});
test('adapter returns evidence then summary truncates: no execution-success claim or replay',async()=>{const r=await scenario({rounds:[{call:{}},{}],adapter:async()=>JSON.stringify({verified:true,success:true,completed:true})});assert.equal(r.entered,1);assert.equal(r.requests,2);assert.equal(r.output,'');assert.equal(r.error.toolOutcome.returned,1);assert.match(r.error.message,/do not by themselves establish/);assert.doesNotMatch(r.error.message,/successfully|completed the work|nothing.*executed/i)});
test('adapter throws after a simulated effect: preserve uncertainty and no replay',async()=>{let effects=0;const r=await scenario({rounds:[{call:{}},{}],adapter:async()=>{effects++;throw Error('denied after synthetic effect')}});assert.equal(effects,1);assert.equal(r.entered,1);assert.equal(r.error.toolOutcome.threw,1);assert.match(r.error.message,/partial effects may already exist/);assert.equal(r.output,'')});
test('error JSON mimicry cannot create a host-caught failure or prove no execution',async()=>{const r=await scenario({rounds:[{call:{}},{}],adapter:async()=>JSON.stringify({executed:false,error:'synthetic failure'})});assert.equal(r.error.toolOutcome.threw,0);assert.equal(r.error.toolOutcome.boundaryErrors,0);assert.equal(r.error.toolOutcome.returned,1);assert.match(r.error.message,/do not by themselves establish/)});
test('malformed adapter result is a boundary failure after adapter return',async()=>{const r=await scenario({rounds:[{call:{}},{}],adapter:async()=>'{broken'});assert.equal(r.error.toolOutcome.returned,1);assert.equal(r.error.toolOutcome.boundaryErrors,1);assert.match(r.error.message,/boundary failure/);assert.equal(r.entered,1)});
test('failed read can recover through a distinct valid read, without replaying rejected path',async()=>{let reads=[];const r=await scenario({readOnly:true,rounds:[{call:{args:{path:'bad.py',max_lines:2}}},{call:{args:{path:'safe.py',max_lines:2}}},{text:'The second bounded read returned source; tests remain unchecked.',finish:'stop'}],adapter:async(_name,args)=>{reads.push(args.path);if(args.path==='bad.py')throw Error('synthetic read denial');return JSON.stringify({path:'safe.py',start_line:1,content:'x=1',omitted:false})}});assert.equal(r.error,undefined);assert.equal(reads.join(','),'bad.py,safe.py',String(r.error?.stack));assert.match(r.output,/second bounded read/);assert.equal(r.requests,3)});
test('Source does not invent the installed-only summary-retry path',async()=>{const r=await scenario({readOnly:true,rounds:[{call:{}},{}]});assert.equal(r.error.code,'LOCAL_TOOL_SUMMARY_OUTPUT_LIMIT');assert.equal(r.entered,1);assert.equal(r.requests,2);assert.equal(r.output,'');assert.equal(r.payloads[2],undefined)});
test('pre-aborted turn performs no fetch or adapter request',async()=>{const controller=new AbortController();controller.abort();const r=await scenario({rounds:[],signal:controller});assert.equal(r.requests,0);assert.equal(r.entered,0);assert.equal(r.error.name,'AbortError');assert.equal(r.output,'')});
test('abort after SSE prevents dispatch even if synthetic fetch ignores signal',async()=>{const r=await scenario({rounds:[{call:{}}],abortAt:1});assert.equal(r.entered,0);assert.equal(r.output,'');assert.equal(r.error.name,'AbortError')});
test('abort during adapter wait suppresses late success/summary, without undo claims',async()=>{const controller=new AbortController();const r=await scenario({signal:controller,rounds:[{call:{}}],adapter:async()=>{controller.abort();return JSON.stringify({success:true})}});assert.equal(r.entered,1);assert.equal(r.requests,1);assert.equal(r.output,'');assert.equal(r.error.name,'AbortError')});






}

