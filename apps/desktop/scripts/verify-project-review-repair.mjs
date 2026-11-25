import assert from 'node:assert/strict';
import{createRequire}from'node:module';import{readFileSync,writeFileSync,mkdirSync,existsSync,rmSync,realpathSync}from'node:fs';import{dirname,resolve}from'node:path';import{createServer}from'node:http';
const a=createRequire(import.meta.url)('@electron/asar'),base='C:/Nori/apps/desktop/.project-review-fixture',report='C:/Nori/.work/project-review-repair/fixture-results.json';assert.ok(!existsSync(base));mkdirSync(base);
const saved={...process.env},rows=[];let server;
try{
 const archive='C:/Program Files/Nori/resources/app.asar';let bytes=0;
 for(const name of a.listPackage(archive)){const p=name.slice(1).replaceAll('\\','/');if(!/^(bridge|desktop)\/.*\.(mjs|cjs|json)$/.test(p))continue;const b=a.extractFile(archive,name.slice(1));bytes+=b.length;assert.ok(bytes<32*1024*1024);mkdirSync(dirname(base+'/'+p),{recursive:true});writeFileSync(base+'/'+p,b)}
 writeFileSync(base+'/package.json','{"type":"module"}');mkdirSync(base+'/state');mkdirSync(base+'/project/apps/desktop/bridge',{recursive:true});mkdirSync(base+'/project/apps/desktop/tests',{recursive:true});
 const paths=['apps/desktop/bridge/local-chat.mjs','apps/desktop/bridge/calculator.mjs','apps/desktop/tests/calculator.test.mjs'];
 paths.forEach((p,i)=>writeFileSync(base+'/project/'+p,['export const localChat = 1;','export const multiply = (a,b) => a*b;','export const expected = 6;'][i]));
 for(const version of ['installed','next','failed-read','denied-path','repeat-read']){
  writeFileSync(base+'/bridge/review-'+version+'.mjs',readFileSync('C:/Nori/.work/project-review-repair/local-chat.'+(version==='installed'?'installed':'next')+'.mjs'));
  const payloads=[];let call=0;
  if(version==='failed-read')writeFileSync(base+'/project/'+paths[0],'export const localChat = 1;');
  server=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;const payload=JSON.parse(raw);payloads.push(payload);res.writeHead(200,{'content-type':'text/event-stream'});
   const index=call++;const tool=payload.tools?.find(t=>t.function.name==='read_file');
   const delta=tool&&(version==='repeat-read'||index<3)?{tool_calls:[{index:0,id:'read_'+index,type:'function',function:{name:'read_file',arguments:JSON.stringify({path:version==='repeat-read'?paths[0]:version==='denied-path'&&index===1?'../outside.mjs':version==='failed-read'&&index===1?'apps/desktop/bridge/missing.mjs':paths[index],max_lines:8})}}]}:{content:'Reviewed bounded source excerpts; no tests or code changes were performed.'};
   res.end('data: '+JSON.stringify({choices:[{delta}]})+'\n\ndata: [DONE]\n\n');
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));
  Object.assign(process.env,{NORI_INFERENCE_RUNTIME:'gpt-oss',NORI_GPT_OSS_ENABLED:'1',NORI_GPT_OSS_URL:'http://127.0.0.1:'+server.address().port,NORI_GPT_OSS_SERVER_MODEL:'fixture-local-9b',NORI_ROOT:base+'/project',NORI_SETTINGS_DIR:base+'/state',NORI_APP_DATA_ROOT:base+'/state',NORI_LEARNING_FILE:base+'/state/learning.json',NORI_RUNTIME_CONFIG_PATH:base+'/state/no-runtime.json'});
  const module=await import(new URL('file:///'+base+'/bridge/review-'+version+'.mjs'));
  let answer='';for await(const part of module.localChat({goal:'Inspect your source code and check your project for anything that needs improving.',turns:[],profile:'balanced',modelSelection:'nori-auto'}))answer+=part;
  const offered=payloads.filter(p=>p.tools?.some(t=>t.function.name==='read_file')).length;
  const row={version,requests:payloads.length,readRounds:offered,answer};rows.push(row);console.log(JSON.stringify(row));
  assert.equal(offered,version==='installed'?1:version==='repeat-read'?6:3);assert.ok(answer.includes('no tests'));
  if(version==='failed-read'||version==='denied-path'){assert.ok(payloads.some(p=>p.messages.some(m=>m.role==='tool'&&/error|denied|rejected|not found/i.test(m.content))))}
  if(version==='repeat-read'){assert.equal(payloads.length,7);assert.ok(!payloads.at(-1).tools)}
  if(version==='next'){assert.equal(payloads.length,4);assert.ok(!payloads[3].tools);assert.ok(payloads[2].messages.some(m=>m.role==='tool'&&m.content.includes('multiply')))}
  server.closeAllConnections();await new Promise(r=>server.close(r));server=null;
 }
 writeFileSync(report,JSON.stringify({passed:true,scope:'installed-derived modules, actual project read adapter, synthetic SSE inference on loopback, isolated files/state; no real model or installed-app mutation',rows},null,2));
}catch(e){writeFileSync(report,JSON.stringify({passed:false,error:e.stack,rows},null,2));console.error(e);process.exitCode=1}
finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r))}for(const k of Object.keys(process.env))if(!(k in saved))delete process.env[k];Object.assign(process.env,saved);assert.equal(realpathSync(base).toLowerCase(),resolve(base).toLowerCase());rmSync(base,{recursive:true})}
