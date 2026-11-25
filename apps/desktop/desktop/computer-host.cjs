// Trusted Electron owner. Wil grants a window: from the renderer's "Use my computer" picker, or, for an app
// Nori opened herself ("her own tab"), from this host's own dialog. The bridge can ask, never grant.
// 2026-11-14 (Wil: "Approve once per task"): one approval covers the task for 30 minutes; the session's
// floor still asks before delete/overwrite/send/pay controls and before taking the real keyboard.
const TASK_MINUTES=30
function createComputerHost({dialog,getWindow,owns,load=()=>Promise.all([
  import('../bridge/computer-control-session.mjs'),import('../bridge/windows-computer-executor.mjs')])}){
  let active=null,starting=false,generation=0
  const clearActive=()=>{const previous=active;active=null;previous?.session.stop()}
  const stop=()=>{generation++;clearActive();return {active:false}}
  const status=()=>{
    if(active&&(!active.valid()||Date.now()>=active.session.expiresAt))stop()
    return active?{active:true,title:active.title,sessionId:active.session.id,processId:active.session.processId,expiresAt:active.session.expiresAt}: {active:false}
  }
  const describe=action=>{
    const what=action.operation==='key'?`Press ${action.keys} using the real keyboard`
      :action.operation==='set_text'?`Type into ${action.element?.name||'a field'}`
      :`${action.operation.replace('_',' ')} ${action.element?.name||action.element?.controlType||(Number.isInteger(action.x)?`at ${action.x},${action.y}`:'a control')}`
    return what
  }
  // Shared by both grant paths. `valid` ties the session to the owner that approved it.
  async function grant({sessions,worker,selected,owner,valid,detailLead}){
    const requireOwner=()=>{if(!valid())throw Error('Computer control owner changed or was stopped.')}
    const answer=await dialog.showMessageBox(owner,{type:'question',title:'Allow Nori to work in this window?',
      message:selected.title,
      detail:`${detailLead}\n\nFor this task (up to ${TASK_MINUTES} minutes) Nori may see this window and its own dialogs, and click, scroll, drag and type in them. Input goes to the window itself, so your mouse and keyboard stay yours.\n\nShe still asks before anything that deletes, overwrites, sends, publishes or pays, and before using the real keyboard. Password fields are never read or typed into. Stop computer control ends it at any time.`,
      buttons:['Allow for this task','Cancel'],defaultId:1,cancelId:1})
    requireOwner()
    if(answer.response!==0)return {active:false}
    clearActive()
    let session
    const sessionValid=()=>valid()&&active?.session===session
    session=await sessions.createComputerControlSession({...selected,title:selected.title,approved:true,minutes:TASK_MINUTES,
      execute:async(request,options)=>{
        if(!sessionValid())throw Error('Computer control session was revoked.')
        const result=await worker.executeWindowsComputerAction(request,options)
        if(!sessionValid())throw Error('Computer control session was revoked.')
        return result
      },
      confirmAction:async action=>{
        if(!sessionValid())return false
        const decision=await dialog.showMessageBox(owner,{type:'warning',title:'Nori asks before this action',
          message:describe(action),
          detail:`Window: ${selected.title}${action.operation==='set_text'?`\nText: ${action.text}`:''}\n${action.reason||''}\nAllow only if this matches what you asked for.`,
          buttons:['Allow this action','Deny'],defaultId:1,cancelId:1})
        return decision.response===0&&sessionValid()
      }})
    if(!valid()){await session?.stop();throw Error('Computer control owner changed or was stopped.')}
    active={session,title:selected.title,valid}
    return status()
  }
  return {
    status,stop,
    async list(event){
      if(!owns(event))throw Error('Untrusted computer-control caller.')
      const [,worker]=await load()
      return (await worker.executeWindowsComputerAction({operation:'list_windows'})).windows
    },
    async start(event,target){
      if(!owns(event)||starting)throw Error('Computer control cannot start.')
      if(!target||!Number.isSafeInteger(target.windowHandle)||!Number.isSafeInteger(target.processId))throw Error('Choose a target window.')
      const owner=getWindow(),version=generation
      const valid=()=>generation===version&&owns(event)&&getWindow()===owner&&!owner?.isDestroyed?.()
      starting=true
      try{
        const [sessions,worker]=await load()
        if(!valid())throw Error('Computer control owner changed or was stopped.')
        const windows=(await worker.executeWindowsComputerAction({operation:'list_windows'})).windows
        if(!valid())throw Error('Computer control owner changed or was stopped.')
        const selected=windows.find(item=>item.windowHandle===target.windowHandle&&item.processId===target.processId)
        if(!selected)throw Error('The selected window is no longer available.')
        return await grant({sessions,worker,selected,owner,valid,detailLead:'You chose this window in Use my computer.'})
      }finally{starting=false}
    },
    // Her own tab: Nori opened this program herself and asks to work in it. Only Wil's answer grants it.
    async requestOwnWindow({processId,appDir,task}={}){
      if(starting)throw Error('Another computer-control request is already waiting.')
      if(!Number.isSafeInteger(processId)||processId<=0)throw Error('A launched program is required.')
      // The app may hand its window to a child process, so a window from the same app folder also counts.
      // Only Nori's own creative-app folder qualifies; the dialog below is still Wil's grant.
      const folder=typeof appDir==='string'&&/[\\/]integrations[\\/]artcraft[\\/]apps[\\/][^\\/]+/i.test(appDir)&&!appDir.includes('..')
        ?appDir.toLowerCase().replace(/\//g,'\\').replace(/\\+$/,''):null
      const owner=getWindow(),version=generation
      if(!owner||owner.isDestroyed?.())throw Error('Nori’s window is not available to ask for approval.')
      const valid=()=>generation===version&&getWindow()===owner&&!owner?.isDestroyed?.()
      starting=true
      try{
        const [sessions,worker]=await load()
        let selected=null
        for(let attempt=0;attempt<30&&!selected;attempt++){
          const windows=(await worker.executeWindowsComputerAction({operation:'list_windows'})).windows
          selected=windows.find(item=>item.processId===processId)??(folder?windows.find(item=>typeof item.path==='string'&&item.path.toLowerCase().startsWith(folder+'\\')):null)
          if(!selected)await new Promise(resolve=>setTimeout(resolve,1000))
          if(!valid())throw Error('Computer control owner changed or was stopped.')
        }
        if(!selected)throw Error('The program Nori opened has no window yet.')
        const lead=`Nori opened this program for your request${task?`:\n“${String(task).slice(0,300)}”`:'.'}`
        return await grant({sessions,worker,selected,owner,valid,detailLead:lead})
      }finally{starting=false}
    },
    async call(operation,args){
      if(operation==='status')return status()
      if(operation==='stop')return stop()
      if(operation==='request_own_window')return this.requestOwnWindow(args)
      status()
      if(!active)throw Error('Choose a window in Use my computer first.')
      const current=active
      const result=await current.session.call(operation,args)
      if(active!==current||!current.valid())throw Error('Computer control session was revoked.')
      return result
    },
  }
}
module.exports={createComputerHost}
