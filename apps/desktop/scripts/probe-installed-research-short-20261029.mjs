import WebSocket from 'ws';
import {writeFileSync} from 'node:fs';
const id='model-team-installed-skills-'+Date.now();
const started=Date.now(); const events=[];
const socket=new WebSocket('ws://127.0.0.1:18787/',{origin:'http://127.0.0.1:15188'});
let finished=false,sent=false;
function finish(status,error){if(finished)return;finished=true;clearTimeout(timer);const result={status,error,elapsedMs:Date.now()-started,scope:'live installed desktop bridge',events};writeFileSync('C:/Nori/.work/reports/model-team-installed-research-short-live.json',JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result));socket.close();setTimeout(()=>socket.terminate(),1000).unref();process.exitCode=status==='done'?0:1;}
const timer=setTimeout(()=>{socket.send(JSON.stringify({type:'interrupt'}));finish('timeout');},90000);
socket.on('message',raw=>{const e=JSON.parse(raw);if(e.type==='ready'&&!sent){sent=true;events.push(e);socket.send(JSON.stringify({type:'ask',id,text:'Research official Python documentation. Read https://docs.python.org/3/ and give one sentence explaining where a beginner should start, with the source URL. Use only docs.python.org and www.python.org for page reads.'}));}else if(!e.ask||e.ask===id){if(['done','error','tool','text'].includes(e.type))events.push(e);if(e.type==='done')finish('done');if(e.type==='error')finish('error',e.message);}});
socket.on('error',e=>finish('connection-error',e.message));


