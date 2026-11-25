// Real packaged WebSocket bridge -> native Core/runtime; synthetic conversation only.
import assert from 'node:assert/strict'
import {createHash,randomUUID} from 'node:crypto'
import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
import {packagedConversationOptions} from './packaged-conversation-options.mjs'
const root = resolve(import.meta.dirname, '../../..')
const options=packagedConversationOptions(process.argv.slice(2))
const {fixtureName,verifyCorruptResume}=options
const selected=options.candidate??(fixtureName?readFileSync(join(root,'apps/desktop/release/current-desktop.txt'),'utf8').trim():'launcher-cachebinding-20261005')
if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(selected))throw Error('Invalid selected desktop candidate')
const candidate = join(root, `apps/desktop/release/native-desktop-${selected}`)
const packageRoot = join(candidate, 'win-unpacked')
const output = fixtureName?join(root,`verification/nori-packaged-conversation-${selected}-${fixtureName}-${verifyCorruptResume?'recovery':'memory-restart'}-${randomUUID()}.json`):join(root, 'verification/nori-cache-packaged-conversation-2026-10-05.json')
if (existsSync(output)) throw Error('Existing conversation evidence preserved')
const gui = JSON.parse(readFileSync(fixtureName?
  join(packageRoot,'resources/NoriSuite/verification',fixtureName,'state/private/desktop/packaged-consolidated-probe-receipt.json'):
  join(root, 'verification/nori-cache-packaged-gui-2026-10-05.json'), 'utf8'))
if(fixtureName){assert.equal(gui.packagedConsolidatedProbe,'PASS');assert.equal(gui.syntheticOnly,true);assert.equal(gui.cleanup.originalGuiExited,true)}
else assert.equal(gui.passed, true)
const layout = fixtureName?gui.generatedLayoutRoot:gui.generatedStatePreserved
assert.ok(resolve(layout).startsWith(join(packageRoot, 'resources/NoriSuite/verification') + '\\'))
const receiptFile = join(candidate, 'native-desktop-receipt.json')
const receiptHash = createHash('sha256').update(readFileSync(receiptFile)).digest('hex')
const clean = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
  !/^(?:NORI_|LETTA_|NODE|PYTHON|ELECTRON_|NPM_|PIP_|CONDA_|UV_|PATH$|VIRTUAL_ENV$)/i.test(name)))
clean.PATH = [join(process.env.SystemRoot, 'System32'), process.env.SystemRoot,
  join(process.env.SystemRoot, 'System32/Wbem')].join(';')
