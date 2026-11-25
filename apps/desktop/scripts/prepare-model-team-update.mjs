import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createHash} from 'node:crypto'
import {existsSync,readFileSync,writeFileSync,mkdirSync,copyFileSync,rmSync,realpathSync,statfsSync} from 'node:fs'
import {join,dirname,resolve,sep} from 'node:path'
import {spawnSync} from 'node:child_process'
const asar=createRequire(import.meta.url)('@electron/asar')
const stage='C:/Nori/.work/model-team-integration'
const installed='C:/Program Files/Nori'
const archive=installed+'/resources/app.asar'
const next=stage+'/app.asar.next',workspace=stage+'/code-workspace'
const hash=b=>createHash('sha256').update(b).digest('hex')
const before=hash(readFileSync(archive))
assert.equal(before,'09af6447e4956e0f85da2c7d67d64b6d3b72278564cb272e3200806089c6a761')
assert.ok(!existsSync(next)&&!existsSync(workspace)&&!existsSync(stage+'/update-plan.json'),'Existing stage preserved')
const disk=statfsSync('C:/');assert.ok(Number(disk.bavail)*Number(disk.bsize)>100*1024**3,'Storage guardrail')
const source='C:/Nori/apps/desktop'
const changes=new Map()
for(const [path,input]of[
 ['desktop/main.cjs',stage+'/patch/main.cjs'],
 ['desktop/gpt-oss-service.cjs',stage+'/patch/gpt-oss-service.cjs'],
 ['desktop/native-model-status.cjs',stage+'/patch/native-model-status.cjs'],
 ['desktop/imported-model-profile.cjs',source+'/desktop/imported-model-profile.cjs'],
 ['desktop/local-embedding-service.cjs',source+'/desktop/local-embedding-service.cjs'],
 ['desktop/local-model-port.cjs',source+'/desktop/local-model-port.cjs'],
 ['desktop/task-model-router.cjs',source+'/desktop/task-model-router.cjs'],
 ['desktop/automatic-text-service.cjs',source+'/desktop/automatic-text-service.cjs'],
 ['desktop/model-resource-fit.cjs',source+'/desktop/model-resource-fit.cjs'],
 ['desktop/video-runtime-cleanup.cjs',source+'/desktop/video-runtime-cleanup.cjs'],
 ['desktop/video-model-lease.cjs',source+'/desktop/video-model-lease.cjs'],
 ['desktop/video-capable-model.cjs',source+'/desktop/video-capable-model.cjs'],
 ['bridge/local-image.mjs',stage+'/patch/local-image.mjs'],
 ['bridge/video-model-lease.mjs',source+'/bridge/video-model-lease.mjs'],
 ['bridge/cinematic-video-profile.mjs',source+'/bridge/cinematic-video-profile.mjs'],
 ['bridge/local-chat.mjs',stage+'/patch/local-chat.mjs'],
 ['bridge/nori-identity.mjs',stage+'/patch/nori-identity.mjs'],
 ['bridge/son-status-output-guard.mjs',stage+'/patch/son-status-output-guard.mjs'],
 ['bridge/nori-v2-query.mjs',stage+'/patch/nori-v2-query.mjs'],
 ['bridge/aider-tools.mjs',stage+'/patch/aider-tools.mjs'],
 ['bridge/imported-chat-selection.mjs',source+'/bridge/imported-chat-selection.mjs'],
 ['bridge/semantic-memory.mjs',source+'/bridge/semantic-memory.mjs'],
 ['bridge/whisper.mjs',source+'/bridge/whisper.mjs'],
 ['bridge/parakeet_stt.py',source+'/bridge/parakeet_stt.py'],
])changes.set(path,readFileSync(input))
const rendererPatch=JSON.parse(readFileSync(stage+'/renderer-patch.json','utf8'))
assert.match(rendererPatch.path,/^dist\/assets\/index-[A-Za-z0-9_-]+\.js$/)
changes.set(rendererPatch.path,readFileSync(rendererPatch.source))
let artcraft=asar.extractFile(archive,'bridge/artcraft-tools.mjs').toString()
const negative="don't|dont|never|avoid|without"
assert.equal(artcraft.split(negative).length,3,'Installed negation routing changed')
changes.set('bridge/artcraft-tools.mjs',Buffer.from(artcraft.replaceAll(negative,negative+'|no')))
mkdirSync(workspace)
try{
 asar.extractAll(archive,workspace)
 for(const[path,bytes]of changes){mkdirSync(dirname(join(workspace,path)),{recursive:true});writeFileSync(join(workspace,path),bytes)}
 const harness=join(workspace,'.acceptance');mkdirSync(harness)
 assert.ok(!existsSync(join(workspace,'src')),'Preserve existing package sources')
 mkdirSync(join(workspace,'src','scene'),{recursive:true})
 copyFileSync(join(source,'src','scene','neural-signals.ts'),join(workspace,'src','scene','neural-signals.ts'))
 const tests=['model-team.test.cjs','model-team-bindings.test.mjs','semantic-memory.test.mjs','image-intent.test.mjs','skill-catalog-status.test.mjs','skill-installer-query.test.mjs','whisper-lifecycle.test.mjs','packaged-stt-worker.test.mjs','model-routing-ui.test.mjs','task-model-router.test.cjs','automatic-text-service.test.cjs','model-resource-fit.test.cjs','automatic-text-video-handoff.test.cjs','image-model-handoff.test.mjs','video-local-handoff.test.cjs','video-model-lease.test.cjs','cinematic-video-profile.test.mjs']
 tests.push('nori-v2-query.test.mjs','local-chat.test.mjs','son-status-output-guard.test.mjs','automatic-text-bridge-routing.test.mjs')
 for(const test of tests)copyFileSync(join(source,'tests',test),join(harness,test))
 mkdirSync(join(harness,'synthetic-state'))
 const checked=spawnSync(process.execPath,['--test','--test-concurrency=1',...tests.map(t=>join(harness,t))],{cwd:workspace,windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:1024*1024,env:{...process.env,NORI_SUITE_ROOT:installed+'/resources/NoriSuite',NORI_ROOT:workspace,NORI_APP_DATA_ROOT:join(harness,'synthetic-state'),NORI_SETTINGS_DIR:join(harness,'synthetic-state'),NORI_MENTOR_TOKEN:'',NORI_EMBEDDING_URL:'',NORI_EMBEDDING_API_KEY:''}})
 writeFileSync(stage+'/package-tests.log',(checked.stdout||'')+(checked.stderr||''))
 assert.equal(checked.status,0,checked.stdout||checked.stderr)
 const testOutput=(checked.stdout||'')+(checked.stderr||'')
 const testsPassed=Number(testOutput.match(/(?:#|ℹ) pass (\d+)/)?.[1])
 const testsTotal=Number(testOutput.match(/(?:#|ℹ) tests (\d+)/)?.[1])
 assert.ok(testsPassed>0&&testsPassed===testsTotal,'Complete passing test count required')
 assert.equal(realpathSync(harness).toLowerCase(),resolve(workspace,'.acceptance').toLowerCase());rmSync(harness,{recursive:true})
 assert.equal(realpathSync(join(workspace,'src')).toLowerCase(),resolve(workspace,'src').toLowerCase());rmSync(join(workspace,'src'),{recursive:true})
 for(const path of changes.keys()){
  const syntax=path.endsWith('.py')
   ? spawnSync(installed+'/resources/NoriSuite/python/Python311/python.exe',['-I','-B','-c','import ast,sys;ast.parse(open(sys.argv[1],encoding="utf-8").read())',join(workspace,path)],{windowsHide:true,encoding:'utf8'})
   : spawnSync(process.execPath,['--check',join(workspace,path)],{windowsHide:true,encoding:'utf8'})
  assert.equal(syntax.status,0,syntax.stderr)
 }
 await asar.createPackage(workspace,next)
 const files=p=>asar.listPackage(p).map(n=>n.replace(/^[/\\]/,'')).filter(n=>!asar.statFile(p,n,false).files).map(n=>n.replaceAll('\\','/'))
 const bytesOf=(path,file)=>{
  const native=file.split('/').join(sep),info=asar.statFile(path,native,false)
  return info.link?Buffer.from('asar-link:'+info.link):asar.extractFile(path,native)
 }
 const old=files(archive),fresh=files(next),verified=[]
 for(const file of new Set([...old,...fresh])){
  assert.ok(fresh.includes(file),'Existing file removed: '+file)
  const bytes=bytesOf(next,file)
  if(old.includes(file)&&bytes.equals(bytesOf(archive,file)))continue
  assert.ok(changes.has(file),'Unexpected package change: '+file)
  assert.equal(hash(bytes),hash(changes.get(file)))
  verified.push(file)
 }
 assert.deepEqual(verified.sort(),[...changes.keys()].sort())
 const updates=[]
 const record=(target,input)=>updates.push({target,source:input,before:existsSync(target)?hash(readFileSync(target)):null,after:hash(readFileSync(input))})
 record(archive,next)
 const mirrors=stage+'/mirrors'
 for(const[path,bytes]of changes){if(path.startsWith('dist/'))continue;const input=join(mirrors,path);mkdirSync(dirname(input),{recursive:true});writeFileSync(input,bytes);record(installed+'/resources/NoriSuite/apps/desktop/'+path,input)}
 const coder=JSON.parse(readFileSync('C:/Nori/.work/same-app-aider-contract-update/plan.json','utf8').replace(/^\uFEFF/,''))
 for(const file of coder.files){assert.equal(hash(readFileSync(file.target)).toUpperCase(),file.before);assert.equal(hash(readFileSync(file.source)).toUpperCase(),file.after);record(file.target,file.source)}
 assert.equal(hash(readFileSync(archive)),before,'Installed app changed during preparation')
 const plan={schema:'nori.model-team.same-app-update.v1',installedRoot:installed,archiveBefore:before,archiveAfter:hash(readFileSync(next)),updates,changedModules:verified,verifiedPackageFiles:fresh.length,testExitCode:checked.status,testsPassed,modelsCopied:0,newRuntimeCreated:false,installed:false}
 writeFileSync(stage+'/update-plan.json',JSON.stringify(plan,null,2))
 console.log(JSON.stringify({staged:true,changedModules:verified,updateFiles:updates.length,packageTestsPassed:true,modelsCopied:0,installed:false}))
}finally{
 assert.equal(realpathSync(workspace).toLowerCase(),resolve(stage,'code-workspace').toLowerCase());rmSync(workspace,{recursive:true})
}
