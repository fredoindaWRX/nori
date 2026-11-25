import assert from 'node:assert/strict'
import{createRequire}from'node:module'
import{createHash}from'node:crypto'
import{readFileSync,writeFileSync,copyFileSync,mkdirSync,existsSync,rmSync,realpathSync}from'node:fs'
import{resolve}from'node:path'
import{spawnSync}from'node:child_process'
const asar=createRequire(import.meta.url)('@electron/asar'),hash=x=>createHash('sha256').update(x).digest('hex')
const stage='C:/Nori/.work/research-repair',archive='C:/Program Files/Nori/resources/app.asar'
const work='C:/Nori/apps/desktop/.research-package-verification'
const before=hash(readFileSync(archive));assert.equal(before,'dd0dc8915f784dcd15c87ceb0d6d95b8902a431fb1ac31a93c872b9baaaddde8')
assert.ok(!existsSync(work)&&!existsSync(stage+'/app.asar.next')&&!existsSync(stage+'/combined-plan.json'),'Existing stage preserved')
const sources=new Map([
 ['bridge/local-chat.mjs','C:/Nori/.work/model-team-integration/patch/local-chat.mjs'],
 ['bridge/research-tools.mjs','C:/Nori/apps/desktop/bridge/research-tools.mjs'],
 ['bridge/skill-catalog-status.mjs','C:/Nori/apps/desktop/bridge/skill-catalog-status.mjs'],
])
mkdirSync(work)
try{
 asar.extractAll(archive,work)
 for(const[path,input]of sources)copyFileSync(input,work+'/'+path)
 // Export the private loop only while exercising the actual implementation.
 const chat=readFileSync(work+'/bridge/local-chat.mjs','utf8')
 writeFileSync(work+'/bridge/local-chat.mjs',chat+'\nexport {gptOssChat as _testResearchChatLoop}\n')
 mkdirSync(work+'/tests');mkdirSync(work+'/synthetic-state')
 const tests=['research-chat-loop.test.mjs','research-tools-scope.test.mjs','skill-catalog-status.test.mjs']
 for(const name of tests)copyFileSync('C:/Nori/apps/desktop/tests/'+name,work+'/tests/'+name)
 const test=spawnSync(process.execPath,['--test','--test-concurrency=1',...tests.map(name=>work+'/tests/'+name)],{windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:1024*1024,env:{...process.env,NORI_SETTINGS_DIR:work+'/synthetic-state',NORI_APP_DATA_ROOT:work+'/synthetic-state',NORI_MENTOR_TOKEN:'',NORI_EMBEDDING_URL:'',NORI_EMBEDDING_API_KEY:''}})
 writeFileSync(stage+'/combined-package-tests.log',(test.stdout||'')+(test.stderr||''),{flag:'wx'});assert.equal(test.status,0,'Packaged module tests failed')
 writeFileSync(work+'/bridge/local-chat.mjs',chat)
 for(const child of ['tests','synthetic-state']){const path=resolve(work,child);assert.ok(path.startsWith(resolve(work)));rmSync(path,{recursive:true})}
 await asar.createPackage(work,stage+'/app.asar.next')
 const oldNames=asar.listPackage(archive),newNames=asar.listPackage(stage+'/app.asar.next');assert.deepEqual(newNames,oldNames,'Package inventory changed')
 const changed=[]
 for(const name of oldNames){const relative=name.slice(1).replaceAll('\\','/');if(asar.statFile(archive,name.slice(1)).files)continue
  const old=asar.extractFile(archive,name.slice(1)),fresh=asar.extractFile(stage+'/app.asar.next',name.slice(1))
  if(hash(old)!==hash(fresh)){assert.ok(sources.has(relative),'Unexpected package byte changes: '+relative);assert.equal(hash(fresh),hash(readFileSync(sources.get(relative))));changed.push(relative)}
 }
 assert.equal(changed.length,3)
 const pythonPlan=JSON.parse(readFileSync(stage+'/plan.json'));const updates=[...pythonPlan.updates]
 updates.push({target:archive,source:stage+'/app.asar.next',before,after:hash(readFileSync(stage+'/app.asar.next'))})
 mkdirSync(stage+'/bridge')
 for(const[path,input]of sources){const name=path.split('/').at(-1),source=stage+'/bridge/'+name,target='C:/Program Files/Nori/resources/NoriSuite/apps/desktop/'+path;copyFileSync(input,source);updates.push({target,source,before:existsSync(target)?hash(readFileSync(target)):null,after:hash(readFileSync(source))})}
 writeFileSync(stage+'/combined-plan.json',JSON.stringify({schema:'nori.research-catalog-repair.v1',updates,archiveChanges:changed,packagedTests:13,pythonTests:25,modelsCopied:0,newRuntimeCreated:false},null,2),{flag:'wx'})
 console.log(JSON.stringify({verified:true,updates:updates.length,archiveChanges:changed,packagedTests:13,pythonTests:25,installedAppChanged:false}))
}finally{assert.equal(realpathSync(work).toLowerCase(),resolve(work).toLowerCase());rmSync(work,{recursive:true})}
