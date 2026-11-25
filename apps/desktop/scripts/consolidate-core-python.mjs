// Copy an existing interpreter plus stdlib, not user-installed site packages.
// Never install/download, follow links, overwrite a runtime or remove its source.
import {existsSync,lstatSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve,relative,sep} from 'node:path'
import {spawnSync} from 'node:child_process'
import {verifiedCopy} from './verified-copy.mjs'

const root=resolve(import.meta.dirname,'../../..')
const source=join(process.env.LOCALAPPDATA || '', 'Programs','Python','Python311')
const target=join(root,'python','Python311')
if(process.argv.length!==3 || process.argv[2]!=='--copy') throw new Error('Explicit --copy required')
if(!process.env.LOCALAPPDATA || !existsSync(join(source,'python.exe'))) throw new Error('Existing Python3.11 runtime missing')
if(existsSync(target)) throw new Error('Destination already exists; refusing overwrite')
const files=[]
function collect(directory){
  if(lstatSync(directory).isSymbolicLink())throw new Error('Runtime link refused')
  for(const entry of readdirSync(directory,{withFileTypes:true})){
    if(['site-packages','__pycache__'].includes(entry.name) || entry.name.endsWith('.pyc'))continue
    const path=join(directory,entry.name)
    if(entry.isSymbolicLink())throw new Error('Runtime link refused')
    if(entry.isDirectory())collect(path)
    else if(entry.isFile())files.push(path)
  }
}
for(const name of ['python.exe','pythonw.exe','python3.dll','python311.dll','vcruntime140.dll','vcruntime140_1.dll','LICENSE.txt']){
  const path=join(source,name)
  if(!lstatSync(path).isFile())throw new Error('Required interpreter file missing')
  files.push(path)
}
collect(join(source,'DLLs'));collect(join(source,'Lib'))
// Validate the complete candidate before making the destination.
for(const path of files){
  const delta=relative(source,path)
  if(delta.startsWith('..') || delta.split(sep).includes('site-packages'))throw new Error('Runtime scope escape')
}
mkdirSync(target,{recursive:true})
for(const path of files)verifiedCopy(path,join(target,relative(source,path)))
const check=spawnSync(join(target,'python.exe'),['-I','-B','-c',
  'import sys,ssl,sqlite3,ctypes,json,asyncio,http.server; print(json.dumps({"version":sys.version,"prefix":sys.prefix,"ssl":ssl.OPENSSL_VERSION}))'],
  {cwd:target,encoding:'utf8',windowsHide:true,timeout:15000})
const receipt={source,target,files:files.length,site_packages_copied:false,
  validation_exit:check.status,validation_stdout:check.stdout,validation_stderr:check.stderr,
  installer_qualified:false}
writeFileSync(join(target,'consolidation-receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx'})
console.log(JSON.stringify(receipt))
if(check.error || check.status!==0)throw new Error('Copied runtime validation failed; retained for diagnosis')
