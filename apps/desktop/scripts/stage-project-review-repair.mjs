import assert from'node:assert/strict';import{createRequire}from'node:module';import{readFileSync,writeFileSync,mkdirSync,existsSync,rmSync,realpathSync}from'node:fs';import{resolve}from'node:path';import{createHash}from'node:crypto';
const req=createRequire(import.meta.url),a=req('@electron/asar'),h=b=>createHash('sha256').update(b).digest('hex'),stage='C:/Nori/.work/project-review-repair',target='C:/Program Files/Nori/resources/app.asar',work=stage+'/code-workspace';assert.ok(!existsSync(work));mkdirSync(work);const norm=n=>n.slice(1).replaceAll('\\','/');
const source=readFileSync(stage+'/local-chat.next.mjs'),beforeModule=readFileSync(stage+'/local-chat.installed.mjs'),receipt=JSON.parse(readFileSync(stage+'/fixture-results.json'));assert.equal(receipt.passed,true);assert.equal(receipt.rows.length,5);
const loose='C:/Program Files/Nori/resources/NoriSuite/apps/desktop/bridge/local-chat.mjs';assert.equal(h(readFileSync(loose)),h(beforeModule));
try{
 const names=a.listPackage(target),module=names.find(n=>norm(n)==='bridge/local-chat.mjs');assert.equal(h(a.extractFile(target,module.slice(1))),h(beforeModule));
 a.extractAll(target,work);writeFileSync(work+'/bridge/local-chat.mjs',source);await a.createPackage(work,stage+'/app.asar.next');
 const next=a.listPackage(stage+'/app.asar.next');assert.deepEqual(next,names);const changed=[];
 for(const n of names){const x=a.statFile(target,n.slice(1)),y=a.statFile(stage+'/app.asar.next',n.slice(1));for(const k of ['unpacked','executable','link'])assert.deepEqual(x[k],y[k]);if(x.files)continue;if(h(a.extractFile(target,n.slice(1)))!==h(a.extractFile(stage+'/app.asar.next',n.slice(1))))changed.push(norm(n))}
 assert.deepEqual(changed,['bridge/local-chat.mjs']);
 writeFileSync(stage+'/promotion-plan.json',JSON.stringify({verified:true,updates:[{target,source:stage+'/app.asar.next',before:h(readFileSync(target)),after:h(readFileSync(stage+'/app.asar.next'))},{target:loose,source:stage+'/local-chat.next.mjs',before:h(beforeModule),after:h(source)}],archiveChanges:changed,fixtureCases:5,modelsCopied:0,newRuntimeCreated:false},null,2));console.log(JSON.stringify({verified:true,archiveChanges:changed,updates:2,fixtureCases:5}));
}finally{assert.equal(realpathSync(work).toLowerCase(),resolve(work).toLowerCase());rmSync(work,{recursive:true})}
