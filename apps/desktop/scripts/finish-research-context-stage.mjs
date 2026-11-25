import assert from 'node:assert/strict'
import{createRequire}from'node:module'
import{createHash}from'node:crypto'
import{readFileSync,writeFileSync,copyFileSync}from'node:fs'
const a=createRequire(import.meta.url)('@electron/asar'),h=x=>createHash('sha256').update(x).digest('hex')
const stage='C:/Nori/.work/research-repair',old='C:/Program Files/Nori/resources/app.asar',fresh=stage+'/app.asar.next'
const changes=new Map([['bridge/local-chat.mjs','C:/Nori/.work/model-team-integration/patch/local-chat.mjs'],['bridge/research-tools.mjs','C:/Nori/apps/desktop/bridge/research-tools.mjs'],['bridge/skill-catalog-status.mjs','C:/Nori/apps/desktop/bridge/skill-catalog-status.mjs']])
assert.equal(h(readFileSync(old)),'dd0dc8915f784dcd15c87ceb0d6d95b8902a431fb1ac31a93c872b9baaaddde8')
assert.deepEqual(a.listPackage(old),a.listPackage(fresh));let changed=0,entries=0
for(const name of a.listPackage(old)){
 const x=a.statFile(old,name.slice(1)),y=a.statFile(fresh,name.slice(1));for(const k of ['unpacked','executable','link'])assert.deepEqual(x[k],y[k]);entries++
 if(x.files)continue
 const path=name.slice(1).replaceAll('\\','/'),before=a.extractFile(old,name.slice(1)),after=a.extractFile(fresh,name.slice(1))
 if(h(before)!==h(after)){assert.ok(changes.has(path));assert.equal(h(after),h(readFileSync(changes.get(path))));changed++}
}
assert.equal(changed,3);assert.match(readFileSync(stage+'/combined-package-tests.log','utf8'),/pass 13/)
const updates=JSON.parse(readFileSync(stage+'/plan.json')).updates
updates.push({target:old,source:fresh,before:h(readFileSync(old)),after:h(readFileSync(fresh))})
for(const[path,input]of changes){const name=path.split('/').at(-1),source=stage+'/bridge/'+name,target='C:/Program Files/Nori/resources/NoriSuite/apps/desktop/'+path;copyFileSync(input,source);updates.push({target,source,before:h(readFileSync(target)),after:h(readFileSync(source))})}
writeFileSync(stage+'/combined-plan.json',JSON.stringify({schema:'nori.research-catalog-repair.v1',updates,archiveChanges:[...changes.keys()],packagedTests:13,pythonTests:25,modelsCopied:0,newRuntimeCreated:false},null,2),{flag:'wx'})
console.log(JSON.stringify({verified:true,files:updates.length,packagedTests:13,metadataEntries:entries}))
