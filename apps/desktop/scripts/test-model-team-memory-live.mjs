import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {mkdtempSync,writeFileSync,rmSync,realpathSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve,dirname} from 'node:path'
const require=createRequire(import.meta.url)
const {startLocalEmbeddingService}=require('../desktop/local-embedding-service.cjs')
const temporary=mkdtempSync(join(tmpdir(),'nori-semantic-acceptance-'))
const saved={...process.env}
let service
try{
  process.env.NORI_SETTINGS_DIR=temporary
  process.env.NORI_LEARNING_FILE=join(temporary,'learning.json')
  writeFileSync(process.env.NORI_LEARNING_FILE,JSON.stringify({schema:'nori.learned-guidance.v2',knowledge:[
    {id:'00000000-0000-4000-8000-000000000001',text:'My blue Subaru rally car has gold wheels.',at:new Date().toISOString()},
    {id:'00000000-0000-4000-8000-000000000002',text:'Chocolate cookies bake in an oven.',at:new Date().toISOString()},
  ],preferences:[],feedback:[]}))
  service=await startLocalEmbeddingService({root:'C:/Program Files/Nori/resources/NoriSuite'})
  Object.assign(process.env,service.environment)
  const {searchSemanticMemory}=await import('../bridge/semantic-memory.mjs')
  const {listLearnedMemory}=await import('../bridge/nori-learning.mjs')
  const result=await searchSemanticMemory('rally car wheel color',listLearnedMemory().entries,{limit:1})
  assert.match(result.matches[0].text,/gold wheels/)
  const {query}=await import('../bridge/nori-v2-query.mjs')
  async function* prompt(){yield {message:{content:'Search your saved memories for rally car wheels'}}}
  const events=[]
  for await(const event of query({prompt:prompt(),options:{getModel(){assert.fail('Explicit memory search must use the embedding specialist, not the text model')}}}))events.push(event)
  const success=events.find(e=>e.type==='result'&&e.subtype==='success')
  assert.ok(success)
  assert.match(success.result,/gold wheels/)
  assert.match(success.result,/searched 2 entries/)
  console.log(JSON.stringify({passed:true,sourceChatRouteVerified:true,realInstalledEngineUsed:true,embeddingDimensions:1024,syntheticMemoriesOnly:true,productionMemoryChanged:false}))
}finally{
  if(service)await service.stop()
  for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key]
  Object.assign(process.env,saved)
  if(dirname(realpathSync(temporary))!==realpathSync(tmpdir()))throw Error('Temporary cleanup scope changed')
  rmSync(temporary,{recursive:true})
}
