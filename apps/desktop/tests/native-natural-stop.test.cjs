const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const token='event: token\ndata: {"text":"synthetic proposal"}\n\n',done='event: done\ndata: [DONE]\n\n',metric=value=>'event: metrics\ndata: '+value+'\n\n';
async function fixture(file,body,{controller=null}={}){
 const state={calls:[],transport:0,cancelCalls:0},context=vm.createContext({Buffer,TextDecoder,AbortSignal,AbortController,DOMException,setTimeout,clearTimeout});
 const bindings={
  './local-policy.mjs':{localEndpoint:(_key,v,fallback)=>v||fallback,localFetch:async(url,options)=>{state.calls.push({url,signal:options.signal});if(options.signal?.aborted)throw options.signal.reason;state.transport++;if(url.endsWith('/v1/cancel')){state.cancelCalls++;return new Response('cancelled')}if(controller){controller.abort(new Error('synthetic in-flight abort'));return new Response(new ReadableStream({pull(c){c.error(controller.signal.reason)}}),{headers:{'x-nori-request-id':'42'}})}return new Response(body,{headers:{'x-nori-request-id':'42','content-type':'text/event-stream'}})}},
  './son-status-output-guard.mjs':{correctUnsupportedSonStatusClaim:()=>null,needsSonStatusFactCheck:()=>false},
  './file-claim-output-guard.mjs':{correctUnsupportedFileClaim:()=>null},
  './identity-output-guard.mjs':{groundedIdentityAnswer:()=>null},
 };
 const module=new vm.SourceTextModule(fs.readFileSync(path.join(__dirname,file),'utf8'),{context,identifier:file,importModuleDynamically(){throw Error('Unexpected dynamic import')}});
 await module.link(spec=>{assert.ok(Object.hasOwn(bindings,spec),'Unreviewed dependency '+spec);const exports=bindings[spec];return new vm.SyntheticModule(Object.keys(exports),function(){for(const[k,v]of Object.entries(exports))this.setExport(k,v)},{context})});await module.evaluate();
 return {state,async run(options={}){let output='';for await(const part of module.namespace.nativeRuntimeChat({endpoint:'http://127.0.0.1:19999',apiKey:'synthetic-only-no-secret',modelId:'synthetic-only',messages:[],requireNaturalStop:true,...options}))output+=part;return output}};
}
if(!vm.SourceTextModule){test('natural-stop regressions in VM-enabled runner',()=>{const childEnvironment={...process.env};delete childEnvironment.NODE_TEST_CONTEXT;const result=require('node:child_process').spawnSync(process.execPath,['--no-warnings','--experimental-vm-modules','--test','--test-reporter=tap',__filename],{env:childEnvironment,encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:131072});assert.ifError(result.error);assert.equal(result.status,0,result.stdout+'\n'+result.stderr);for(const count of ['tests 12','pass 12','fail 0','skipped 0'])assert.match(result.stdout,new RegExp('^# '+count+'\\s*$','m'))})}else{
for(const file of ['../bridge/native-runtime.mjs']){
 test(file+': explicit natural stop accepted',async()=>{const f=await fixture(file,token+metric('{"finish_reason":"stop"}')+done);assert.equal(await f.run(),'synthetic proposal');assert.equal(f.state.cancelCalls,0)});
 test(file+': unrelated metrics before natural stop accepted',async()=>{const f=await fixture(file,token+metric('{"tokens":12}')+metric('{"finish_reason":"stop"}')+done);assert.equal(await f.run(),'synthetic proposal')});
 for(const [name,metrics,error] of [
  ['missing finish reason','',/did not finish normally/],
  ['output length limit',metric('{"finish_reason":"length"}'),/did not finish normally/],
  ['invalid finish reason',metric('{"finish_reason":"other"}'),/Invalid native finish reason/],
  ['malformed metrics',metric('{bad json'),/JSON|Unexpected|Expected/],
  ['nonobject metrics',metric('[]'),/Invalid native terminal metrics/],
  ['duplicate finish reason',metric('{"finish_reason":"stop"}')+metric('{"finish_reason":"stop"}'),/Invalid native finish reason/],
 ])test(file+': '+name+' rejects completion',async()=>{const f=await fixture(file,token+metrics+done);await assert.rejects(f.run(),error)});
 test(file+': legacy ordinary chat remains compatible without finish metrics',async()=>{const f=await fixture(file,token+done);assert.equal(await f.run({requireNaturalStop:false}),'synthetic proposal')});
 test(file+': malformed option rejects before transport',async()=>{const f=await fixture(file,token+done);await assert.rejects(f.run({requireNaturalStop:'true'}),/must be boolean/);assert.equal(f.state.transport,0)});
 test(file+': pre-aborted request never enters synthetic transport',async()=>{const controller=new AbortController();controller.abort(new Error('synthetic preabort'));const f=await fixture(file,token+done);await assert.rejects(f.run({signal:controller.signal}),/synthetic preabort/);assert.equal(f.state.transport,0);assert.equal(f.state.cancelCalls,0)});
 test(file+': interrupted response cancels only server-issued request',async()=>{const controller=new AbortController(),f=await fixture(file,'',{controller});await assert.rejects(f.run({signal:controller.signal}),/synthetic in-flight abort/);assert.equal(f.state.cancelCalls,1);assert.equal(f.state.calls[1].url,'http://127.0.0.1:19999/v1/cancel');assert.equal(f.state.calls[1].signal.aborted,false)});
}
}
