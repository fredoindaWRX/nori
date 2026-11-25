const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),ts=require('typescript');
const desktop=path.resolve(__dirname,'../desktop'),load=createRequire(path.join(desktop,'main.cjs'));
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'nori-worker-wiring-'))),project=path.join(root,'project');fs.mkdirSync(path.join(project,'.git'),{recursive:true});
 t.after(()=>{const rel=path.relative(os.tmpdir(),root);assert.ok(!rel.startsWith('..')&&!path.isAbsolute(rel)&&path.basename(root).startsWith('nori-worker-wiring-'));fs.rmSync(root,{recursive:true,force:true});});
 const handlers=new Map(),events=new Map(),exposed={},requests=[],messages=[],key='1'.repeat(64),binding='2'.repeat(64),taskId='3'.repeat(32),frame={};
 const window={webContents:{mainFrame:frame}},owner={sender:window.webContents,senderFrame:frame};
 const core={workerApprovalKey:key,environment:{NORI_COUNCIL_URL:'http://127.0.0.1:19977',NORI_API_TOKEN:'synthetic-test-only'}};
 const fetcher=async(url,options={})=>{
  requests.push({url,method:options.method||'GET',body:options.body});
  if(url.endsWith('/work/worker/project')){assert.equal(options.headers['X-Nori-Worker-Approval'],key);assert.equal(JSON.parse(options.body).workspace,project);return Response.json({workspace:project,restartRequired:false});}
  if(url.endsWith('/work/'+taskId))return Response.json({task_id:taskId,status:'awaiting_approval',goal:'Edit calculator.py only',review:{binding,attempt:1,editable_files:[path.join(project,'calculator.py')],context_files:[]}});
  throw Error('Unexpected fixture request; no network dispatch permitted');
 };
 const requireModule=name=>{
  if(name==='./computer-host.cjs')return{createComputerHost:()=>({capabilities:async()=>({capabilities:[]})})};
  if(name==='./browser-host.cjs')return{createBrowserHost:()=>({})};
  if(name==='./artifact-reveal.cjs')return{revealArtCraftArtifact:()=>()=>null};
  if(name==='./worker-confirmation.cjs')return{createWorkerConfirmation:options=>load(name).createWorkerConfirmation({...options,fetcher})};
  return load(name);
 };
 const ipcMain={handle:(name,fn)=>{assert.ok(!handlers.has(name));handlers.set(name,fn);},on:(name,fn)=>events.set(name,fn)};
 const context={require:requireModule,window,ipcMain,USER_DATA_ROOT:path.join(root,'state'),SUITE_ROOT:root,process:{env:{}},PROBE_SESSION:false,isQuitting:false,gptOssCore:core,nativeService:null,
  nativeCoreEndpoint:()=>core.environment.NORI_COUNCIL_URL,fetch:fetcher,AbortSignal,bridge:{send:value=>messages.push(value)},
  dialog:{showOpenDialog:async()=>({canceled:false,filePaths:[project]}),showMessageBox:async()=>({response:0})},
  computerHost:null,browserHost:null,remoteControlOrigin:null,createWorkspaceProjectReader:()=>({}),createWorkspaceAppDrafts:()=>({}),createWakeWindow:()=>()=>null,rendererConnection:()=>null,
  screen:{on:()=>{}},showNori:()=>{},BRIDGE_PORT:15188,HAND_INPUT_PORT:19393,wakeActivation:{consume:()=>false},setTimeout,clearTimeout};
 const source=ts.createSourceFile('main.cjs',fs.readFileSync(path.join(desktop,'main.cjs'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const fn=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='configureWorkspace');assert.ok(fn);
 vm.runInNewContext(fn.getText(source)+'\nconfigureWorkspace();',context);
 const ipcRenderer={invoke:async(name,...args)=>{assert.ok(handlers.has(name),'Missing host handler '+name);return handlers.get(name)(owner,...args);},sendSync:name=>{events.get(name)(owner);return owner.returnValue;},on:()=>{},removeListener:()=>{}};
 vm.runInNewContext(fs.readFileSync(path.join(desktop,'workspace-preload.cjs'),'utf8'),{require:name=>{assert.equal(name,'electron');return{contextBridge:{exposeInMainWorld:(name,api)=>{exposed[name]=api;}},ipcRenderer};}});
 return{root,project,requests,messages,exposed,taskId,handlers};
}
test('renderer project selection reaches Core and activates without restart or edit authority',async t=>{
 const f=fixture(t);assert.equal(typeof f.exposed.noriWorkerWorkspace.select,'function');const result=await f.exposed.noriWorkerWorkspace.select();
 assert.equal(result.workspace,f.project);assert.equal(result.restartRequired,false);assert.equal(result.approvalGranted,false);
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].method,'POST');assert.ok(f.requests[0].url.endsWith('/work/worker/project'));
 assert.equal(f.messages.length,1);assert.equal(f.messages[0].kind,'nori-worker-project');assert.equal(f.messages[0].workspace,f.project);
 assert.equal((await f.exposed.noriWorkerWorkspace.read()).workspace,f.project);
 assert.equal(typeof f.exposed.noriComputer.capabilities,'function');assert.ok(f.handlers.has('nori:computer:capabilities'));
});
test('renderer task confirmation still requires the review dialog and cancellation never dispatches',async t=>{
 const f=fixture(t);const result=await f.exposed.noriWorkerWorkspace.confirm(f.taskId);assert.equal(result.confirmed,false);
 assert.equal(f.requests.length,1);assert.equal(f.requests[0].method,'GET');assert.ok(f.requests[0].url.endsWith('/work/'+f.taskId));
 assert.equal(f.requests.some(request=>request.url.endsWith('/confirm')),false);
});
