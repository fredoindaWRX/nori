// Explicit launch selection only. No copying, provisioning, cutover receipt or
// fallback to unprepared/legacy state on validation failure.
const {lstatSync}=require('node:fs')
const {join}=require('node:path')
const {spawnSync}=require('node:child_process')
const {nativeStateLayout}=require('./native-state-layout.cjs')
function consolidatedStateSelection(root,mode,{scriptsRoot=join(__dirname,'../scripts')}={}){
  if(mode===undefined||mode==='')return null
  if(mode!=='consolidated-v1')throw Error('Unknown Nori state layout; no fallback permitted')
  if(process.platform!=='win32')throw Error('Consolidated Nori state requires Windows permission validation')
  const layout=nativeStateLayout(root)
  for(const path of [layout.privateRoot,layout.desktop,layout.core,layout.browser]){
    try{if(!lstatSync(path).isDirectory())throw Error('not directory')}
    catch{throw Error('Prepared consolidated Nori state is missing; no data created')}
  }
  const powershell=join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe')
  for(const [script,path] of [['verify-private-state-acl.ps1',layout.privateRoot],['verify-browser-state-acl.ps1',layout.browser]]){
    const result=spawnSync(powershell,['-NoProfile','-File',join(scriptsRoot,script),'-Root',path],
      {encoding:'utf8',windowsHide:true,shell:false,timeout:30000})
    if(result.error||result.status!==0)throw Error('Consolidated Nori state permissions refused; no legacy fallback')
  }
  return Object.freeze({...layout,selected:true,permissionsVerified:true,liveMigrationAuthorized:false})
}
module.exports={consolidatedStateSelection}
