import {lstatSync,readdirSync,realpathSync} from 'node:fs'
import {join,relative,isAbsolute} from 'node:path'

export function nativeDistributionPaths(suiteRoot) {
  if(lstatSync(suiteRoot).isSymbolicLink())throw Error('Linked native distribution root refused')
  const root=realpathSync(suiteRoot),paths=[]
  function walk(path){
    const info=lstatSync(path),physical=relative(root,realpathSync(path))
    if(info.isSymbolicLink()||physical.startsWith('..')||isAbsolute(physical))throw Error('Native distribution link or escape refused')
    const name=relative(root,path).replaceAll('\\','/')
    // These exact paths are excluded by the installer. Never omit arbitrary
    // program files based on a substring such as 'state' or 'verification'.
    if(name==='state'||name==='verification'||name==='native-payload-receipt.json')return
    if(info.isDirectory())for(const entry of readdirSync(path).sort())walk(join(path,entry))
    else if(info.isFile())paths.push(name)
    else throw Error('Unsupported native distribution entry')
  }
  walk(root)
  return paths.sort()
}
