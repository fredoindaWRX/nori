/** Read-only native STT payload check; never installs or downloads. */
import {statSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
export function sttPreflight(root){
  const required=[
    'python/Python311/python.exe',
    'runtime/stt/launch_worker.py',
    'runtime/stt/packages/faster_whisper/__init__.py',
    'runtime/stt/packages/ctranslate2/__init__.py',
    'runtime/stt/packages/av/__init__.py',
    ...['config.json','model.bin','tokenizer.json','vocabulary.txt'].map(name=>'models/voice/whisper-base.en/'+name),
    'models/voice/whisper-base.en/LICENSE',
    'apps/desktop/bridge/whisper_stt.py',
  ]
  const missing=required.filter(name=>{try{const info=statSync(join(root,name));return !info.isFile()||info.size===0}catch{return true}})
  return {root:resolve(root),payloadPresent:missing.length===0,missing,
    runtimeVerified:false,microphoneVerified:false,wakeWordVerified:false}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const result=sttPreflight(fileURLToPath(new URL('../../../',import.meta.url)))
  console.log(JSON.stringify(result,null,2))
  process.exitCode=result.payloadPresent?0:1
}
