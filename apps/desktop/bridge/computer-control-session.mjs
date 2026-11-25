import {randomUUID} from 'node:crypto'

// The UI or the host's own dialog creates this session after Wil approves one window for one task.
// No model tool can create a grant, choose another program, or approve its own action.
//
// 2026-11-14 (Wil: "Approve once per task"): one approval covers the whole task (30 minutes, 120 actions)
// inside the approved program's own windows (its main window and its dialogs). Nori can see the window
// (capture), read its controls (inspect) and act on it: UI Automation controls, and clicks, scrolls, drags and
// typing posted to the window so Wil's own mouse and keyboard are not moved. A small floor still asks first:
// anything that deletes, overwrites, sends, publishes or pays, and any input that takes the real keyboard focus.
// Password controls are never exposed or targeted.
export const RISKY_LABEL=/\b(delete|remove|erase|discard|trash|overwrite|replace|send|post|publish|share|upload|submit|pay|buy|purchase|order|checkout|uninstall|format|empty|wipe|sign\s*out|log\s*out|close\s+without\s+saving|don'?t\s+save)\b/i
const ELEMENT_OPS=['invoke','set_text','toggle','expand','collapse','select']
const POINT_OPS=['click','double_click','right_click','scroll','drag']
const ALL_OPS=['windows','inspect','capture',...ELEMENT_OPS,...POINT_OPS,'type_text','key']
const ARG_KEYS={windows:[],inspect:['windowHandle'],capture:['windowHandle','maxWidth'],
  invoke:['snapshotId','elementId'],toggle:['snapshotId','elementId'],expand:['snapshotId','elementId'],collapse:['snapshotId','elementId'],
  select:['snapshotId','elementId'],set_text:['snapshotId','elementId','text'],
  click:['windowHandle','x','y'],double_click:['windowHandle','x','y'],right_click:['windowHandle','x','y'],
  scroll:['windowHandle','x','y','notches'],drag:['windowHandle','x','y','x2','y2'],
  type_text:['windowHandle','text'],key:['windowHandle','keys','foreground']}

export function createComputerControlSession({windowHandle,processId,approved,execute,confirmAction,now=Date.now,minutes=30,maxActions=120,title=''}) {
  if(approved!==true||!Number.isSafeInteger(windowHandle)||windowHandle<=0||!Number.isSafeInteger(processId)||processId<=0
    ||typeof execute!=='function'||typeof confirmAction!=='function')throw Error('A user-approved target window and action confirmation handler are required.')
  const id=randomUUID(),expires=now()+Math.min(60,Math.max(1,minutes))*60_000,controller=new AbortController()
  const snapshots=new Map(),captures=new Map(),windowTitles=new Map([[windowHandle,String(title)]])
  let busy=false,actions=0,lastSnapshot=null
  const active=()=>{if(controller.signal.aborted||now()>=expires)throw Error('Computer control is stopped or expired.')}
  const run=request=>execute({...request,processId},{signal:controller.signal})
  // Only windows of the approved program: its main window and the dialogs it opens.
  const ownWindow=async handle=>{
    const target=handle??windowHandle
    if(!Number.isSafeInteger(target)||target<=0)throw Error('Invalid window.')
    if(target===windowHandle)return target
    const listed=await run({operation:'process_windows',windowHandle})
    const found=listed?.windows?.find(item=>item.windowHandle===target&&item.processId===processId)
    if(!found)throw Error('That window does not belong to the approved program.')
    windowTitles.set(target,String(found.title??''))
    return target
  }
  const point=(target,value,name)=>{
    const shot=captures.get(target)
    if(!shot)throw Error('Capture the window before pointing at it.')
    if(!Number.isInteger(value)||value<0||value>(name.startsWith('x')?shot.windowWidth:shot.windowHeight))throw Error('Point is outside the window.')
    return value
  }
  const elementAt=(target,x,y)=>{
    const snap=[...snapshots.values()].filter(item=>item.windowHandle===target).at(-1)
    if(!snap)return null
    return snap.elements.filter(e=>Array.isArray(e.rect)&&x>=e.rect[0]&&y>=e.rect[1]&&x<=e.rect[0]+e.rect[2]&&y<=e.rect[1]+e.rect[3])
      .sort((a,b)=>a.rect[2]*a.rect[3]-b.rect[2]*b.rect[3])[0]??null
  }
  const riskyWindow=target=>RISKY_LABEL.test(windowTitles.get(target)??'')&&target!==windowHandle
  const ask=async action=>{
    const decision=await confirmAction(Object.freeze({sessionId:id,windowHandle:action.windowHandle,processId,...action}))
    active()
    if(decision!==true)throw Error('Wil did not approve that action.')
  }
  const sanitize=element=>{
    if(!element||typeof element.id!=='string'||element.id.length>200||typeof element.name!=='string'
      ||element.name.length>1000||element.password!==false)throw Error('Unsafe computer observation.')
    const rect=Array.isArray(element.rect)&&element.rect.length===4&&element.rect.every(Number.isInteger)?Object.freeze([...element.rect]):null
    return Object.freeze({id:element.id,name:element.name,controlType:String(element.controlType).slice(0,100),rect,
      canInvoke:element.canInvoke===true,canSetText:element.canSetText===true,canToggle:element.canToggle===true,
      canExpand:element.canExpand===true,canSelect:element.canSelect===true,password:false})
  }
  return Object.freeze({id,windowHandle,processId,expiresAt:expires,
    stop(){snapshots.clear();captures.clear();controller.abort()},
    async call(operation,args={}){
      active()
      if(busy)throw Error('A computer action is already running.')
      if(!args||typeof args!=='object'||Array.isArray(args))throw Error('Invalid computer arguments.')
      if(!ALL_OPS.includes(operation))throw Error('Unsupported computer action.')
      if(Object.keys(args).some(key=>!ARG_KEYS[operation].includes(key)))throw Error('Unexpected computer arguments.')
      busy=true
      try{
        if(operation==='windows'){
          const listed=await run({operation:'process_windows',windowHandle})
          active()
          const windows=(listed?.windows??[]).filter(item=>item.processId===processId).slice(0,20)
            .map(item=>{windowTitles.set(item.windowHandle,String(item.title??''));return {windowHandle:item.windowHandle,title:String(item.title??'').slice(0,200),width:item.width,height:item.height}})
          return {sessionId:id,windows}
        }
        if(operation==='inspect'){
          const target=await ownWindow(args.windowHandle)
          const result=await run({operation,windowHandle:target})
          active()
          if(!result||!Array.isArray(result.elements)||result.elements.length>200)throw Error('Invalid computer observation.')
          const elements=result.elements.map(sanitize)
          if(new Set(elements.map(element=>element.id)).size!==elements.length)throw Error('Duplicate computer elements.')
          lastSnapshot={id:randomUUID(),at:now(),windowHandle:target,elements}
          snapshots.set(lastSnapshot.id,lastSnapshot)
          while(snapshots.size>4)snapshots.delete(snapshots.keys().next().value)
          return {sessionId:id,snapshotId:lastSnapshot.id,windowHandle:target,processId,elements}
        }
        if(operation==='capture'){
          const target=await ownWindow(args.windowHandle)
          const maxWidth=Number.isInteger(args.maxWidth)?args.maxWidth:1024
          const shot=await run({operation,windowHandle:target,maxWidth})
          active()
          if(!['image/png','image/jpeg'].includes(shot?.mimeType)||typeof shot.data!=='string'||!Number.isInteger(shot.windowWidth)||!Number.isInteger(shot.windowHeight)
            ||!(shot.scale>0&&shot.scale<=1))throw Error('Invalid window capture.')
          captures.set(target,{windowWidth:shot.windowWidth,windowHeight:shot.windowHeight,at:now()})
          return {sessionId:id,windowHandle:target,mimeType:shot.mimeType,data:shot.data,windowWidth:shot.windowWidth,windowHeight:shot.windowHeight,scale:shot.scale}
        }
        if(actions>=maxActions)throw Error('Computer session action limit reached.')
        if(ELEMENT_OPS.includes(operation)){
          const snapshot=snapshots.get(args.snapshotId)
          if(!snapshot||now()-snapshot.at>60_000)throw Error('Inspect the target window again before acting.')
          const element=snapshot.elements.find(item=>item.id===args.elementId)
          const allowed={invoke:'canInvoke',set_text:'canSetText',toggle:'canToggle',expand:'canExpand',collapse:'canExpand',select:'canSelect'}[operation]
          if(!element||!element[allowed])throw Error('Element does not support that action.')
          if(operation==='set_text'&&(typeof args.text!=='string'||args.text.length>4000||args.text.includes('\0')))throw Error('Text must be bounded and contain no null characters.')
          if(operation!=='set_text'&&(RISKY_LABEL.test(element.name)||riskyWindow(snapshot.windowHandle)))
            await ask({operation,windowHandle:snapshot.windowHandle,element,reason:'This control may delete, overwrite, send or pay.'})
          snapshots.delete(snapshot.id)
          actions++
          const result=await run({operation,windowHandle:snapshot.windowHandle,elementId:element.id,
            expectedName:element.name,expectedControlType:element.controlType,...(operation==='set_text'?{text:args.text}:{})})
          active()
          if(result?.completed!==true)throw Error('Windows did not confirm the action.')
          return {sessionId:id,operation,completed:true,verificationRequired:true}
        }
        const target=await ownWindow(args.windowHandle)
        const request={operation,windowHandle:target}
        if(POINT_OPS.includes(operation)){
          request.x=point(target,args.x,'x');request.y=point(target,args.y,'y')
          if(operation==='drag'){request.x2=point(target,args.x2,'x2');request.y2=point(target,args.y2,'y2')}
          if(operation==='scroll'){if(!Number.isInteger(args.notches)||args.notches===0||Math.abs(args.notches)>20)throw Error('Scroll by 1 to 20 notches.');request.notches=args.notches}
          const under=elementAt(target,request.x,request.y)
          if(['click','double_click'].includes(operation)&&(RISKY_LABEL.test(under?.name??'')||riskyWindow(target)))
            await ask({operation,windowHandle:target,element:under,x:request.x,y:request.y,reason:'The click lands on a control that may delete, overwrite, send or pay.'})
        }
        if(operation==='type_text'){
          if(typeof args.text!=='string'||!args.text.length||args.text.length>4000||args.text.includes('\0'))throw Error('Text must be bounded and contain no null characters.')
          request.text=args.text
        }
        if(operation==='key'){
          if(typeof args.keys!=='string'||!/^[a-z0-9+ ]{1,40}$/i.test(args.keys))throw Error('Invalid key combination.')
          request.keys=args.keys;request.foreground=args.foreground===true
          if(request.foreground)await ask({operation,windowHandle:target,keys:args.keys,reason:'This brings the window to the front and uses the real keyboard for a moment.'})
        }
        actions++
        const result=await run(request)
        active()
        if(result?.completed!==true)throw Error('Windows did not confirm the action.')
        return {sessionId:id,operation,completed:true,verificationRequired:true}
      }finally{busy=false}
    },
  })
}
