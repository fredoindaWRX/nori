const fs=require('node:fs')
const path=require('node:path')
const os=require('node:os')
const {spawn,spawnSync}=require('node:child_process')
const {desktopStateSelection}=require('./desktop-state-selection.cjs')
const {acquireStateOwner}=require('./state-owner.cjs')
const {startWakeResidentHost}=require('./wake-resident-host.cjs')
const {createWakeLoginSettings}=require('./wake-login-settings.cjs')

function residentProfile(privateRoot){
  const profile=path.join(privateRoot,'wake')
  if(!fs.lstatSync(profile).isDirectory()||fs.lstatSync(profile).isSymbolicLink()||
    fs.realpathSync(profile).toLowerCase()!==profile.toLowerCase())
    throw Error('Prepared resident profile missing or redirected')
  return profile
}
function residentPrivateRoot(layout,home=os.homedir()){
  if(layout)return layout.privateRoot
  // Legacy installed desktops keep their state outside Program Files. This is
  // an explicit profile choice, not a fallback from failed layout validation.
  if(typeof home!=='string'||!path.isAbsolute(home))throw Error('Owner home is required')
  return path.join(home,'.nori')
}
function qualificationOwnerPid(env=process.env){
  const value=env.NORI_WAKE_QUALIFICATION_OWNER_PID
  if(!/^[1-9]\d{0,9}$/.test(value??''))throw Error('Resident qualification requires an owning process')
  const pid=Number(value)
  if(!Number.isSafeInteger(pid)||pid===process.pid)throw Error('Resident qualification owner is invalid')
  return pid
}
function ownerProcessAlive(pid,probe=process.kill){
  try{probe(pid,0);return true}catch{return false}
}
async function bootstrapWakeResident(electron){
  const {app,Tray,Menu,dialog}=electron
  let stateOwner
  try{
    if(!app.isPackaged||process.platform!=='win32')throw Error('Resident mode requires packaged Windows Nori')
    if(process.argv.includes('--workspace-probe'))throw Error('Resident capture cannot be enabled in a sensor-denied probe')
    const qualification=process.argv.includes('--nori-wake-resident-qualify')
    if(qualification&&process.env.NORI_WAKE_QUALIFICATION!=='1')
      throw Error('Resident qualification requires an explicit owned environment')
    const qualificationOwner=qualification?qualificationOwnerPid():undefined
    if(qualification&&!ownerProcessAlive(qualificationOwner))
      throw Error('Resident qualification owner is not running')
    const loginSettings=createWakeLoginSettings({app,executable:process.execPath})
    const loginAutostart=process.argv.includes('--nori-wake-autostart')
    if(loginAutostart&&!loginSettings.isEnabled())
      throw Error('Unregistered wake sign-in launch refused')
    const root=path.join(process.resourcesPath,'NoriSuite')
    const layout=desktopStateSelection({suiteRoot:root,appRoot:path.resolve(__dirname,'..'),
      packaged:true,executable:process.execPath,stateLayout:undefined})
    const profile=residentProfile(residentPrivateRoot(layout))
    const verify=path.join(path.dirname(process.execPath),'maintenance/scripts/verify-private-state-acl.ps1')
    const checked=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile','-File',verify,'-Root',profile],{windowsHide:true,shell:false,timeout:30000,maxBuffer:65536})
    if(checked.error||checked.status!==0)throw Error('Resident profile permission validation refused')
    app.setPath('userData',profile)
    app.setPath('sessionData',profile)
    if(!app.requestSingleInstanceLock()){app.quit();return}
    stateOwner=acquireStateOwner(profile,{purpose:'desktop'})
    app.on('will-quit',event=>{
      try{stateOwner.release()}catch{event.preventDefault();app.exit(1)}
    })
    const launchApp=async()=>{
      const env={...process.env,NORI_INFERENCE_RUNTIME:'norllama',NORI_ALLOW_WRITES:'0'}
      if(layout)env.NORI_STATE_LAYOUT='consolidated-v1'
      else delete env.NORI_STATE_LAYOUT
      for(const key of Object.keys(env))if(key.toUpperCase()==='ELECTRON_RUN_AS_NODE')delete env[key]
      const child=spawn(process.execPath,['--nori-wake'],{env,shell:false,detached:true,stdio:'ignore',
        cwd:path.dirname(process.execPath),windowsHide:false})
      await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)})
      child.unref();return true // Activation request, not foreground readiness.
    }
    let host,deadline,ownerWatch
    const stopQualification=async()=>{
      clearTimeout(deadline);clearInterval(ownerWatch)
      if(await host?.stop()!==true)throw Error('Resident qualification cleanup not confirmed')
    }
    host=await startWakeResidentHost({app,Tray,Menu,root,launchApp,
      startListening:qualification||loginAutostart||process.argv.includes('--nori-wake-listen'),loginSettings,
      onState:value=>{if(qualification)process.stdout.write(`${JSON.stringify({schema:1,wakeResidentState:value})}\n`)},
      icon:path.join(__dirname,'../public/nori-icon.ico'),
      reportError:()=>dialog.showErrorBox('Nori wake stopped','Wake listening could not stop or run safely. It remains stopped; diagnose before resuming.')})
    if(qualification){
      deadline=setTimeout(()=>{void stopQualification().catch(()=>app.exit(1))},120000)
      // Packaged Windows GUI processes can report stdin EOF immediately even
      // when launched with an owned pipe. Bind lifetime to the explicit owner
      // process instead; owner loss and the hard deadline both drain capture.
      ownerWatch=setInterval(()=>{
        if(!ownerProcessAlive(qualificationOwner))void stopQualification().catch(()=>app.exit(1))
      },500)
    }
  }catch{
    // Startup is paused: no capture has begun. Release the profile reservation
    // explicitly because app.exit bypasses the normal will-quit lifecycle.
    try{stateOwner?.release()}catch{}
    await app.whenReady()
    dialog.showErrorBox('Nori wake unavailable','A prepared, protected Nori wake profile is required. No microphone listener or new profile was created.')
    app.exit(1)
  }
}
module.exports={residentProfile,residentPrivateRoot,qualificationOwnerPid,ownerProcessAlive,bootstrapWakeResident}
