// Assemble only the portable coder payload. Reuses Nori's installed Python/model.
import {mkdirSync,existsSync,lstatSync,realpathSync,readdirSync,copyFileSync,readFileSync,writeFileSync,renameSync} from 'node:fs'
import {dirname,join,resolve,relative,isAbsolute} from 'node:path'
import {pathToFileURL} from 'node:url'
import {buildComponentManifest,verifyComponentManifest} from './component-integrity.mjs'

export const aiderCodeFiles=Object.freeze([
  'nori/__init__.py',
  'nori/shared/control_plane/__init__.py','nori/shared/control_plane/v2.py',
  'nori/shared/control_plane/autonomy.py',
  'nori/development_workers/base.py','nori/development_workers/aider_adapter.py',
  'nori/nori_aider.py','integrations/aider/run_aider.py',
  'integrations/aider/aider-nori.conf.yml',
  'integrations/aider/gpt-oss-20b.settings.yml',
])
const dependencyPath='integrations/aider/.venv/Lib/site-packages'

function updateReceipt(target,paths){
  const receiptPath=join(target,'aider-payload-receipt.json')
  const before=JSON.parse(readFileSync(receiptPath,'utf8'))
  const manifest=buildComponentManifest(target,paths)
  verifyComponentManifest(target,manifest,paths)
  const next={...before,files:paths.length,bytes:manifest.files.reduce((sum,file)=>sum+file.bytes,0),
    manifest,liveTested:false}
  writeFileSync(receiptPath+'.next',JSON.stringify(next,null,2)+'\n',{flag:'wx'})
  renameSync(receiptPath+'.next',receiptPath)
  return {files:next.files,bytes:next.bytes,copyVerified:true,liveTested:false}
}

export function refreshAiderCode(codeRoot,target){
  const before=JSON.parse(readFileSync(join(target,'aider-payload-receipt.json'),'utf8'))
  verifyComponentManifest(target,before.manifest,before.manifest.files.map(file=>file.path))
  for(const path of aiderCodeFiles){
    const source=checkedFile(codeRoot,path),destination=join(target,path)
    if(realpathSync(dirname(destination)).toLowerCase()!==dirname(destination).toLowerCase())
      throw Error('Coder payload parent changed or became linked')
    copyFileSync(source,destination)
  }
  return updateReceipt(target,[...new Set([...before.manifest.files.map(file=>file.path),...aiderCodeFiles])])
}

export function addAiderGitRuntime(gitRoot,target){
  gitRoot=realpathSync(gitRoot);target=realpathSync(target)
  const before=JSON.parse(readFileSync(join(target,'aider-payload-receipt.json'),'utf8'))
  verifyComponentManifest(target,before.manifest,before.manifest.files.map(file=>file.path))
  const gitTarget=join(target,'integrations/aider/git')
  if(existsSync(gitTarget))throw Error('Existing bundled Git preserved')
  const sourcePaths=[]
  function walk(path){
    const source=checkedFile(gitRoot,path),info=lstatSync(source)
    if(info.isDirectory())for(const name of readdirSync(source).sort())walk(path+'/'+name)
    else if(info.isFile())sourcePaths.push(path)
    else throw Error('Unsupported Git package entry')
  }
  // Preserve the distribution layout and notices. Exclude host configuration,
  // credential stores, GUI, uninstaller and developer state.
  for(const path of ['mingw64/bin','mingw64/libexec/git-core','mingw64/share/git-core','mingw64/share/licenses','LICENSE.txt'])walk(path)
  const sourceManifest=buildComponentManifest(gitRoot,sourcePaths)
  mkdirSync(gitTarget)
  for(const path of sourcePaths){
    const destination=join(gitTarget,path);mkdirSync(dirname(destination),{recursive:true})
    copyFileSync(checkedFile(gitRoot,path),destination,1)
  }
  verifyComponentManifest(gitTarget,sourceManifest,sourcePaths)
  return updateReceipt(target,[...before.manifest.files.map(file=>file.path),
    ...sourcePaths.map(path=>'integrations/aider/git/'+path)])
}

function checkedFile(root,path){
  const expected=resolve(root,path),actual=realpathSync(expected),delta=relative(root,actual)
  if(delta.startsWith('..')||isAbsolute(delta)||actual.toLowerCase()!==expected.toLowerCase()||
    lstatSync(expected).isSymbolicLink())throw Error('Aider payload source is linked or escapes its root')
  return expected
}

export function prepareAiderRuntime(codeRoot,dependencyRoot,destination){
  codeRoot=realpathSync(codeRoot);dependencyRoot=realpathSync(dependencyRoot)
  const target=resolve(destination)
  if(existsSync(target))throw Error('Existing coder payload preserved; choose a fresh staging folder')
  const parent=dirname(target)
  if(!existsSync(parent)||realpathSync(parent).toLowerCase()!==parent.toLowerCase())
    throw Error('Coder staging parent must exist and be a physical directory')
  const metadata=readFileSync(checkedFile(dependencyRoot,
    dependencyPath+'/aider_chat-0.86.2.dist-info/METADATA'),'utf8')
  if(!/^Name: aider-chat\r?$/m.test(metadata)||!/^Version: 0\.86\.2\r?$/m.test(metadata))
    throw Error('Aider 0.86.2 dependencies are required')
  const paths=[]
  const dependencies=[]
  function walk(path){
    const source=checkedFile(dependencyRoot,path),info=lstatSync(source)
    if(info.isDirectory()){
      for(const entry of readdirSync(source).sort()){
        if(['__pycache__','.pytest_cache','tests'].includes(entry)||/\.py[co]$/.test(entry))continue
        walk(path+'/'+entry)
      }
    }else if(info.isFile())dependencies.push(path)
    else throw Error('Unsupported Aider package entry')
  }
  walk(dependencyPath)
  for(const path of aiderCodeFiles)checkedFile(codeRoot,path)
  mkdirSync(target)
  for(const [root,files] of [[codeRoot,aiderCodeFiles],[dependencyRoot,dependencies]]){
    for(const path of files){
      const source=checkedFile(root,path),output=join(target,path)
      mkdirSync(dirname(output),{recursive:true});copyFileSync(source,output,1);paths.push(path)
    }
    const manifest=buildComponentManifest(root,[...files])
    verifyComponentManifest(target,manifest,[...files])
  }
  const manifest=buildComponentManifest(target,paths)
  verifyComponentManifest(target,manifest,paths)
  const receipt={schema:'nori.aider.portable-payload.v1',aiderVersion:'0.86.2',
    interpreter:'Nori bundled Python 3.11',model:'local GPT-OSS 20B',
    files:paths.length,bytes:manifest.files.reduce((sum,file)=>sum+file.bytes,0),
    manifest,copyVerified:true,liveTested:false}
  writeFileSync(join(target,'aider-payload-receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'})
  return receipt
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv[2]==='--refresh-code'){
    console.log(JSON.stringify(refreshAiderCode(resolve(process.argv[3]),resolve(process.argv[4]))))
  }else if(process.argv[2]==='--add-git'){
    console.log(JSON.stringify(addAiderGitRuntime(resolve(process.argv[3]),resolve(process.argv[4]))))
  }else{
  const [codeRoot,dependencyRoot,destination]=process.argv.slice(2)
  if(!codeRoot||!dependencyRoot||!destination)throw Error('Expected code root, dependency root, and fresh destination')
  const result=prepareAiderRuntime(codeRoot,dependencyRoot,destination)
  console.log(JSON.stringify({destination:resolve(destination),files:result.files,bytes:result.bytes,copyVerified:true,liveTested:false}))
  }
}

