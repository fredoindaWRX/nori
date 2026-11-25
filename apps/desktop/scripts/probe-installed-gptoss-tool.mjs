// Run using the installed Nori executable with ELECTRON_RUN_AS_NODE=1.
// Defaults to installed code/runtime and an isolated synthetic workspace.
// Explicit source/staged bridge modes report their narrower validation scope.
import {createRequire} from 'node:module'
import {pathToFileURL} from 'node:url'
import {join,resolve} from 'node:path'
import {mkdtempSync,existsSync,statSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'

const installed='C:\\Program Files\\Nori'
if(process.execPath.toLowerCase()!==join(installed,'Nori.exe').toLowerCase())throw Error('Use the installed Nori executable, not source Node')
const resources=join(installed,'resources'),suite=join(resources,'NoriSuite'),archive=join(resources,'app.asar')
const require=createRequire(pathToFileURL(join(archive,'desktop/main.cjs')))
const {startGptOssService}=require('./gpt-oss-service.cjs')
const workspace=mkdtempSync(join(tmpdir(),'nori-installed-tool-'))
const report={schema:'nori.installed-gptoss-tool-probe.v1',installedExecutable:process.execPath,packagedCode:true,syntheticOnly:true,uiVerified:false,passed:false}
const documentProbe=process.argv.includes('--wordcraft')
const sourceBridge=process.argv.includes('--source-bridge')
const stagedBridge=process.argv.includes('--staged-bridge')
if(sourceBridge&&stagedBridge)throw Error('Choose only one bridge source')
const bridgeArchive=stagedBridge?resolve(import.meta.dirname,'../../../verification/tool-routing-shell-refresh/win-unpacked/resources/app.asar'):archive
report.packagedCode=!sourceBridge
report.bridgeSource=sourceBridge?'source':stagedBridge?'staged-package':'installed-package'
report.installedCode=!sourceBridge&&!stagedBridge
report.app=documentProbe?'wordcraft':'vectorcraft'
let service
try{
  Object.assign(process.env,{NORI_ROOT:suite,NORI_APP_DATA_ROOT:workspace,NORI_INFERENCE_RUNTIME:'gpt-oss',NORI_GPT_OSS_ENABLED:'1',NORI_GPT_OSS_HERETIC:'0',NORI_GPT_OSS_SERVER_MODEL:'gpt-oss-20b',NORI_GPT_OSS_CONTEXT_TOKENS:'8192'})
  const {localChat}=await import(sourceBridge?new URL('../bridge/local-chat.mjs',import.meta.url).href:
    pathToFileURL(join(bridgeArchive,'bridge/local-chat.mjs')).href)
  service=await startGptOssService({root:suite,contextTokens:8192})
  report.contextTokens=8192
  process.env.NORI_GPT_OSS_URL=service.endpoint
  report.runtime=service.status
  const filename=documentProbe?'installed-nori-tool-proof.docx':'installed-nori-tool-proof.svg',response=[]
  const goal=documentProbe?`Use WordCraft to create a document containing exactly this sentence: Nori local document proof 4827. Save it as ${filename}.`:
    `Use VectorCraft to create a 240x160 SVG with a dark blue rectangle and a gold circle. Save it as ${filename}.`
  for await(const part of localChat({goal,turns:[],profile:'balanced',modelSelection:'gpt-oss:20b'}))response.push(String(part))
  report.response=response.join('').slice(-4000)
  const output=join(workspace,`integrations/artcraft/workspaces/app-sandboxes/${report.app}/outputs`,filename)
  if(!existsSync(output)||!statSync(output).isFile())throw Error('Installed chat did not create the requested artifact')
  const bytes=readFileSync(output),text=bytes.toString('utf8')
  report.artifactPreview=documentProbe?undefined:text.slice(0,3000)
  report.response=response.join('').slice(-2000)
  const drawables=[...text.matchAll(/<(?:path|circle|rect|ellipse)\b/gi)]
  if(documentProbe){
    const content=execFileSync(join(suite,'python/Python311/python.exe'),['-I','-B','-c',
      'import sys,zipfile,xml.etree.ElementTree as E; z=zipfile.ZipFile(sys.argv[1]); r=E.fromstring(z.read("word/document.xml")); print("".join(r.itertext()))',output],{encoding:'utf8',windowsHide:true,timeout:10000})
    if(content.trim()!=='Nori local document proof 4827.')throw Error('Saved document text does not match the requested sentence: '+content.slice(0,300))
    report.documentTextVerified=true
  }else if(!/<svg\b[^>]*width="240"[^>]*height="160"/.test(text)||drawables.length<2||!/#00008b/i.test(text)||!/#ffd700/i.test(text))throw Error('Artifact does not preserve the requested canvas, two shapes, and colors')
  report.artifactBytes=bytes.length
  report.artifactSha256=createHash('sha256').update(bytes).digest('hex')
  report.response=response.join('').slice(-2000)
  report.passed=true
}catch(error){report.error=String(error.stack??error).slice(0,4000)}
finally{
  if(service){try{await service.stop();report.runtimeStopped=true}catch(error){report.runtimeStopped=false;report.cleanupError=String(error.message)}}
  else report.runtimeStopped=true
  if(resolve(workspace).startsWith(resolve(tmpdir())+'\\')&&workspace.includes('nori-installed-tool-'))rmSync(workspace,{recursive:true,force:true})
  report.workspaceRemoved=!existsSync(workspace)
}
console.log(JSON.stringify(report))
if(!report.passed||!report.runtimeStopped||!report.workspaceRemoved)process.exitCode=1
