// Tray presentation only; the resident owner supplies a real Tray and controller.
function createWakeResidentTray({tray,Menu,controller,loginSettings,onQuit,onError=()=>{}}){
  const labels={paused:'Paused',starting:'Starting',arming:'Starting',listening:'Listening for Hey Nori',
    'waiting-foreground':'Nori app is using the microphone',failed:'Stopped — needs attention',stopped:'Stopped'}
  let retiring=false
  const report=error=>{
    try{onError(error)}catch{console.error('Nori wake error reporting failed')}
  }
  const invoke=async action=>{
    try{await action()}catch(error){report(error)}finally{if(!retiring)refresh()}
  }
  function refresh(){
    const {state,failed}=controller.status()
    let loginEnabled=false,loginReadable=true
    if(loginSettings){
      try{loginEnabled=loginSettings.isEnabled()}
      catch(error){loginReadable=false;report(error)}
    }
    tray.setToolTip(`Nori wake: ${labels[state]||'Unknown'}`)
    tray.setContextMenu(Menu.buildFromTemplate([
      {label:`Wake listener: ${labels[state]||'Unknown'}`,enabled:false},
      {type:'separator'},
      {label:'Resume wake listening',enabled:state==='paused'&&!failed,
        click:()=>invoke(()=>controller.resume())},
      {label:'Pause wake listening',enabled:state!=='paused',
        click:()=>invoke(()=>controller.pause())},
      ...(loginSettings?[{type:'separator'},
        {label:loginReadable?'Start wake listener with Windows':'Windows startup setting unavailable',
          type:'checkbox',checked:loginEnabled,enabled:loginReadable,
          click:()=>invoke(()=>loginSettings.setEnabled(!loginSettings.isEnabled()))}]:[]),
      {type:'separator'},
      {label:'Stop background wake',click:async()=>{
        if(retiring)return
        retiring=true
        try{
          if(await controller.pause()!==true)throw Error('Wake listener shutdown not confirmed')
          tray.destroy();onQuit()
        }catch(error){retiring=false;report(error);refresh()}
      }},
    ]))
  }
  refresh()
  return {refresh}
}
module.exports={createWakeResidentTray}