clean.ELECTRON_RUN_AS_NODE = '1'
const code = `
const assert=require('node:assert/strict'),{join}=require('node:path'),{spawn}=require('node:child_process'),{createServer}=require('node:net');
const packageRoot=process.argv[1],layout=process.argv[2],suite=join(packageRoot,'resources/NoriSuite'),archive=join(packageRoot,'resources/app.asar');
const {startNativeStack}=require(join(archive,'desktop/native-stack.cjs'));
const WebSocket=require(join(archive,'node_modules/ws'));
const {readdirSync,readFileSync,writeFileSync}=require('node:fs');
const delay=ms=>new Promise(done=>setTimeout(done,ms));
(async()=>{let stack,bridge,bridgeExit;const sockets=[];let result;
try{
 const profile=join(layout,'state/private/desktop'),core=join(layout,'state/private/core');
 stack=await startNativeStack({root:suite,environment:process.env,dataRoot:core,requirePreparedState:true});
 const reserve=createServer();await new Promise(done=>reserve.listen(0,'127.0.0.1',done));const port=reserve.address().port;
 await new Promise(done=>reserve.close(done));
 const env={...process.env,...stack.environment,NORI_ROOT:suite,NORI_BRAIN:'nori-v2',NORI_LOCAL_CHAT:'1',NORI_ALLOW_WRITES:'0',
 NORI_BRIDGE_PORT:String(port),NORI_ALLOWED_ORIGINS:'http://127.0.0.1:5188',NORI_VISION_BACKEND:'disabled',
 NORI_SETTINGS_DIR:join(profile,'conversation-settings'),NORI_DATA_ROOT:join(profile,'conversation-runtime-data'),
 NORI_LEARNING_FILE:join(profile,'conversation-memory.json'),NORI_PYTHON:join(profile,'missing-conversation-stt.exe'),
 TEMP:join(layout,'state/private/tmp'),TMP:join(layout,'state/private/tmp'),ELECTRON_RUN_AS_NODE:'1'};
 bridge=spawn(process.execPath,[join(archive,'bridge/server.mjs')],{cwd:profile,env,shell:false,windowsHide:true,stdio:'ignore'});
 bridgeExit=new Promise(done=>{bridge.once('exit',(code,signal)=>done({code,signal}));bridge.once('error',error=>done({error:error.code}))});
 const connect=()=>new Promise((done,reject)=>{
  const socket=new WebSocket('ws://127.0.0.1:'+port,{origin:'http://127.0.0.1:5188'}),frames=[];sockets.push(socket);
  socket.on('message',bytes=>frames.push(JSON.parse(bytes)));socket.once('error',reject);socket.once('open',()=>done({socket,frames}));
 });
 let client;for(let i=0;i<100;i++){try{client=await connect();break}catch{await delay(50)}}assert.ok(client,'Packaged bridge unavailable');
 const until=async(test,timeout=30000)=>{const end=Date.now()+timeout;for(;;){const value=test();if(value)return value;assert.ok(Date.now()<end,'Expected bridge event missing');await delay(20)}};
 const ready=await until(()=>client.frames.find(f=>f.type==='ready'));
 assert.equal(Object.keys(ready.personality.profile).length,12);assert.equal(Object.keys(ready.personality.affect).length,11);
 const baseline=ready.personality;
 client.socket.send(JSON.stringify({type:'config',effort:'lightning-fast',personality:{humor:77,warmth:81}}));
 await until(()=>client.frames.find(f=>f.type==='ready'&&f.personality.profile.humor===77&&f.personality.profile.warmth===81));
 const ask=async(text,id)=>{
  client.socket.send(JSON.stringify({type:'ask',text,id}));
  await until(()=>client.frames.find(f=>(f.type==='done'||f.type==='error')&&f.ask===id),45000);
  const frames=client.frames.filter(f=>f.ask===id);const error=frames.find(f=>f.type==='error');
  return {id,text:frames.filter(f=>f.type==='text').map(f=>f.delta).join(''),error:error||null};
 };
 const hello=await ask('lol Say hello in one short sentence.','hello');assert.equal(hello.error,null);assert.ok(hello.text.trim());
 const identity=await ask('Who are you?','identity');assert.equal(identity.error,null);
 assert.match(identity.text,/I'm N\.O\.R\.I\./i,'Packaged identity guard did not identify Nori');
 assert.doesNotMatch(identity.text,/\b(?:COO|CEO|chief operating officer|chief executive officer)\b/i,
   'Packaged identity response invented a corporate job title');
 const expression=client.frames.filter(f=>f.type==='personality').map(f=>f.personality);
 assert.ok(expression.some(p=>p.active&&p.mode==='playful'&&p.appliedProfile.humor===77));
 client.socket.send(JSON.stringify({type:'config',effort:'balanced'}));await until(()=>client.frames.find(f=>f.type==='ready'&&f.effort==='balanced'));
 const word=await ask('Reply with just the word hello.','word');assert.equal(word.error,null);assert.match(word.text,/hello/i);
 const followup=await ask('What word did I ask you to say?','followup');assert.equal(followup.error,null);assert.match(followup.text,/hello/i);
 // Exercise the explicit durable-work route. Ordinary chat deliberately has
 // no action tools, so a plain "open a file" sentence only tests model prose.
 const refused=await ask('*work open a file named nonexistent-probe.txt.','blocked');
 assert.ok(refused.error,'Read-only durable work unexpectedly completed');
 assert.match(refused.error.message,/read-only mode/i,
   'With writes disabled, the packaged app must refuse durable work before starting a task');
 const memoryMarker='cobalt-tulip-742';
 const remembered=await ask('For this conversation, remember the test code '+memoryMarker+'. Reply briefly.','memory-marker');
 assert.equal(remembered.error,null);assert.ok(remembered.text.trim());
 client.socket.close();const reconnected=await connect();
 const restored=await until(()=>reconnected.frames.find(f=>f.type==='ready'));
 assert.equal(restored.effort,'balanced');assert.equal(restored.personality.profile.humor,77);assert.equal(restored.personality.profile.warmth,81);
 const firstBridgePid=bridge.pid;
 for(const socket of sockets)socket.terminate();
 bridge.kill();const firstExit=await Promise.race([bridgeExit,delay(5000).then(()=>null)]);
 assert.ok(firstExit,'First owned bridge did not stop for persistence test');assert.equal(firstExit.error,undefined);
 bridge=spawn(process.execPath,[join(archive,'bridge/server.mjs')],{cwd:profile,env,shell:false,windowsHide:true,stdio:'ignore'});
 bridgeExit=new Promise(done=>{bridge.once('exit',(code,signal)=>done({code,signal}));bridge.once('error',error=>done({error:error.code}))});
 let restarted;for(let i=0;i<100;i++){try{restarted=await connect();break}catch{await delay(50)}}assert.ok(restarted,'Restarted packaged bridge unavailable');
 const persisted=await until(()=>restarted.frames.find(f=>f.type==='ready'));
 assert.equal(persisted.effort,'balanced');assert.equal(persisted.personality.profile.humor,77);assert.equal(persisted.personality.profile.warmth,81);
 assert.notEqual(bridge.pid,firstBridgePid);
 client=restarted;
 const recalled=await ask('What was the test code I asked you to remember? Reply with the exact code only.','memory-recall');
 assert.equal(recalled.error,null);assert.ok(recalled.text.includes(memoryMarker),'Native model failed to recall persisted test code after bridge restart');
 const secondBridgePid=bridge.pid;
 let corruptionPreserved=false;
 if(process.argv[3]==='1'){
  for(const socket of sockets)socket.terminate();
  bridge.kill();assert.ok(await Promise.race([bridgeExit,delay(5000).then(()=>null)]),'Second owned bridge failed to stop');
  const settings=join(profile,'conversation-settings'),names=readdirSync(settings).filter(name=>/^resume-native-[a-f0-9]{10}[.]json$/.test(name));
  assert.equal(names.length,1,'Expected exactly one generated native resume record');
  const file=join(settings,names[0]),corrupt='{synthetic corrupt conversation fixture';
  writeFileSync(file,corrupt);
  bridge=spawn(process.execPath,[join(archive,'bridge/server.mjs')],{cwd:profile,env,shell:false,windowsHide:true,stdio:'ignore'});
  bridgeExit=new Promise(done=>{bridge.once('exit',(code,signal)=>done({code,signal}));bridge.once('error',error=>done({error:error.code}))});
  let denied;for(let i=0;i<100;i++){try{denied=await connect();break}catch{await delay(50)}}assert.ok(denied,'Recovery bridge unavailable');
  const recovery=await until(()=>denied.frames.find(frame=>frame.type==='error'));
  assert.match(recovery.message,/preserved; recovery is required/);
  assert.equal(denied.frames.some(frame=>frame.type==='ready'),false);
  assert.equal(readFileSync(file,'utf8'),corrupt);assert.equal(bridge.exitCode,null);
  corruptionPreserved=true;
 }
result={passed:true,status:stack.status,baseline,hello,identity,word,followup,refused,
 livePersonalityApplied:true,profileRestored:true,responseStyleRestored:true,
 profileRestoredAfterProcessRestart:true,responseStyleRestoredAfterProcessRestart:true,
 firstBridgePid,secondBridgePid,bridgePid:bridge.pid,remembered,recalled,conversationHistoryAfterRestartVerified:true,corruptionPreserved};
}finally{
 for(const socket of sockets)socket.terminate();
 if(bridge&&bridge.exitCode===null){bridge.kill();const exit=await Promise.race([bridgeExit,delay(5000).then(()=>null)]);assert.ok(exit,'Owned bridge did not exit')}
 if(stack)await stack.stop();
}
console.log(JSON.stringify(result));
})().catch(error=>{console.error(error.message);process.exitCode=1});
`
const report = {schema: 'nori.cache-packaged-conversation.v1', passed: false, receiptSha256: receiptHash,
  releaseVerified: false, installedSuiteVerified: false, generatedLayout: layout,
  limits: ['Actual packaged WebSocket protocol used by desktop, not mouse/keyboard interaction or visual acceptance.',
    'Synthetic public conversation smoke, not independent model quality evaluation.',
    'Generated test profile only; sensors and durable tools unqualified and not enabled.']}
