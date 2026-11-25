import test from 'node:test'
import assert from 'node:assert/strict'
import {searchSemanticMemory,semanticMemorySearchIntent} from '../bridge/semantic-memory.mjs'
const environment={NORI_EMBEDDING_URL:'http://127.0.0.1:18789',NORI_EMBEDDING_API_KEY:'a'.repeat(64)}
const embedding=axis=>Array.from({length:1024},(_,i)=>i===axis?1:0)
test('memory search is explicit and scoped',()=>{
  assert.equal(semanticMemorySearchIntent('Search your saved memories for cars'),'cars')
  assert.equal(semanticMemorySearchIntent('Explain how to search your saved memories for cars'),null)
  assert.equal(semanticMemorySearchIntent('Do not search your saved memories for cars'),null)
})
test('local search ranks saved entries, caches vectors, and forgets removed entries',async()=>{
  const entries=[{id:'test-car',text:'blue Subaru car',kind:'knowledge'},{id:'test-food',text:'cookie recipe',kind:'knowledge'}]
  const requests=[]
  const fetcher=async(url,options)=>{
    assert.equal(url,'http://127.0.0.1:18789/v1/embeddings')
    assert.equal(options.redirect,'error')
    assert.equal(options.headers.authorization,'Bearer '+environment.NORI_EMBEDDING_API_KEY)
    const texts=JSON.parse(options.body).input;requests.push(texts)
    return {ok:true,json:async()=>({data:texts.map((text,index)=>({index,embedding:embedding(text.includes('cookie')?1:0)}))})}
  }
  const snapshot=structuredClone(entries)
  const result=await searchSemanticMemory('car',entries,{environment,fetcher})
  assert.equal(result.matches[0].id,'test-car')
  assert.deepEqual(entries,snapshot)
  requests.length=0
  await searchSemanticMemory('car',entries,{environment,fetcher})
  assert.equal(requests.length,1,'second search must reuse cached document vectors')
  const removed=await searchSemanticMemory('car',[entries[1]],{environment,fetcher})
  assert.deepEqual(removed.matches.map(e=>e.id),['test-food'])
})
test('unconnected, non-owned, malformed and canceled searches fail explicitly',async()=>{
  await assert.rejects(searchSemanticMemory('car',[],{environment:{}}),/not connected/)
  await assert.rejects(searchSemanticMemory('car',[],{environment:{...environment,NORI_EMBEDDING_URL:'https://example.com'}}),/local/)
  await assert.rejects(searchSemanticMemory('car',[],{environment:{...environment,NORI_EMBEDDING_URL:'http://127.0.0.1:8000'}}),/owned/)
  await assert.rejects(searchSemanticMemory('car',[],{environment,fetcher:async()=>({ok:true,json:async()=>({data:[{index:0,embedding:[1]}]})})}),/invalid/)
  const controller=new AbortController();controller.abort()
  let called=false
  await assert.rejects(searchSemanticMemory('car',[],{environment,signal:controller.signal,fetcher:async()=>{called=true}}))
  assert.equal(called,false)
})
