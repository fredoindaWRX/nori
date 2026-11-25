import {createHash} from 'node:crypto'
import {mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {localEndpoint,localFetch} from './local-policy.mjs'

export function semanticMemorySearchIntent(text){
  if(typeof text!=='string')return null
  const match=text.trim().match(/^(?:please\s+)?(?:search|find\s+in)\s+(?:my|your|nori'?s|our)\s+(?:saved\s+)?memor(?:y|ies)\s+(?:for|about)\s+(.{1,512})[.!?]?$/i)
  return match?match[1].trim():null
}
const cache=new Map()
function vector(value){
  if(!Array.isArray(value)||value.length!==1024||value.some(n=>typeof n!=='number'||!Number.isFinite(n)))throw Error('Local embedding result is invalid')
  if(value.every(n=>n===0))throw Error('Local embedding returned a zero vector')
  return value
}
function similarity(a,b){let dot=0,aa=0,bb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];aa+=a[i]*a[i];bb+=b[i]*b[i]}return dot/Math.sqrt(aa*bb)}
export async function searchSemanticMemory(query,entries,{environment=process.env,fetcher=localFetch,signal,limit=6}={}){
  if(typeof query!=='string'||!query.trim()||query.length>512||!Array.isArray(entries)||entries.length>3000||!Number.isInteger(limit)||limit<1||limit>12)throw Error('Invalid bounded memory search')
  if(!environment.NORI_EMBEDDING_URL||!/^[a-f0-9]{64}$/.test(environment.NORI_EMBEDDING_API_KEY??''))throw Error('Nori’s local semantic-memory model is not connected')
  const url=localEndpoint('NORI_EMBEDDING_URL',environment.NORI_EMBEDDING_URL,'')
  if(url!=='http://127.0.0.1:18789')throw Error('Semantic memory must use the owned local worker')
  const normalized=entries.map(entry=>{
    if(typeof entry?.id!=='string'||typeof entry.text!=='string'||!entry.text.length||entry.text.length>2000)throw Error('Invalid memory search entry')
    return {...entry,key:createHash('sha256').update(entry.id+'\0'+entry.text).digest('hex')}
  })
  // Forget vectors of removed memories, but keep the ones cue recall still uses (history, journal).
  const live=new Set([...normalized.map(e=>e.key),...cueKeys]);for(const key of cache.keys())if(!live.has(key))cache.delete(key)
  const embed=async texts=>{
    signal?.throwIfAborted()
    const response=await fetcher(url+'/v1/embeddings',{method:'POST',redirect:'error',headers:{authorization:'Bearer '+environment.NORI_EMBEDDING_API_KEY,'content-type':'application/json'},body:JSON.stringify({model:'nori-memory-embedding',input:texts}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)})
    if(!response.ok)throw Error('Local semantic-memory inference failed')
    const result=await response.json()
    if(!Array.isArray(result.data)||result.data.length!==texts.length||new Set(result.data.map(e=>e.index)).size!==texts.length)throw Error('Local embedding response count mismatch')
    return result.data.sort((a,b)=>a.index-b.index).map((entry,index)=>{if(entry.index!==index)throw Error('Invalid embedding result index');return vector(entry.embedding)})
  }
  const missing=normalized.filter(e=>!cache.has(e.key))
  for(let i=0;i<missing.length;i+=4){const batch=missing.slice(i,i+4),vectors=await embed(batch.map(e=>e.text));batch.forEach((entry,index)=>cache.set(entry.key,vectors[index]))}
  const [needle]=await embed([QUERY_PREFIX+query])
  return {model:'qwen3-embedding-0.6b',searchedEntries:normalized.length,matches:normalized.map(e=>({id:e.id,text:e.text,kind:e.kind,score:similarity(needle,cache.get(e.key))})).sort((a,b)=>b.score-a.score).slice(0,limit)}
}
const QUERY_PREFIX='Instruct: Retrieve saved personal memories relevant to the question.\nQuery: '

// Cue recall (Wil, 2026-11-13): every message is a retrieval cue, like a word
// someone says that brings a forgotten memory back. Saved entries whose meaning
// is close to the message surface automatically, even with no shared words.
// Calibrated on qwen3-embedding-0.6b: related cues scored 0.34-0.65, unrelated
// questions at most 0.30. It never throws and never delays a reply past its
// budget: no worker, slow worker or any error means no cue matches this turn.
// Entry vectors are filled in the background so later turns only embed the cue.
export const CUE_MIN_SCORE=0.33
const SLOW_BACKOFF_MS=10*60*1000
let warming=null,slowUntil=0,cueKeys=new Set()
function cueConnection(environment){
  if(!environment.NORI_EMBEDDING_URL||!/^[a-f0-9]{64}$/.test(environment.NORI_EMBEDDING_API_KEY??''))return null
  try{const url=localEndpoint('NORI_EMBEDDING_URL',environment.NORI_EMBEDDING_URL,'');return url==='http://127.0.0.1:18789'?url:null}catch{return null}
}
async function embedTexts(url,environment,fetcher,texts,signal){
  const response=await fetcher(url+'/v1/embeddings',{method:'POST',redirect:'error',headers:{authorization:'Bearer '+environment.NORI_EMBEDDING_API_KEY,'content-type':'application/json'},body:JSON.stringify({model:'nori-memory-embedding',input:texts}),signal})
  if(!response.ok)throw Error('Local semantic-memory inference failed')
  const result=await response.json()
  if(!Array.isArray(result.data)||result.data.length!==texts.length||new Set(result.data.map(e=>e.index)).size!==texts.length)throw Error('Local embedding response count mismatch')
  return result.data.sort((a,b)=>a.index-b.index).map((entry,index)=>{if(entry.index!==index)throw Error('Invalid embedding result index');return vector(entry.embedding)})
}
function keyed(entries){
  return entries.filter(e=>typeof e?.id==='string'&&typeof e.text==='string'&&e.text.length&&e.text.length<=2000).slice(-3000)
    .map(e=>({...e,key:createHash('sha256').update(e.id+'\0'+e.text).digest('hex')}))
}
// Entry vectors survive restarts in <data>/learning/cue-vectors.json (float32, base64),
// so a restart does not spend ~1.5 min re-embedding her history. Only vectors for
// entries that still exist are written back; a model change invalidates the file.
const VECTOR_MODEL='qwen3-embedding-0.6b-Q8_0'
let diskLoaded=false,diskStale=false
function vectorFile(environment){return environment.NORI_APP_DATA_ROOT?join(environment.NORI_APP_DATA_ROOT,'learning','cue-vectors.json'):null}
function loadDiskVectors(environment){
  if(diskLoaded)return;diskLoaded=true
  const file=vectorFile(environment);if(!file)return
  try{
    const saved=JSON.parse(readFileSync(file,'utf8'))
    if(saved?.model!==VECTOR_MODEL||typeof saved.vectors!=='object')return
    for(const [key,b64] of Object.entries(saved.vectors)){
      if(!cueKeys.has(key)){diskStale=true;continue}
      if(!/^[a-f0-9]{64}$/.test(key)||typeof b64!=='string'||cache.has(key))continue
      const bytes=Buffer.from(b64,'base64');if(bytes.length!==4096)continue
      cache.set(key,Array.from(new Float32Array(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+4096))))
    }
  }catch{}
}
function saveDiskVectors(environment,entries){
  const file=vectorFile(environment);if(!file)return
  try{
    const vectors={};for(const e of entries){const v=cache.get(e.key);if(v)vectors[e.key]=Buffer.from(new Float32Array(v).buffer).toString('base64')}
    mkdirSync(dirname(file),{recursive:true});writeFileSync(file+'.tmp',JSON.stringify({model:VECTOR_MODEL,vectors}));renameSync(file+'.tmp',file)
  }catch{}
}
// Short labels for her face (owner, 2026-11-15: "show labels"): kind, day and the first words of each memory,
// keyed like the vectors. Stays in her own learning folder; the app withholds it from the page while streaming.
const LABEL_KINDS={history:'Conversation',journal:'Journal',knowledge:'Knowledge',feedback:'Lesson',preference:'Preference'}
let labelStamp=''
export function memoryLabel(e){
  const day=String(e.day||e.at||'').slice(0,10)
  let title=e.kind==='history'&&typeof e.request==='string'?e.request:String(e.text||'')
  title=title.replace(/^From Nori's journal, [0-9-]+:\s*/,'').replace(/^User-provided name:\s*/,'Name: ').replace(/\s+/g,' ').trim()
  if(title.length>72)title=title.slice(0,71).trimEnd()+'\u2026'
  return{kind:LABEL_KINDS[e.kind]||e.label||'Memory',day:/^\d{4}-\d{2}-\d{2}$/.test(day)?day:'',title}
}
function saveLabels(environment,entries){
  const file=vectorFile(environment);if(!file)return
  const stamp=entries.length+':'+(entries[0]?.key||'')+':'+(entries[entries.length-1]?.key||'')
  if(stamp===labelStamp)return
  try{
    const labels={};for(const e of entries)labels[e.key.slice(0,12)]=memoryLabel(e)
    const out=join(dirname(file),'cue-labels.json')
    mkdirSync(dirname(out),{recursive:true});writeFileSync(out+'.tmp',JSON.stringify({schema:'nori.memory-labels.v1',labels}));renameSync(out+'.tmp',out)
    labelStamp=stamp
  }catch{}
}
function warmCueVectors(url,environment,fetcher,entries){
  if(warming)return warming
  const missing=entries.filter(e=>!cache.has(e.key))
  if(!missing.length)return null
  warming=(async()=>{
    for(let i=0;i<missing.length;i+=4){
      const batch=missing.slice(i,i+4)
      const vectors=await embedTexts(url,environment,fetcher,batch.map(e=>e.text),AbortSignal.timeout(30000))
      batch.forEach((entry,index)=>cache.set(entry.key,vectors[index]))
    }
  })().catch(()=>{}).finally(()=>{warming=null;saveDiskVectors(environment,entries)})
  return warming
}
export async function cueRecall(cue,entries,{environment=process.env,fetcher=localFetch,signal,limit=4,minScore=CUE_MIN_SCORE,budgetMs=1500}={}){
  try{
    if(typeof cue!=='string'||!cue.trim()||!Array.isArray(entries)||!entries.length)return []
    const url=cueConnection(environment)
    if(!url||signal?.aborted)return []
    const normalized=keyed(entries)
    cueKeys=new Set(normalized.map(e=>e.key))
    for(const key of cache.keys())if(!cueKeys.has(key)){cache.delete(key);diskStale=true}
    loadDiskVectors(environment)
    saveLabels(environment,normalized)
    // A removed memory's vector must leave the disk file too, even when nothing new needs embedding.
    if(!warmCueVectors(url,environment,fetcher,normalized)&&diskStale&&!warming){diskStale=false;saveDiskVectors(environment,normalized)}
    const ready=normalized.filter(e=>cache.has(e.key))
    // A worker that missed the budget is skipped for a while, so a slow
    // machine costs at most one late turn per backoff, not every reply.
    if(!ready.length||Date.now()<slowUntil)return []
    const budget=AbortSignal.timeout(budgetMs)
    let needle
    try{[needle]=await embedTexts(url,environment,fetcher,[QUERY_PREFIX+cue.trim().slice(0,512)],signal?AbortSignal.any([signal,budget]):budget)}
    // A miss while entry vectors are still being filled is queueing, not a slow worker.
    catch(error){if(budget.aborted&&!signal?.aborted&&!warming)slowUntil=Date.now()+SLOW_BACKOFF_MS;throw error}
    return ready.map(e=>({id:e.id,text:e.text,kind:e.kind,score:similarity(needle,cache.get(e.key))}))
      .filter(m=>m.score>=minScore).sort((a,b)=>b.score-a.score).slice(0,limit)
  }catch{return []}
}
export function cueRecallWarming(){return warming}
export function resetCueRecallBackoff(){slowUntil=0}
