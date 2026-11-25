import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{createRequire}from'node:module';import vm from'node:vm';
const s=readFileSync('C:/Nori/.work/rea-deadline-repair/nori-v2-query.mjs','utf8'),start=s.indexOf('export function localReplyTimeoutMs'),end=s.indexOf('\n}\n',start)+2;
assert.ok(start>0&&end>start);const {resolveNoriReaIntent,requestsNoriRea}=await import('../bridge/rea-tools.mjs');
const c=vm.createContext({process:{env:{}},nativeRuntimeMode:()=>"gpt-oss",resolveNoriReaIntent,requestsNoriRea,requestsResearch:()=>false,isAiderCodeRequest:()=>false,isVideoRequest:()=>false,requestsNoriArtCraftOperation:()=>false,requestsNoriProjectReview:()=>false,requestsNoriProjectRead:()=>false});vm.runInContext(s.slice(start,end).replace('export ',''),c);
const file=String.raw`C:\Nori\synthetic-timeout.exe`;c.file=file;
assert.equal(vm.runInContext('localReplyTimeoutMs("rea the Discord app")',c),600000);
assert.equal(vm.runInContext('localReplyTimeoutMs(file,[{role:"user",text:"rea the Discord app"}])',c),600000);
assert.equal(vm.runInContext('localReplyTimeoutMs("hello")',c),120000);
console.log(JSON.stringify({passed:true,scope:'actual staged installed-controller timeout function',cases:3}));
