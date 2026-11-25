// Preserve subprocess output and terminal state for long local package builds.
import {spawn} from 'node:child_process'
import {openSync,closeSync,writeFileSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {nativePackageArguments} from './package-native-desktop.mjs'

const args=process.argv.slice(2),options=nativePackageArguments(args)
if(!options.candidate||!options.stageCandidate||options.selectCurrent)
  throw Error('Recorded builds require explicit candidate/stage and must stay unselected')
const appRoot=resolve(import.meta.dirname,'..')
const evidenceRoot=resolve(appRoot,'../../verification')
const prefix=join(evidenceRoot,`native-package-${options.candidate}`)
if(existsSync(`${prefix}.log`)||existsSync(`${prefix}.json`))throw Error('Existing build evidence preserved')
const log=openSync(`${prefix}.log`,'wx')
const started=new Date().toISOString()
const child=spawn(process.execPath,[join(import.meta.dirname,'package-native-desktop.mjs'),...args],
  {cwd:appRoot,shell:false,windowsHide:true,stdio:['ignore',log,log]})
closeSync(log)
let spawnError
child.on('error',error=>{spawnError=error.message})
child.on('close',(code,signal)=>{
  const report={candidate:options.candidate,stageCandidate:options.stageCandidate,
    started,finished:new Date().toISOString(),code,signal,spawnError,
    log:`${prefix}.log`,receiptExists:existsSync(join(appRoot,'release',
      `native-desktop-${options.candidate}`,'native-desktop-receipt.json')),
    selected:false,releaseVerified:false}
  writeFileSync(`${prefix}.json`,JSON.stringify(report,null,2)+'\n',{flag:'wx'})
  console.log(JSON.stringify(report))
  process.exitCode=code===0&&!signal&&!spawnError?0:1
})
console.log(JSON.stringify({candidate:options.candidate,pid:child.pid,log:`${prefix}.log`,started}))
