import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const configPath='C:/Users/Studio/AppData/Roaming/obs-studio/plugin_config/obs-websocket/config.json';
const hash=value=>createHash('sha256').update(value).digest('base64');

// Credentials stay in this process; callers receive only status or action results.
async function withObs(operation,{timeoutMs=5000}={}) {
 const config=JSON.parse(await readFile(configPath,'utf8'));
 if(!config.server_enabled) return {connected:false,reason:'OBS remote server is disabled.'};
 if(!config.auth_required) return {connected:false,reason:'Enable authentication in OBS before connecting.'};
 const port=Number(config.server_port);
 if(!Number.isInteger(port)||port<1||port>65535) throw new Error('Invalid OBS port');
 return new Promise((resolveStatus,reject)=>{
  const ws=new WebSocket(`ws://127.0.0.1:${port}`);
  const pending=new Map();let finished=false;
  const finish=(err,result)=>{if(finished)return;finished=true;clearTimeout(timer);ws.close();for(const p of pending.values())p.reject(new Error('Connection closed'));pending.clear();err?reject(new Error('OBS connection unavailable.')):resolveStatus(result);};
  const timer=setTimeout(()=>finish(new Error('Timeout')),timeoutMs);
  const request=(type,data={})=>new Promise((resolveRequest,rejectRequest)=>{const id=randomUUID();pending.set(id,{resolve:resolveRequest,reject:rejectRequest});ws.send(JSON.stringify({op:6,d:{requestType:type,requestId:id,requestData:data}}));});
  ws.addEventListener('error',()=>finish(new Error('Socket error')));
  ws.addEventListener('close',()=>{if(!finished)finish(new Error('Socket closed'));});
  ws.addEventListener('message',async event=>{
   try {
    const message=JSON.parse(event.data);
    if(message.op===0){const auth=message.d.authentication;if(!auth)throw new Error('Authentication unavailable');const authentication=hash(hash(config.server_password+auth.salt)+auth.challenge);ws.send(JSON.stringify({op:1,d:{rpcVersion:1,authentication,eventSubscriptions:0}}));}
    else if(message.op===2){
     finish(null,await operation(request));
    } else if(message.op===7){const p=pending.get(message.d.requestId);if(p){pending.delete(message.d.requestId);message.d.requestStatus.result?p.resolve(message.d.responseData??{}):p.reject(new Error('OBS request rejected'));}}
   }catch{finish(new Error('Protocol failure'));}
  });
 });
}

export async function readObsStatus(options={}) {
 return withObs(async request=>{
  const [scene,stream,record,inputs]=await Promise.all(['GetSceneList','GetStreamStatus','GetRecordStatus','GetInputList'].map(type=>request(type)));
  const audio=inputs.inputs.filter(x=>/^(MIC|GUESTS) — /i.test(x.inputName));
  const muteStates=await Promise.all(audio.map(input=>request('GetInputMute',{inputName:input.inputName}).then(value=>({name:input.inputName,muted:value.inputMuted})).catch(()=>({name:input.inputName,muted:null}))));
  return {connected:true,observedAt:new Date().toISOString(),currentScene:scene.currentProgramSceneName,scenes:scene.scenes.map(x=>x.sceneName),streaming:stream.outputActive,recording:record.outputActive,recordingPaused:record.outputPaused,audio:muteStates,readOnly:true};
 },options);
}

export function validateObsAction(action) {
 if(!action||typeof action!=='object'||Array.isArray(action))throw new Error('Invalid OBS action');
 if(action.type==='scene'&&typeof action.scene==='string'&&action.scene.length>0&&action.scene.length<=100)return {type:'scene',scene:action.scene};
 if(action.type==='mute'&&['MIC — SteelSeries Sonar','GUESTS — Discord'].includes(action.input)&&typeof action.muted==='boolean')return {type:'mute',input:action.input,muted:action.muted};
 throw new Error('Choose a scene or microphone/guest mute action.');
}

export async function applyObsAction(action) {
 const selected=validateObsAction(action);
 return withObs(async request=>{
  if(selected.type==='scene'){
   const scenes=await request('GetSceneList');
   if(!scenes.scenes.some(x=>x.sceneName===selected.scene))throw new Error('Scene missing');
   await request('SetCurrentProgramScene',{sceneName:selected.scene});
   const current=await request('GetCurrentProgramScene');
   if(current.currentProgramSceneName!==selected.scene)throw new Error('Scene verification failed');
   return {applied:true,type:'scene',scene:selected.scene};
  }
  await request('SetInputMute',{inputName:selected.input,inputMuted:selected.muted});
  const current=await request('GetInputMute',{inputName:selected.input});
  if(current.inputMuted!==selected.muted)throw new Error('Mute verification failed');
  return {applied:true,type:'mute',input:selected.input,muted:current.inputMuted};
 });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await readObsStatus()));}catch{console.log(JSON.stringify({connected:false,reason:'OBS connection unavailable.'}));process.exitCode=1;}
}
