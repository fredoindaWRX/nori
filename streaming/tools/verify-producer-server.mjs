import assert from 'node:assert/strict';
import {createProducerServer} from './nori-producer-server.mjs';
import {writeFile} from 'node:fs/promises';
const port=18769,origin=`http://127.0.0.1:${port}`;
let release,received=[];
const server=createProducerServer({port,answer:async q=>{received.push(q);if(q.question==='slow')await new Promise(r=>release=r);return {...q,answer:'Reviewed local answer',localOnly:true,postedToChat:false,obsControlled:false};}});
await new Promise(r=>server.listen(port,'127.0.0.1',r));
const request=(value,extra={})=>fetch(origin+'/answer',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...extra},body:JSON.stringify(value)});
const checks=[];
try{
 assert.equal((await fetch(origin+'/')).status,200);checks.push('Producer served over loopback');
 assert.equal((await request({question:'hello'}, {Origin:'https://example.com'})).status,403);checks.push('Foreign origin rejected before inference');
 assert.equal((await request({question:'hello'}, {'Content-Type':'text/plain'})).status,403);checks.push('Non-JSON request rejected');
 assert.equal((await request({question:'x'.repeat(601)})).status,400);checks.push('Oversized question rejected');
 assert.equal((await request({question:'hello',extra:'x'.repeat(9000)})).status,413);checks.push('Oversized body rejected');
 let resp=await request({question:'selected question',topic:'',privateNotes:'not forwarded'});assert.equal(resp.status,200);let result=await resp.json();assert.equal(result.postedToChat,false);assert.deepEqual(received,[{question:'selected question',topic:''}]);checks.push('Only selected question and explicit topic reach inference');
 const pending=request({question:'slow'});while(!release)await new Promise(r=>setTimeout(r,10));
 assert.equal((await request({question:'other'})).status,409);release();assert.equal((await pending).status,200);checks.push('Concurrent inference refused while busy');
 const proof={status:'passed',checks,realNetworkRequests:true,modelStubUsed:true,liveChatConnected:false,obsControlled:false,automaticPosting:false};
 await writeFile('C:/Nori/streaming/channel-operator/08-Stream-Assistant/producer-server-tests.json',JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
}finally{await new Promise(r=>server.close(r));}
