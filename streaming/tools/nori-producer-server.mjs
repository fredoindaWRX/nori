import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { answerQuestion, validateQuestion } from './nori-stream-answer.mjs';
import { readObsStatus, applyObsAction, validateObsAction } from './nori-obs-status.mjs';

export function createProducerServer({ answer = answerQuestion, port = 8769 } = {}) {
  let busy = false;
  const origin = `http://127.0.0.1:${port}`;
  const assets = new Map([
    ['/', ['C:/Nori/streaming/producer.html', 'text/html; charset=utf-8']],
    ['/producer.html', ['C:/Nori/streaming/producer.html', 'text/html; charset=utf-8']],
    ['/preview.html', ['C:/Nori/streaming/preview.html', 'text/html; charset=utf-8']],
  ]);
  function send(res, status, value) {
    res.writeHead(status, {'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff'});
    res.end(JSON.stringify(value));
  }
  const server = http.createServer(async (req,res) => {
    if (req.headers.host !== `127.0.0.1:${port}`) return send(res,403,{error:'Open the panel using its local address.'});
    if (req.method==='GET' && req.url==='/health') {
      let obsConnected=false;
      try {obsConnected=(await readObsStatus()).connected===true;} catch {}
      return send(res,200,{localOnly:true,busy,chatConnected:false,obsConnected,obsControlEnabled:true});
    }
    if (req.method==='GET' && req.url==='/obs-status') {
      try {return send(res,200,await readObsStatus());}
      catch {return send(res,503,{connected:false,reason:'OBS connection unavailable. Check its WebSocket settings.'});}
    }
    if (req.method==='GET' && assets.has(req.url)) {
      const [path,type]=assets.get(req.url);
      try { const bytes=await readFile(path);res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes); }
      catch {send(res,500,{error:'The local panel file is unavailable.'});}
      return;
    }
    if (req.method!=='POST' || !['/answer','/obs-action'].includes(req.url)) return send(res,404,{error:'Not found'});
    if (req.headers.origin!==origin || !String(req.headers['content-type']).startsWith('application/json')) return send(res,403,{error:'Ask from the local producer panel.'});
    if (busy) return send(res,409,{error:'Nori is answering another question. Try again when it finishes.'});
    let chunks=[],size=0;
    try {
      for await(const chunk of req){size+=chunk.length;if(size>8192){send(res,413,{error:'Question file is too large.'});return;}chunks.push(chunk);}
      const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(req.url==='/obs-action'){
        const action=validateObsAction(payload);
        try{return send(res,200,await applyObsAction(action));}
        catch{return send(res,503,{error:'OBS could not apply this action. Refresh its status.'});}
      }
      const selected=validateQuestion(payload);
      busy=true;
      try { send(res,200,await answer(selected)); }
      catch {send(res,503,{error:'Nori could not finish this answer. Try again or use the file launcher.'});}
      finally {busy=false;}
    } catch {send(res,400,{error:'Enter one question of 1–600 characters.'});}
  });
  return server;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const server=createProducerServer();
 server.listen(8769,'127.0.0.1',()=>console.log('Nori producer ready: http://127.0.0.1:8769'));
 server.on('error',err=>{console.error(err.code==='EADDRINUSE'?'The producer address is already in use.':'Producer could not start.');process.exitCode=1;});
}
