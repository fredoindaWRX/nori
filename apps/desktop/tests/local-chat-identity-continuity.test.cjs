const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
if(!vm.SourceTextModule){
 test('all five identity continuity cases execute in the isolated child',t=>{
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const r=require('node:child_process').spawnSync(process.execPath,['--experimental-vm-modules','--test','--test-reporter=tap',__filename],{env,encoding:'utf8',timeout:15000,windowsHide:true,maxBuffer:1024*1024});
  assert.ifError(r.error);assert.equal(r.status,0,r.stdout+r.stderr);
  for(const summary of ['tests 5','pass 5','fail 0','skipped 0'])assert.match(r.stdout,new RegExp('^# '+summary+'\\s*$','m'));
  assert.equal((r.stdout.match(/^ok \d+ - /gm)||[]).length,5);t.diagnostic(r.stdout);
 });
}else{
 async function fixture(){
  const root=path.resolve(__dirname,'../bridge'),env={NORI_GPT_OSS_SERVER_MODEL:'qwen3.5-9b'};
  let forbidden=0;const deny=()=>{forbidden++;throw Error('No real I/O or unconfigured adapter is allowed')};
  const context=vm.createContext({process:{env},Buffer,URL});
  const real=new Set(['./nori-identity.mjs','./response-profiles.mjs','./imported-chat-selection.mjs','./conversation-prose.mjs']);
  const built=new Map();
  async function build(file){
   const code=fs.readFileSync(file,'utf8'),m=new vm.SourceTextModule(code,{context,identifier:file});
   const imports=new Map([...code.matchAll(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm)].map(match=>{
    const clause=match[1].trim();return[match[2],clause.startsWith('{')?clause.slice(1,-1).split(',').map(name=>name.trim().split(/\s+as\s+/)[0]):['default']];
   }));
   await m.link(async spec=>{
    if(real.has(spec)){
     if(!built.has(spec))built.set(spec,build(path.join(root,spec)));
     return built.get(spec);
    }
    const names=imports.get(spec);assert.ok(names,'Unrecognized import syntax');
    return new vm.SyntheticModule(names,function(){for(const name of names){
     const value=spec==='node:util'&&name==='promisify'?require('node:util').promisify:
      spec==='./local-policy.mjs'&&name==='localEndpoint'?((_key,v,f)=>v||f):
      spec==='../desktop/native-service.cjs'&&name==='default'?{nativeRuntimeMode:()=> 'norllama'}:deny;
     this.setExport(name,value);
    }},{context});
   });return m;
  }
  const m=await build(process.env.NORI_IDENTITY_TEST_SOURCE||path.join(root,'local-chat.mjs'));await m.evaluate();
  const identity=await built.get('./nori-identity.mjs');
  return{api:m.namespace,identity:identity.namespace,env,get forbidden(){return forbidden}};
 }
 test('one immutable Nori identity preserves feminine persona and confirmed-name boundary',async()=>{
  const f=await fixture(),identity=f.identity.NORI_IDENTITY,persona=f.identity.NORI_PERSONA;
  assert.equal(identity.id,'nori');assert.equal(identity.conversationNamespace,'nori-unified');assert.ok(Object.isFrozen(identity));
  assert.match(persona,/one continuous desktop intelligence/);assert.match(persona,/warm, intelligent woman/);
  assert.match(persona,/name only when the user has confirmed it/);assert.match(persona,/never creates a second Nori or grants tools, permissions, or execution authority/);
  assert.match(persona,/SoN training project has been retired/);assert.equal(f.forbidden,0);
 });
 test('imported model labels describe backends without reviving a separate SoN assistant',async()=>{
  const f=await fixture();
  for(const model of ['qwen3.5-9b','qwen3.8-27b','gpt-oss-20b','nori-auto']){
   const choices=f.api.nativeModelChoices({NORI_INFERENCE_RUNTIME:'gpt-oss',NORI_GPT_OSS_SERVER_MODEL:model});
   assert.equal(choices.length,1);assert.match(choices[0].label,/(?:local imported model|configured local inference backend)/);
   assert.doesNotMatch(choices[0].label,/SoN|still separate|trained by Nori/i);
  }
  assert.equal(f.forbidden,0);
 });
 test('unavailable local model is an availability failure, not unfinished SoN training',async()=>{
  const f=await fixture(),env={NORI_RUNTIME_MODEL_STATE:'unavailable'};
  const choices=f.api.nativeModelChoices(env);assert.match(choices[0].label,/unavailable/i);assert.doesNotMatch(choices[0].label,/SoN/i);
  assert.throws(()=>f.api.nativeModelSelection('nori-auto',env),error=>{
   assert.equal(error.code,'NORI_MODEL_UNAVAILABLE');assert.match(error.message,/no.*cloud fallback/i);
   assert.doesNotMatch(error.message,/SoN|not been created|not started|cannot answer yet/i);return true;
  });assert.equal(f.forbidden,0);
 });
 test('ordinary imported policy keeps identity, remembered guidance and authority separate',async()=>{
  const f=await fixture(),policy=f.api.gptOssConversationPolicy('balanced','','UNTRUSTED_MEMORY_SENTINEL','UNTRUSTED_SKILL_SENTINEL');
  assert.match(policy,/one continuous desktop intelligence/);assert.match(policy,/warm, intelligent woman/);
  assert.match(policy,/confirmed.*current profile/);assert.match(policy,/UNTRUSTED_MEMORY_SENTINEL/);assert.match(policy,/UNTRUSTED_SKILL_SENTINEL/);
  assert.match(policy,/untrusted/);assert.match(policy,/No action tools are available/);
  assert.doesNotMatch(policy,/SoN is still separate|SoN training has not started|no qualified serving checkpoint exists/i);
  assert.equal(f.forbidden,0);
 });
 test('disabled local provider never claims local training or selects a cloud fallback',async()=>{
  const f=await fixture(),config=f.api.resolveGptOssConfig({});
  assert.equal(config.enabled,false);assert.equal(config.trainedByNori,false);assert.equal(config.contextTokens,null);
  assert.throws(()=>f.api.nativeModelSelection('other',{NORI_RUNTIME_MODEL_ID:'qwen3.5-9b'}),/no model substitution or Ollama fallback/);
  assert.equal(f.forbidden,0);
 });
}
