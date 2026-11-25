import assert from 'node:assert/strict'
import{createRequire}from'node:module'
import{readFileSync,writeFileSync,mkdirSync,existsSync,rmSync,realpathSync,copyFileSync}from'node:fs'
import{dirname,resolve}from'node:path'
import{spawnSync}from'node:child_process'
const asar=createRequire(import.meta.url)('@electron/asar')
const root='C:/Nori/apps/desktop/.research-loop-context-verification'
const log='C:/Nori/.work/reports/research-chat-loop-context-integration.log'
assert.ok(!existsSync(root)&&!existsSync(log),'Existing evidence preserved')
mkdirSync(root)
try{
 let bytes=0,files=0
 const archive='C:/Program Files/Nori/resources/app.asar'
 for(const name of asar.listPackage(archive)){
  const path=name.slice(1).replaceAll('\\','/')
  if(!/^(bridge|desktop)\/.*\.(mjs|cjs|json)$/.test(path))continue
  const content=asar.extractFile(archive,name.slice(1));bytes+=content.length
  assert.ok(bytes<32*1024*1024,'Bounded code-only extraction')
  mkdirSync(dirname(root+'/'+path),{recursive:true});writeFileSync(root+'/'+path,content);files++
 }
 writeFileSync(root+'/package.json','{"type":"module"}')
 let chat=readFileSync('C:/Nori/.work/model-team-integration/patch/local-chat.mjs','utf8')
 chat+='\nexport {gptOssChat as _testResearchChatLoop}\n'
 writeFileSync(root+'/bridge/local-chat.mjs',chat)
 copyFileSync('C:/Nori/apps/desktop/bridge/research-tools.mjs',root+'/bridge/research-tools.mjs')
 mkdirSync(root+'/tests');mkdirSync(root+'/synthetic-state')
 for(const file of ['research-chat-loop.test.mjs','research-tools-scope.test.mjs'])copyFileSync('C:/Nori/apps/desktop/tests/'+file,root+'/tests/'+file)
 const result=spawnSync(process.execPath,['--test','--test-concurrency=1',root+'/tests/research-chat-loop.test.mjs',root+'/tests/research-tools-scope.test.mjs'],{encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:1024*1024,env:{...process.env,NORI_SETTINGS_DIR:root+'/synthetic-state',NORI_APP_DATA_ROOT:root+'/synthetic-state',NORI_MENTOR_TOKEN:'',NORI_EMBEDDING_URL:'',NORI_EMBEDDING_API_KEY:''}})
 writeFileSync(log,(result.stdout||'')+(result.stderr||''),{flag:'wx'})
 console.log(JSON.stringify({exitCode:result.status,error:result.error?.message,files,bytes,log,scope:'actual chat-loop function with controlled inference/worker responses, no live model or installed-app changes'}))
 process.exitCode=result.status===0?0:1
}finally{assert.equal(realpathSync(root).toLowerCase(),resolve(root).toLowerCase());rmSync(root,{recursive:true})}

