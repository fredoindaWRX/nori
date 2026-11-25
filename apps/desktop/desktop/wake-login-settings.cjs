const {spawnSync}=require('node:child_process')
const path=require('node:path')

const RUN_KEY='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
const VALUE_NAME='Nori Wake'

function createWindowsRunRegistry({runner=spawnSync,systemRoot=process.env.SystemRoot}={}){
  if(typeof systemRoot!=='string'||!path.isAbsolute(systemRoot))throw Error('Windows system root required')
  const executable=path.join(systemRoot,'System32','reg.exe')
  const run=args=>runner(executable,args,{encoding:'utf8',windowsHide:true,shell:false,timeout:10000,maxBuffer:65536})
  const read=()=>{
    const result=run(['QUERY',RUN_KEY,'/v',VALUE_NAME,'/reg:64'])
    if(result.error)throw Error('Windows wake sign-in registry query failed')
    if(result.status===1){
      // A failed value query can also mean access denied, not an absent value.
      const key=run(['QUERY',RUN_KEY,'/reg:64'])
      if(key.error||key.status!==0)throw Error('Windows wake sign-in registry absence could not be verified')
      if(/^\s*Nori Wake\s+/m.test(key.stdout))throw Error('Windows wake sign-in registry value unreadable')
      return null
    }
    if(result.status!==0)throw Error('Windows wake sign-in registry query refused')
    const line=result.stdout.split(/\r?\n/).find(value=>/^\s*Nori Wake\s+REG_SZ\s+/.test(value))
    if(!line)throw Error('Windows wake sign-in registry output invalid')
    return line.replace(/^\s*Nori Wake\s+REG_SZ\s+/,'')
  }
  return Object.freeze({read,
    setExact(command){
      const existing=read()
      if(existing!==null&&existing!==command)throw Error('Existing Nori Wake startup value differs; preserved')
      if(existing===command)return true
      const result=run(['ADD',RUN_KEY,'/v',VALUE_NAME,'/t','REG_SZ','/d',command,'/f','/reg:64'])
      let observed
      try{observed=read()}catch{throw Error('Windows wake sign-in registration could not be verified; inspect the startup entry')}
      if(result.error||result.status!==0||observed!==command){
        if(observed===command){
          const removed=run(['DELETE',RUN_KEY,'/v',VALUE_NAME,'/f','/reg:64'])
          if(removed.error||removed.status!==0||read()!==null)
            throw Error('Windows wake sign-in failed and cleanup could not be confirmed')
        }
        throw Error('Windows wake sign-in registration failed')
      }
      return true
    },
    removeExact(command){
      const existing=read()
      if(existing===null)return true
      if(existing!==command)throw Error('Existing Nori Wake startup value differs; preserved')
      const result=run(['DELETE',RUN_KEY,'/v',VALUE_NAME,'/f','/reg:64'])
      if(result.error||result.status!==0||read()!==null)throw Error('Windows wake sign-in removal failed')
      return true
    },
  })
}

function createWakeLoginSettings({app,executable=process.execPath,platform=process.platform,
  registry=createWindowsRunRegistry()}={}){
  if(platform!=='win32'||app?.isPackaged!==true||typeof executable!=='string'||
    !path.isAbsolute(executable)||path.basename(executable).toLowerCase()!=='nori.exe'||/["\r\n]/.test(executable))
    throw Error('Packaged Windows Nori is required for wake sign-in settings')
  const args=['--nori-wake-resident','--nori-wake-autostart']
  const command=`"${executable}" ${args.join(' ')}`
  const isEnabled=()=>registry.read()===command
  return Object.freeze({
    isEnabled,
    setEnabled(enabled){
      if(typeof enabled!=='boolean')throw Error('Explicit wake sign-in boolean required')
      if(enabled)registry.setExact(command);else registry.removeExact(command)
      if(isEnabled()!==enabled)throw Error('Windows wake sign-in setting did not match request')
      return true
    },
    exact:{path:executable,args:[...args],name:VALUE_NAME,command},
  })
}
module.exports={RUN_KEY,VALUE_NAME,createWindowsRunRegistry,createWakeLoginSettings}
