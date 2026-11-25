/** Relocated speech package acceptance; fresh owned folder, synthetic audio. */
import {mkdirSync,mkdtempSync,readdirSync,lstatSync,rmSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {join,resolve,relative,isAbsolute} from 'node:path'
import {fileURLToPath} from 'node:url'
import assert from 'node:assert/strict'
import {verifiedCopy} from './verified-copy.mjs'
const root=fileURLToPath(new URL('../../../',import.meta.url))
const parent=join(root,'verification')
const target=mkdtempSync(join(parent,'.native-stt-relocation-probe-'))
let copied=0,receipt
function copyTree(source,destination){
  const info=lstatSync(source)
  if(info.isSymbolicLink())throw new Error('Linked package input refused')
  if(info.isDirectory()){
    mkdirSync(destination,{recursive:true})
    for(const name of readdirSync(source)){
      if(name==='__pycache__'||name.endsWith('.pyc'))continue
      copyTree(join(source,name),join(destination,name))
    }
  }else if(info.isFile()){verifiedCopy(source,destination);copied++}
  else throw new Error('Unsupported package file')
}
try{
  for(const name of ['python/Python311','runtime/stt/packages','runtime/stt/launch_worker.py',
    'models/voice/whisper-base.en','apps/desktop/bridge/whisper_stt.py'])
    copyTree(join(root,name),join(target,name))
  const python=join(target,'python/Python311/python.exe')
  const clip=join(root,'verification/voice-probes/local-kokoro-99105aa0-b71e-4873-9239-73293ffa86e5.wav')
  const result=spawnSync(python,['-I','-B',join(target,'runtime/stt/launch_worker.py')],{
    cwd:target,windowsHide:true,encoding:'utf8',input:clip+'\n',timeout:30000,maxBuffer:65536,
    env:{...process.env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'},
  })
  assert.equal(result.error,undefined)
  assert.equal(result.status,0,result.stderr)
  const messages=result.stdout.trim().split('\n').map(line=>JSON.parse(line))
  assert.equal(messages[0].ready,true)
  assert.equal(messages[0].model,join(target,'models/voice/whisper-base.en'))
  assert.match(messages[1].text,/speaking from the local Nori folder/i)
  receipt={passed:true,copiedFilesSha256Verified:copied,transcript:messages[1].text,
    relocatedInterpreter:true,relocatedWorkerAndModel:true,exit:result.status,
    microphoneUsed:false,installedSuiteVerified:false}
}finally{
  const delta=relative(parent,target)
  if(isAbsolute(delta)||delta.startsWith('..')||!delta.startsWith('.native-stt-relocation-probe-'))
    throw new Error('Unsafe owned cleanup target')
  rmSync(target,{recursive:true,force:true})
}
console.log(JSON.stringify({...receipt,ownedTemporaryPackageRemoved:true}))
