import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdirSync,copyFileSync,existsSync,writeFileSync,realpathSync,rmSync} from 'node:fs'
import {resolve} from 'node:path'
import {spawnSync} from 'node:child_process'
const asar=createRequire(import.meta.url)('@electron/asar')
const routing=process.argv.includes('--routing')||process.argv.includes('--routing-corrected')
const suffix=process.argv.includes('--routing-corrected')?'-routing-r2':routing?'-routing':process.argv.includes('--validated')?'-r5':process.argv.includes('--final')?'-r4':process.argv.includes('--context-fix')?'-r3':process.argv.includes('--retry')?'-r2':''
const root='C:/Nori/.work/staged-chat-regressions'+suffix,log='C:/Nori/.work/reports/staged-chat-regressions'+suffix+'.log'
assert.ok(!existsSync(root)&&!existsSync(log),'Existing evidence preserved')
mkdirSync(root)
try{
 asar.extractAll('C:/Nori/.work/model-team-integration/app.asar.next',root)
 copyFileSync('C:/Nori/.work/model-team-integration/patch/nori-identity.mjs',root+'/bridge/nori-identity.mjs')
 if(routing||process.argv.includes('--context-fix')||process.argv.includes('--final')||process.argv.includes('--validated')){
  copyFileSync('C:/Nori/.work/model-team-integration/patch/local-chat.mjs',root+'/bridge/local-chat.mjs')
  copyFileSync('C:/Nori/apps/desktop/bridge/son-status-output-guard.mjs',root+'/bridge/son-status-output-guard.mjs')
 }
 mkdirSync(root+'/tests');mkdirSync(root+'/src/scene',{recursive:true});mkdirSync(root+'/synthetic-state')
 copyFileSync('C:/Nori/apps/desktop/src/scene/neural-signals.ts',root+'/src/scene/neural-signals.ts')
 const tests=['nori-v2-query.test.mjs','local-chat.test.mjs',...(routing||process.argv.includes('--context-fix')||process.argv.includes('--final')||process.argv.includes('--validated')?['son-status-output-guard.test.mjs']:[]),...(routing?['automatic-text-bridge-routing.test.mjs']:[])]
 for(const name of tests)copyFileSync('C:/Nori/apps/desktop/tests/'+name,root+'/tests/'+name)
 const result=spawnSync(process.execPath,['--test','--test-concurrency=1',...tests.map(name=>root+'/tests/'+name)],{
  cwd:root,windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024,
  env:{...process.env,NORI_ROOT:root,NORI_APP_DATA_ROOT:root+'/synthetic-state',NORI_SETTINGS_DIR:root+'/synthetic-state',NORI_MENTOR_TOKEN:'',NORI_EMBEDDING_URL:'',NORI_EMBEDDING_API_KEY:''},
 })
 writeFileSync(log,(result.stdout||'')+(result.stderr||''),{flag:'wx'})
 console.log(JSON.stringify({exitCode:result.status,error:result.error?.message,log,installedAppChanged:false,scope:'staged archive with explicit identity/context corrections; synthetic loopback and isolated state; no live model'}))
 if(result.status!==0)process.exitCode=1
}finally{
 assert.equal(realpathSync(root).toLowerCase(),resolve(root).toLowerCase());rmSync(root,{recursive:true})
}
