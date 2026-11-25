import assert from 'node:assert/strict'
import{createRequire}from'node:module'
import{copyFileSync,writeFileSync,mkdirSync,existsSync,rmSync,realpathSync}from'node:fs'
import{dirname,resolve}from'node:path'
import{spawnSync}from'node:child_process'
const asar=createRequire(import.meta.url)('@electron/asar')
const root='C:/Nori/apps/desktop/.research-surrounding-regressions',log='C:/Nori/.work/reports/research-package-surrounding-regressions.log'
assert.ok(!existsSync(root)&&!existsSync(log),'Existing evidence preserved')
mkdirSync(root)
try{
 const archive='C:/Nori/.work/research-repair/app.asar.next';let bytes=0
 for(const name of asar.listPackage(archive)){
  const path=name.slice(1).replaceAll('\\','/');if(!/^(bridge|desktop)\/.*\.(mjs|cjs|json)$/.test(path))continue
  const content=asar.extractFile(archive,name.slice(1));bytes+=content.length;assert.ok(bytes<32*1024*1024)
  mkdirSync(dirname(root+'/'+path),{recursive:true});writeFileSync(root+'/'+path,content)
 }
 writeFileSync(root+'/package.json','{"type":"module"}')
 mkdirSync(root+'/tests');mkdirSync(root+'/src/scene',{recursive:true});mkdirSync(root+'/synthetic-state')
 copyFileSync('C:/Nori/apps/desktop/src/scene/neural-signals.ts',root+'/src/scene/neural-signals.ts')
 const tests=['nori-v2-query.test.mjs','local-chat.test.mjs','son-status-output-guard.test.mjs','automatic-text-bridge-routing.test.mjs','skill-catalog-status.test.mjs','research-tools-scope.test.mjs']
 for(const name of tests)copyFileSync('C:/Nori/apps/desktop/tests/'+name,root+'/tests/'+name)
 const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...tests.map(name=>root+'/tests/'+name)],{encoding:'utf8',windowsHide:true,timeout:120000,maxBuffer:4*1024*1024,env:{...process.env,NORI_ROOT:root,NORI_SUITE_ROOT:'C:/Program Files/Nori/resources/NoriSuite',NORI_APP_DATA_ROOT:root+'/synthetic-state',NORI_SETTINGS_DIR:root+'/synthetic-state',NORI_MENTOR_TOKEN:'',NORI_EMBEDDING_URL:'',NORI_EMBEDDING_API_KEY:''}})
 writeFileSync(log,(result.stdout||'')+(result.stderr||''),{flag:'wx'});console.log(JSON.stringify({exitCode:result.status,error:result.error?.message,bytes,log,installedChanged:false,scope:'packaged chat/controller modules, controlled loopback/model fixtures, isolated state'}));process.exitCode=result.status===0?0:1
}finally{assert.equal(realpathSync(root).toLowerCase(),resolve(root).toLowerCase());rmSync(root,{recursive:true})}
