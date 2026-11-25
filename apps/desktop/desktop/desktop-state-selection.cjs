const {join,dirname,resolve,relative,basename,isAbsolute}=require('node:path')
const {lstatSync,realpathSync}=require('node:fs')
const {consolidatedStateSelection}=require('./consolidated-state-selection.cjs')
const {installedStatePolicy}=require('./installed-state-policy.cjs')
function developmentNoriRoot(executable){
  if(typeof executable!=='string'||!isAbsolute(executable))return null
  const exeDir=dirname(resolve(executable))
  for(let current=exeDir;;current=dirname(current)){
    if(basename(current).toLowerCase()==='nori'){
      const marker=join(current,'ROADMAP_TRACKING.json')
      try{
        const rootInfo=lstatSync(current),markerInfo=lstatSync(marker),exeInfo=lstatSync(executable)
        if(rootInfo.isDirectory()&&!rootInfo.isSymbolicLink()&&markerInfo.isFile()&&!markerInfo.isSymbolicLink()&&
          exeInfo.isFile()&&!exeInfo.isSymbolicLink()&&realpathSync(current)===current&&
          realpathSync(marker)===marker&&realpathSync(executable)===resolve(executable)){
          const rel=relative(current,exeDir).replaceAll('\\','/')
          if(rel.startsWith('apps/desktop/release/')&&rel.endsWith('/win-unpacked'))return current
        }
      }catch(error){if(error.code!=='ENOENT')throw error}
    }
    const parent=dirname(current)
    if(parent===current)break
  }
  return null
}
// Shared by the desktop and future retained-Job controller. Prepared state only:
// never provision, relocate, migrate or fall back during launch selection.
function desktopStateSelection({suiteRoot,appRoot,packaged,executable,probeLayoutRoot,stateLayout},select=consolidatedStateSelection){
  const installed=packaged===true&&!probeLayoutRoot?installedStatePolicy({executable,suiteRoot}):null
  if(installed&&stateLayout!==undefined&&stateLayout!==installed.mode)
    throw Error('Installed state layout override conflicts with policy; no fallback')
  const developmentRoot=packaged===true&&!probeLayoutRoot&&!installed?developmentNoriRoot(executable):null
  const selectedRoot=probeLayoutRoot||developmentRoot||suiteRoot
  const mode=probeLayoutRoot?'consolidated-v1':installed?.mode??(developmentRoot?'consolidated-v1':stateLayout)
  if(mode===undefined||mode==='')return null
  if(typeof packaged!=='boolean'||typeof suiteRoot!=='string'||typeof appRoot!=='string'||
    (packaged&&typeof executable!=='string'))throw Error('Explicit desktop state selection context required')
  // PowerShell cannot execute scripts from a virtual ASAR path. Both ordinary
  // and generated packaged layouts use the shipped physical maintenance files.
  const scriptsRoot=packaged?join(dirname(executable),'maintenance/scripts'):join(appRoot,'scripts')
  return select(selectedRoot,mode,{scriptsRoot})
}
module.exports={desktopStateSelection}
