import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const asar=createRequire(import.meta.url)('@electron/asar');
const stage='C:/Nori/.work/name-memory-promote',target='C:/Program Files/Nori/resources/app.asar',work=stage+'/code-workspace';
const hash=b=>createHash('sha256').update(b).digest('hex'),norm=n=>n.slice(1).replaceAll('\\','/');
const modules=['nori-learning.mjs','nori-v2-query.mjs','personal-name.mjs'];
const testLog=readFileSync('C:/Nori/.work/reports/name-memory-promote-verification.log','utf8');
assert.match(testLog,/tests 11/);assert.match(testLog,/pass 11/);assert.match(testLog,/fail 0/);
assert.ok(!existsSync(work));mkdirSync(work);const originalHash=hash(readFileSync(target));
try {
 const names=asar.listPackage(target),normalized=names.map(norm),updates=[];
 asar.extractAll(target,work);
 for(const file of modules){
  const n=names.find(n=>norm(n)==='bridge/'+file),next=readFileSync(stage+'/'+file),loose='C:/Program Files/Nori/resources/NoriSuite/apps/desktop/bridge/'+file;
  const before=n?asar.extractFile(target,n.slice(1)):null;
  if(before)assert.equal(hash(readFileSync(loose)),hash(before),'Loose mirror differs: '+file);else assert.ok(!existsSync(loose));
  writeFileSync(work+'/bridge/'+file,next);
  updates.push({target:loose,source:stage+'/'+file,before:before?hash(before):null,after:hash(next)});
 }
 await asar.createPackage(work,stage+'/app.asar.next');
 const newNames=asar.listPackage(stage+'/app.asar.next');
 assert.deepEqual(newNames.map(norm).sort(),[...normalized,'bridge/personal-name.mjs'].sort());
 const changed=[];
 for(const n of names){const x=asar.statFile(target,n.slice(1)),y=asar.statFile(stage+'/app.asar.next',n.slice(1));for(const k of ['unpacked','executable','link'])assert.deepEqual(x[k],y[k]);if(x.files)continue;if(hash(asar.extractFile(target,n.slice(1)))!==hash(asar.extractFile(stage+'/app.asar.next',n.slice(1))))changed.push(norm(n));}
 assert.deepEqual(changed.sort(),['bridge/nori-learning.mjs','bridge/nori-v2-query.mjs']);
 assert.equal(hash(readFileSync(target)),originalHash,'Installed app changed during preparation');
 updates.unshift({target,source:stage+'/app.asar.next',before:originalHash,after:hash(readFileSync(stage+'/app.asar.next'))});
 writeFileSync(stage+'/promotion-plan.json',JSON.stringify({verified:true,updates,archiveChanges:[...changed,'bridge/personal-name.mjs'],tests:11,modelsCopied:0,newRuntimeCreated:false},null,2),{flag:'wx'});
 console.log(JSON.stringify({verified:true,updates:updates.length,tests:11,reaPreserved:true,installedChanged:false}));
} finally {assert.equal(realpathSync(work).toLowerCase(),resolve(work).toLowerCase());rmSync(work,{recursive:true});}
