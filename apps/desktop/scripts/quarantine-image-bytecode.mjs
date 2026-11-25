// Preserve only unmanifested, regenerable image-runtime bytecode outside the
// candidate. Run --apply only after the owned image worker has stopped.
import {readFileSync,readdirSync,lstatSync,realpathSync,existsSync,mkdirSync,renameSync,writeFileSync} from 'node:fs'
import {resolve,join,relative,dirname} from 'node:path'
const root=resolve(import.meta.dirname,'../../..')
const suite=join(root,'apps/desktop/release/native-desktop-ui-r1/win-unpacked/resources/NoriSuite')
const manifest=JSON.parse(readFileSync(join(root,'apps/desktop/release/native-suite-nori-workspace-gptoss-voice-memory-20261017-r1/NoriSuite/native-payload-receipt.json')))
const expected=new Set(manifest.manifest.files.map(file=>file.path))
const prefix='integrations/image-generation/runtime/ComfyUI_windows_portable/'
const actual=readdirSync(suite,{recursive:true,withFileTypes:true}).filter(file=>file.isFile())
  .map(file=>relative(suite,join(file.parentPath,file.name)).replaceAll('\\','/'))
  .filter(path=>!path.startsWith('state/')&&!path.startsWith('verification/')&&path!=='native-payload-receipt.json')
const extras=actual.filter(path=>!expected.has(path))
if(extras.some(path=>!path.startsWith(prefix)||!path.includes('/__pycache__/')||!path.endsWith('.pyc')))
  throw Error('Unexpected non-cache component preserved; inspect before any move')
const actualSet=new Set(actual)
if([...expected].some(path=>!actualSet.has(path)))throw Error('Required component missing; preserve candidate')
const entries=extras.map(path=>{
  const source=join(suite,path),info=lstatSync(source)
  if(!info.isFile()||info.isSymbolicLink()||realpathSync(source).toLowerCase()!==source.toLowerCase())throw Error('Redirected cache file preserved')
  return {path,bytes:info.size}
})
const apply=process.argv.slice(2)
if(apply.some(arg=>arg!=='--apply')||apply.length>1)throw Error('Expected optional --apply')
const backup=join(root,'verification',`image-bytecode-quarantine-${Date.now()}`)
if(apply.length){
  if(existsSync(backup))throw Error('Existing recovery folder preserved')
  mkdirSync(backup)
  writeFileSync(join(backup,'manifest.json'),JSON.stringify({suite,entries},null,2)+'\n',{flag:'wx'})
  for(const entry of entries){const destination=join(backup,entry.path);mkdirSync(dirname(destination),{recursive:true});renameSync(join(suite,entry.path),destination)}
}
console.log(JSON.stringify({applied:Boolean(apply.length),files:entries.length,bytes:entries.reduce((sum,e)=>sum+e.bytes,0),backup:apply.length?backup:null,requiredFilesUntouched:true}))
