const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {createWorkerWorkspace}=require('../desktop/worker-workspace.cjs');
const {installMediaPermissionHandlers}=require('../desktop/media-permission-policy.cjs');
function fixture(t){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'nori-restored-contract-')));t.after(()=>{const delta=path.relative(os.tmpdir(),root);assert.ok(!path.isAbsolute(delta)&&!delta.startsWith('..')&&path.basename(root).startsWith('nori-restored-contract-'));fs.rmSync(root,{recursive:true,force:true});});for(const name of ['first','second'])fs.mkdirSync(path.join(root,name,'.git'),{recursive:true});return root;}
test('project activation switches without restart and never grants edit approval',async t=>{
 const root=fixture(t),first=path.join(root,'first'),second=path.join(root,'second'),event={};let selected=first;const activated=[];
 const manager=createWorkerWorkspace({dataRoot:path.join(root,'state'),owns:e=>e===event,choose:async()=>selected,activate:async workspace=>{activated.push(workspace);return{workspace,restartRequired:false};}});
 for(const project of [first,second]){selected=project;const receipt=await manager.select(event);assert.deepEqual(receipt,{workspace:project,restartRequired:false,approvalGranted:false});assert.equal(manager.read(event).workspace,project);}
 assert.deepEqual(activated,[first,second]);assert.equal(manager.read({}),null);
});
test('failed activation preserves the previous saved project and a later selection recovers',async t=>{
 const root=fixture(t),event={},first=path.join(root,'first'),second=path.join(root,'second');let selected=first,fail=false;
 const manager=createWorkerWorkspace({dataRoot:path.join(root,'state'),owns:e=>e===event,choose:async()=>selected,activate:async workspace=>{if(fail)throw Error('synthetic Core unavailable');return{workspace,restartRequired:false};}});
 await manager.select(event);const setting=path.join(root,'state','settings','worker-workspace.json'),before=fs.readFileSync(setting);
 selected=second;fail=true;await assert.rejects(manager.select(event),/Core unavailable/);assert.ok(fs.readFileSync(setting).equals(before));assert.equal(fs.existsSync(setting+'.pending'),false);assert.equal(manager.read(event).workspace,first);
 fail=false;assert.equal((await manager.select(event)).workspace,second);assert.equal(manager.read(event).approvalGranted,false);
});
test('unowned project selection cannot open a picker or call Core',async t=>{
 const root=fixture(t);let calls=0;const manager=createWorkerWorkspace({dataRoot:path.join(root,'state'),owns:()=>false,choose:async()=>{calls++;return path.join(root,'first');},activate:async()=>{calls++;}});
 await assert.rejects(manager.select({}),/must come from Nori/);assert.equal(calls,0);assert.equal(fs.existsSync(path.join(root,'state')),false);
});
test('camera permission does not enable microphone and toggling the lease updates both handlers',()=>{
 let held=false,check,request;const local='http://127.0.0.1:15188';
 installMediaPermissionHandlers({session:{setPermissionCheckHandler:f=>{check=f;},setPermissionRequestHandler:f=>{request=f;}},local:origin=>origin===local,allowedPermissions:['media'],microphoneHeld:()=>held});
 assert.equal(check(null,'media',local,{mediaType:'video'}),true);assert.equal(check(null,'media',local,{mediaType:'audio'}),false);
 let granted;request({getURL:()=>local},'media',value=>{granted=value;},{mediaTypes:['video','audio']});assert.equal(granted,false);
 held=true;assert.equal(check(null,'media',local,{mediaType:'audio'}),true);held=false;assert.equal(check(null,'media',local,{mediaType:'audio'}),false);assert.equal(check(null,'media','https://example.com',{mediaType:'video'}),false);
});
