import WebSocket from 'ws';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {managedInstructionCatalog} from '../bridge/managed-instruction-skills.mjs';
const store='C:/Users/Studio/AppData/Local/Nori/skills';
const digest=()=>createHash('sha256').update(readFileSync(store+'/registry.json')).digest('hex');
const before=digest(),expected=managedInstructionCatalog(store).map(x=>x.name);
const socket=new WebSocket('ws://127.0.0.1:18787/',{origin:'http://127.0.0.1:15188'});
const id='catalog-direct-'+Date.now(),started=Date.now();let sent=false,finished=false;
const timer=setTimeout(()=>finish('timeout'),30000);
function finish(status,reply=''){if(finished)return;finished=true;clearTimeout(timer);const passed=status==='done'&&expected.length>0&&expected.every(n=>reply.includes(n))&&reply.includes(expected.length+' verified skills')&&before===digest();const report={passed,status,elapsedMs:Date.now()-started,expected,reply,registryUnchanged:before===digest(),scope:'installed desktop bridge, direct catalog request'};writeFileSync('C:/Nori/.work/reports/installed-catalog-negated-actions-fixed.json',JSON.stringify(report,null,2),{flag:'wx'});console.log(JSON.stringify(report));socket.close();process.exitCode=passed?0:1;}
socket.on('message',raw=>{const e=JSON.parse(raw);if(e.type==='ready'&&!sent){sent=true;socket.send(JSON.stringify({type:'ask',id,text:'What instruction skills do you have installed? Check your verified local skill catalog and report its names. Do not install anything or edit files.'}));}if(e.ask!==id)return;if(e.type==='done')finish('done',e.text);if(e.type==='error')finish('error',e.message);});socket.on('error',e=>finish('error',e.message));

