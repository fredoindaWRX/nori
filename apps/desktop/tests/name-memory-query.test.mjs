import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync,renameSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {spawnSync} from 'node:child_process'

test('explicit name is saved before acknowledgement and recalled without inference',async t=>{
  const root=mkdtempSync(join(tmpdir(),'nori-name-memory-'))
  const changes={NORI_LEARNING_FILE:join(root,'learning.json'),NORI_SETTINGS_DIR:root,NORI_APP_DATA_ROOT:root}
  const previous=Object.fromEntries(Object.keys(changes).map(k=>[k,process.env[k]]))
  Object.assign(process.env,changes)
  t.after(()=>{for(const[k,v]of Object.entries(previous)){if(v===undefined)delete process.env[k];else process.env[k]=v}rmSync(root,{recursive:true})})
  const {query}=await import('../bridge/nori-v2-query.mjs')
  async function* prompt(){
    yield {message:{content:'my name si ana maria soto jr born in a city 1988 loves cars'}}
    yield {message:{content:'whats my name'}}
  }
  const results=[]
  for await(const event of query({prompt:prompt(),options:{getModel(){assert.fail('A saved-name lookup must not need model inference')}}}))
    if(event.type==='result')results.push(event)
  assert.equal(results.length,2)
  assert.equal(results[0].result,'I saved the name you provided: ana maria soto jr.')
  assert.equal(results[1].result,'You told me your name is ana maria soto jr.')
  const memory=JSON.parse(readFileSync(changes.NORI_LEARNING_FILE,'utf8'))
  assert.equal(memory.knowledge.length,1)
  assert.equal(memory.knowledge[0].text,'User-provided name: ana maria soto jr')
  assert.doesNotMatch(JSON.stringify(memory),/1988|loves cars|born in/)
  // A failed write must not claim a save or replace the prior in-memory name.
  renameSync(changes.NORI_LEARNING_FILE,changes.NORI_LEARNING_FILE+'.preserved')
  mkdirSync(changes.NORI_LEARNING_FILE)
  async function* failedSave(){
    yield {message:{content:'My name is Different Person'}}
    yield {message:{content:'whats my name'}}
  }
  const failureResults=[]
  for await(const event of query({prompt:failedSave(),options:{getModel(){assert.fail('No model needed')}}}))
    if(event.type==='result')failureResults.push(event)
  assert.equal(failureResults.length,2)
  assert.equal(failureResults[0].error_code,'NORI_MEMORY_SAVE_FAILED')
  assert.equal(failureResults[0].subtype,'error_during_execution')
  assert.notEqual(failureResults[0].subtype,'success')
  assert.match(failureResults[0].errors.join('\n'),/could not save.*local memory/i)
  assert.equal(failureResults[1].subtype,'success')
  assert.equal(failureResults[1].result,'You told me your name is ana maria soto jr.')
  rmSync(changes.NORI_LEARNING_FILE,{recursive:true})
  renameSync(changes.NORI_LEARNING_FILE+'.preserved',changes.NORI_LEARNING_FILE)
  const learning=new URL('../bridge/nori-learning.mjs',import.meta.url).href
  const helper=new URL('../bridge/personal-name.mjs',import.meta.url).href
  const restarted=spawnSync(process.execPath,['--input-type=module','-e',`import{listLearnedMemory}from ${JSON.stringify(learning)};import{savedNameAnswer}from ${JSON.stringify(helper)};console.log(savedNameAnswer('whats my name',listLearnedMemory().entries))`],{encoding:'utf8',env:process.env,windowsHide:true})
  assert.equal(restarted.status,0,restarted.stderr)
  assert.equal(restarted.stdout.trim(),'You told me your name is ana maria soto jr.')
})
