// Nori owns this CPU worker. No downloaded code, cloud endpoint, or arbitrary model path.
const {spawn} = require('node:child_process')
const {createHash, randomBytes} = require('node:crypto')
const {createReadStream, lstatSync, realpathSync} = require('node:fs')
const {resolve, join} = require('node:path')
const {setTimeout: delay} = require('node:timers/promises')
const MODEL='C:/Nori/models/embedding/qwen3-embedding-0.6b-370f27d7/Qwen3-Embedding-0.6B-Q8_0.gguf'
const HASH='06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439'
const ENDPOINT='http://127.0.0.1:18789'
// Dedicated CPU engine for memory embeddings (Wil, 2026-11-13: "faster cpu build").
// The CUDA runtime's CPU backend took ~4.5 s per cue; this native CPU-only build
// (llama.cpp 2e7c58c, GGML_NATIVE, no GPU backends) takes ~0.25 s on 2 threads and
// never touches either graphics card. Every file is pinned; any mismatch falls
// back to the old engine so memory search keeps working, only slower.
const FAST_ENGINE='engine/memory-embedding/bin'
const FAST_FILES={
  'llama-server.exe':'3812ca5a6e819278058bc1487da83b336345d374a907816486e86549c6e69985',
  'llama-server-impl.dll':'31e2a7e1433aea3b20420b57afd52c7555e76af7e3497e37afb19ea9d2d9dfa4',
  'llama.dll':'10f27d4054d9dc872cdde69f7e8d57f09b8c25325a0ed40af0ddaff28ae31f63',
  'llama-common.dll':'26be52594f1fbabd8073a5589f2e4a8aa5d3114688f6c4bf6214141c4aee42f6',
  'ggml.dll':'a17034e49d35ec7e158e01a9398a6095a9696d320e41ddcbdd300e429ba957e1',
  'ggml-base.dll':'a8e8ea9271c136dead58b64c0ff250851c4c76d226145ea1e83c1d799e2e0332',
  'ggml-cpu.dll':'b04e209dabf1bef91d84a5b06de298a83bf573a15240542de8940aee6af46ed4',
  'mtmd.dll':'7bc5692dbeb7921c13e5854eea4981bc5b8f28462ec84fc4ff61fa847ff07926',
}
function fastEngine(root){
  try{
    const dir=join(root,FAST_ENGINE)
    for(const [name,expected] of Object.entries(FAST_FILES)){
      const file=join(dir,name),info=lstatSync(file)
      if(info.isSymbolicLink()||!info.isFile())return null
      if(createHash('sha256').update(require('node:fs').readFileSync(file)).digest('hex')!==expected)return null
    }
    return join(dir,'llama-server.exe')
  }catch{return null}
}
async function startLocalEmbeddingService({root,signal,spawnChild=spawn,fetcher=fetch}={}){
  const expected=resolve(MODEL)
  for(let path=expected;path;){
    const info=lstatSync(path)
    if(info.isSymbolicLink()||(info.mode===undefined)||((info.fileAttributes??0)&0x400))throw Error('Linked embedding model path refused')
    const parent=require('node:path').dirname(path);if(parent===path)break;path=parent
  }
  if(realpathSync(expected).toLowerCase()!==expected.toLowerCase()||lstatSync(expected).size!==639150592)throw Error('Embedding model identity refused')
  const hash=createHash('sha256')
  for await(const bytes of createReadStream(expected)){signal?.throwIfAborted();hash.update(bytes)}
  if(hash.digest('hex')!==HASH)throw Error('Embedding checkpoint hash mismatch')
  signal?.throwIfAborted()
  const {assertPortAvailable}=require('./local-model-port.cjs')
  await assertPortAvailable(18789)
  const key=randomBytes(32).toString('hex')
  const fast=fastEngine(root)
  const executable=fast??join(root,'engine/gpt-oss-runtime/build/bin/llama-server.exe')
  const child=spawnChild(executable,['--model',expected,'--host','127.0.0.1','--port','18789',
    '--alias','nori-memory-embedding','--embedding','--pooling','last','--ctx-size','4096',
    '--parallel','1','--n-gpu-layers','0','--threads','2',...(fast?['--batch-size','512','--ubatch-size','512']:['--batch-size','128','--ubatch-size','64'])],
    {cwd:root,shell:false,windowsHide:true,stdio:'ignore',env:{...process.env,LLAMA_API_KEY:key,OMP_NUM_THREADS:'2'}})
  let stopping,spawnError
  const exited=new Promise(resolveExit=>{child.once('exit',(code,exitSignal)=>resolveExit({code,signal:exitSignal}));child.once('error',error=>{spawnError=error;resolveExit({spawnError:true})})})
  const stop=()=>stopping??=(async()=>{
    if(spawnError&&child.pid==null)return
    if(child.exitCode===null&&child.signalCode==null)child.kill('SIGTERM')
    let timer;const clean=await Promise.race([exited.then(()=>true),new Promise(r=>{timer=setTimeout(()=>r(false),10000)})]);clearTimeout(timer)
    if(!clean&&child.exitCode===null&&child.signalCode==null){child.kill('SIGKILL');await exited}
  })()
  try{
    const deadline=Date.now()+60000
    while(Date.now()<deadline){
      signal?.throwIfAborted()
      if(spawnError||child.exitCode!==null||child.signalCode!=null)throw Error('Owned embedding worker stopped before readiness')
      try{
        const response=await fetcher(ENDPOINT+'/health',{headers:{authorization:'Bearer '+key},signal:AbortSignal.timeout(1000),redirect:'error'})
        if(response.ok&&(await response.json()).status==='ok')return {child,exited,stop,environment:{NORI_EMBEDDING_URL:ENDPOINT,NORI_EMBEDDING_API_KEY:key},status:{modelId:'qwen3-embedding-0.6b',backend:fast?'cpu-native':'cpu'}}
      }catch{}
      await delay(200)
    }
    throw Error('Owned embedding worker readiness timed out')
  }catch(error){await stop();throw error}
}
module.exports={startLocalEmbeddingService,fastEngine,FAST_FILES}
