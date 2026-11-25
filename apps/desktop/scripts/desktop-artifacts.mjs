import {lstatSync,readdirSync,realpathSync} from 'node:fs'
import {join,relative,isAbsolute} from 'node:path'

// Native suite bytes have their own mandatory manifest. Everything else in
// win-unpacked, including Electron DLLs and ASAR-unpacked modules, is desktop.
export function desktopArtifactPaths(desktopRoot) {
  if(lstatSync(desktopRoot).isSymbolicLink())throw Error('Linked desktop artifact root refused')
  const root=realpathSync(desktopRoot),paths=[]
  function walk(path){
    const info=lstatSync(path),delta=relative(root,realpathSync(path))
    if(info.isSymbolicLink()||delta.startsWith('..')||isAbsolute(delta))throw Error('Desktop artifact link or escape refused')
    const name=relative(root,path).replaceAll('\\','/')
    if(name==='resources/NoriSuite'){
      if(!info.isDirectory())throw Error('Native suite resource must be a directory')
      return
    }
    if(info.isDirectory())for(const entry of readdirSync(path).sort())walk(join(path,entry))
    else if(info.isFile())paths.push(name)
    else throw Error('Unsupported desktop artifact')
  }
  walk(root)
  for(const path of ['Nori.exe','resources/app.asar'])if(!paths.includes(path))throw Error('Required desktop artifact missing')
  return paths.sort()
}