try {
  const probe = spawnSync(join(packageRoot, 'Nori.exe'), ['-e', code, packageRoot, layout, verifyCorruptResume?'1':'0'],
    {cwd: packageRoot, env: clean, shell: false, windowsHide: true, encoding: 'utf8', timeout: 180000, maxBuffer: 65536})
  report.processExit = probe.status
  assert.equal(probe.status, 0, probe.stderr || probe.error?.message || 'Conversation probe failed')
  const result = JSON.parse(probe.stdout.trim());assert.equal(result.passed,true)
  report.result = result
  const pids = [result.firstBridgePid,result.secondBridgePid,result.bridgePid, result.status.corePid, result.status.runtimePid, result.status.workerPid]
  assert.ok(pids.every(pid=>Number.isSafeInteger(pid)&&pid>0))
  const filter=pids.map(pid=>'ProcessId = '+pid).join(' OR ')
  const check=spawnSync(join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoProfile','-Command',`if (Get-CimInstance Win32_Process -Filter '${filter}') { exit 1 } else { exit 0 }`],
    {shell:false,windowsHide:true,encoding:'utf8',timeout:10000})
  assert.equal(check.status,0,'Observed owned component still running')
  assert.equal(createHash('sha256').update(readFileSync(receiptFile)).digest('hex'),receiptHash)
  report.observedComponentPidsAbsent=true;report.passed=true
}catch(error){report.failure={type:error.name,message:error.message};throw error}
finally{writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'})}
console.log(JSON.stringify({passed:true,conversation:true,personality:true,responseStyle:true,
  unqualifiedToolRefused:true,observedComponentPidsAbsent:true,releaseVerified:false}))
