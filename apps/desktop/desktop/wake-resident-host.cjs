const {createWakeResidentController}=require('./wake-resident-controller.cjs')
const {createWakeResidentTray}=require('./wake-resident-tray.cjs')

// Caller prepares/validates the resident profile before Electron ready. This
// host neither creates state nor installs startup nor starts capture on import.
async function startWakeResidentHost({app,Tray,Menu,root,icon,launchApp,reportError,
  startListening=false,loginSettings,onState=()=>{},
  createController=createWakeResidentController}={}){
  let presentation,tray,finished=false,quitting=false,draining
  const controller=createController({root,launchApp,onState:value=>{presentation?.refresh();onState(value)}})
  const drain=()=>{
    if(draining)return draining
    draining=(async()=>{
      if(await controller.pause()!==true)throw Error('Resident wake cleanup not confirmed')
      finished=true
      if(tray&&!tray.isDestroyed())tray.destroy()
      app.quit()
      return true
    })().catch(error=>{
      draining=undefined
      try{reportError(error)}catch{console.error('Nori wake cleanup error reporting failed')}
      return false
    })
    return draining
  }
  app.on('before-quit',event=>{
    if(finished)return
    event.preventDefault();quitting=true;void drain()
  })
  await app.whenReady()
  if(quitting)return {controller,stop:drain}
  tray=new Tray(icon)
  presentation=createWakeResidentTray({tray,Menu,controller,loginSettings,
    onError:reportError,onQuit:()=>{finished=true;app.quit()}})
  // Manual launch stays paused; verified sign-in or bounded qualification may listen.
  // Qualification lifetime is owned by the bootstrap's explicit parent PID.
  if(startListening&&await controller.resume()!==true)
    throw Error('Resident wake listening did not start')
  return {controller,stop:drain}
}
module.exports={startWakeResidentHost}
