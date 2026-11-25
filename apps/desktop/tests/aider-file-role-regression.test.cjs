const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{randomUUID}=require('node:crypto'),{promisify}=require('node:util');
// Read the authoritative modules on every run. Only their declared imports are faked.
// No model, worker process, real filesystem adapter or network transport is exposed.
if (!vm.SourceTextModule) {
 test('file-role regressions in an isolated VM-enabled test runner',t=>{
  const childEnvironment={...process.env};
  delete childEnvironment.NODE_TEST_CONTEXT;
  const result=require('node:child_process').spawnSync(process.execPath,
   ['--experimental-vm-modules','--test','--test-reporter=tap',__filename],
   {env:childEnvironment,encoding:'utf8',timeout:30000,windowsHide:true,maxBuffer:1024*1024});
  assert.ifError(result.error);assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  for(const summary of ['tests 23','pass 23','fail 0','skipped 0']) {
   assert.match(result.stdout,new RegExp('^# '+summary+'\\s*$','m'),
    'The child must actually execute all file-role cases: '+result.stdout);
  }
  assert.equal((result.stdout.match(/^ok \d+ - /gm)||[]).length,23);
  t.diagnostic('Verified child TAP output:\n'+result.stdout);
 });
} else {
async function loadPureProjectReadIntent(context, file) {
 const text = fs.readFileSync(file, 'utf8')
 assert.doesNotMatch(text, /\bimport\s*\(/, 'Pure project intent cannot gain dynamic imports')
 const module = new vm.SourceTextModule(text, { context, identifier: file,
  importModuleDynamically() { throw Error('Pure project intent dynamic dependency refused') } })
 await module.link(spec => { throw Error('Pure project intent static dependency refused: ' + spec) })
 return module
}
async function fixture({request,model='qwen3.5-9b',flags={}}={}){
 const code=fs.readFileSync(path.join(__dirname,'../bridge/aider-tools.mjs'),'utf8'),worker=fs.readFileSync(path.join(__dirname,'../bridge/worker-submit.mjs'),'utf8');
 const state={admissions:[],forbidden:0},suite='C:\\Synthetic\\Suite',workspace='C:\\Synthetic\\Project';
 const deny=()=>{state.forbidden++;throw Error('REAL PROCESS/PRIVATE FILE/NETWORK EFFECT FORBIDDEN')};
 const env={NORI_GPT_OSS_SERVER_MODEL:model,NORI_AIDER_WORKSPACE_ROOT:workspace,NORI_COUNCIL_URL:'http://127.0.0.1:19998',NORI_API_TOKEN:'synthetic-authentication-only-value-000000000000000',...flags};
 const context=vm.createContext({Buffer,URL,Response,AbortSignal,AbortController,process:{env,platform:'win32'}});
 const values={spawn:deny,execFile:deny,promisify,randomUUID,isAbsolute:path.win32.isAbsolute,join:path.win32.join,resolve:path.win32.resolve,existsSync:p=>{assert.ok(p.startsWith(suite)||p===workspace);return true},realpathSync:p=>p,statSync:p=>({isDirectory:()=>p===workspace,isFile:()=>p!==workspace}),createNoriProjectTools:()=>({definitions:[],call:deny,close(){}}),installationPaths:()=>({noriRoot:suite}),createAiderWorkerReceiptValidator:()=>()=>true,userCreativeRoutingText:x=>x,requestsNoriArtCraftOperation:()=>false,isSelfCodeRequest:()=>false,prepareSelfCodeWorkspace:deny,readFileSync:deny,fileURLToPath:deny,localEndpoint:(_key,v,fallback)=>v||fallback,localFetch:async(url,options)=>{assert.equal(url,'http://127.0.0.1:19998/work/worker');assert.equal(options.method,'POST');const body=JSON.parse(options.body);state.admissions.push(body);return Response.json({task_id:body.task_id,status:'awaiting_approval'})}};
 const modules=new Map();async function build(name,text){const m=new vm.SourceTextModule(text,{context,identifier:name,initializeImportMeta(meta){meta.url='file:///C:/Synthetic/'+name}});const specs=new Map([...text.matchAll(/^import \{([^}]+)\} from ['\"]([^'\"]+)['\"]/gm)].map(m=>[m[2],m[1].split(',').map(s=>s.trim())]));await m.link(async spec=>{if(spec==='./coding-followup-context.mjs'){assert.deepEqual(specs.get(spec),['codingActionText','priorCodeGenerationRequest']);if(!modules.has(spec))modules.set(spec,loadPureProjectReadIntent(context,path.join(__dirname,'../bridge/coding-followup-context.mjs')));return modules.get(spec)}if(spec==='./project-read-intent.mjs'){assert.deepEqual(specs.get(spec),['requestsReadOnlyProjectReview']);if(!modules.has(spec))modules.set(spec,loadPureProjectReadIntent(context,path.join(__dirname,'../bridge/project-read-intent.mjs')));return modules.get(spec)}if(spec==='./worker-submit.mjs'){if(!modules.has(spec))modules.set(spec,build('worker-submit.mjs',worker));return modules.get(spec)}const names=specs.get(spec);if(!names)throw Error('Unexpected module');return new vm.SyntheticModule(names,function(){for(const key of names){if(!Object.hasOwn(values,key))throw Error('Missing declared fake '+spec+':'+key);this.setExport(key,values[key])}},{context})});return m}
 const module=await build('aider-tools.mjs',code);await module.evaluate();const tools=module.namespace.createNoriAiderTools({userRequest:request,apiBase:'http://127.0.0.1:19999/v1',environment:env,suiteRoot:suite});return{state,tools};
}
const READ=['test_calculator.py','test_add.py','test_subtract.py'];
const TASK='Use local Aider to implement subtract in calculator.py. Edit only calculator.py. Read test_calculator.py, test_add.py, and test_subtract.py without changing them.';
test('exact Source task rejects broad editable proposal before real Source admission',async()=>{const f=await fixture({request:TASK});await assert.rejects(f.tools.call('aider_code_task',{allowed_files:['calculator.py',...READ]}),/only the exact/);assert.equal(f.state.admissions.length,0);assert.equal(f.state.forbidden,0)});
test('exact Source task binds owner readonly context and stays awaiting approval',async()=>{const f=await fixture({request:TASK}),reply=JSON.parse(await f.tools.call('aider_code_task',{allowed_files:['calculator.py'],context_files:[]}));assert.equal(reply.status,'awaiting_approval');assert.equal(reply.completed,false);assert.deepEqual(f.state.admissions[0].allowed_files,['calculator.py']);assert.deepEqual(f.state.admissions[0].context_files,READ);assert.equal(f.state.forbidden,0)});
test('Source role schema keeps readonly files out of editable enumeration',async()=>{const f=await fixture({request:TASK}),props=f.tools.definitions[0].function.parameters.properties;assert.deepEqual(JSON.parse(JSON.stringify(props.allowed_files.items.enum)),['calculator.py']);assert.deepEqual(JSON.parse(JSON.stringify(props.context_files.items.enum)),READ)});
for(const restriction of ['Only edit calculator.py.','Edit only calculator.py.','Please modify only calculator.py.','Only update calculator.py.'])test('equivalent Source editable restriction: '+restriction,async()=>{const f=await fixture({request:'Use local Aider to fix the project. '+restriction});await assert.rejects(f.tools.call('aider_code_task',{allowed_files:['test_add.py']}),/only the exact/);assert.equal(f.state.admissions.length,0)});
test('model cannot expand bound read-only context',async()=>{const f=await fixture({request:TASK});await assert.rejects(f.tools.call('aider_code_task',{allowed_files:['calculator.py'],context_files:['secrets.py']}),/cannot expand/);assert.equal(f.state.admissions.length,0)});
test('read-only file cannot be editable without a single-edit declaration',async()=>{const f=await fixture({request:'Use local Aider to fix the project. Read test_add.py without changing it.'});await assert.rejects(f.tools.call('aider_code_task',{allowed_files:['test_add.py']}),/read-only/);assert.equal(f.state.admissions.length,0)});
for(const suffix of ['Edit only calculator.py and test_add.py.','Edit only calculator.py. Edit only test_add.py.','Read calculator.py without changing it. Edit only calculator.py.'])test('conflict refuses Source task construction: '+suffix,async()=>{await assert.rejects(fixture({request:'Use local Aider to fix the project. '+suffix}),/unclear|conflicting|both editable/)});
test('historical comma before but-do-not-edit is accepted safely',async()=>{const f=await fixture({request:'Use local Aider to fix calculator.py. Edit only calculator.py. Read test_calculator.py, but do not change it.'});await f.tools.call('aider_code_task',{allowed_files:['calculator.py']});assert.deepEqual(f.state.admissions[0].context_files,['test_calculator.py'])});
for(const list of ['test_calculator.py,, test_add.py','test_calculator.py,,'])test('empty context list components refuse: '+list,async()=>{await assert.rejects(fixture({request:'Use local Aider to fix calculator.py. Edit only calculator.py. Read '+list+' without changing them.'}),/read-only context files/)});
test('quoted directives are context, not owner file-role authority',async()=>{const f=await fixture({request:'Use local Aider to fix the project. The example says "Edit only test_add.py."'});await f.tools.call('aider_code_task',{allowed_files:['calculator.py']});assert.deepEqual(f.state.admissions[0].allowed_files,['calculator.py']);assert.equal(f.state.forbidden,0)});
for(const model of ['qwen3.5-9b','qwen3.8-27b','nori-auto','gpt-oss-20b'])test('all Source model bindings preserve Core review even inherited approval flags: '+model,async()=>{const f=await fixture({request:TASK,model,flags:{NORI_AIDER_BACKGROUND:'0',NORI_AIDER_TASK_APPROVED:'1',NORI_AIDER_CAPABILITY_APPROVED:'1'}}),out=JSON.parse(await f.tools.call('aider_code_task',{allowed_files:['calculator.py']}));assert.equal(out.status,'awaiting_approval');assert.equal(out.completed,false);assert.equal(f.state.forbidden,0);assert.equal(f.state.admissions.length,1)});
test('generic bounded multi-file request remains pending review, not worker spawn',async()=>{const f=await fixture({request:'Use local Aider to fix the selected project.'}),out=JSON.parse(await f.tools.call('aider_code_task',{allowed_files:['calculator.py','other.py'],context_files:['test_add.py']}));assert.equal(out.status,'awaiting_approval');assert.equal(f.state.forbidden,0)});

test('Windows readonly case alias cannot become editable',async()=>{const f=await fixture({request:'Use local Aider to fix calculator.py. Read test_add.py without changing it.'});await assert.rejects(f.tools.call('aider_code_task',{allowed_files:['TEST_ADD.PY']}),/disjoint/);assert.equal(f.state.admissions.length,0);assert.equal(f.state.forbidden,0)});
test('Windows case alias rejects conflicting owner roles before submission',async()=>{await assert.rejects(fixture({request:'Use local Aider to fix the project. Edit only calculator.py. Read CALCULATOR.PY without changing it.'}),/both editable/)});

}
