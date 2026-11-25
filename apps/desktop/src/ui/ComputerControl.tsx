import {useEffect,useState} from 'react'

type Target={windowHandle:number;processId:number;title:string}
type Status={active:boolean;title?:string}
declare global {
  interface Window {
    noriComputer?:{list:()=>Promise<Target[]>;start:(target:Target)=>Promise<Status>;status:()=>Promise<Status>;stop:()=>Promise<Status>}
  }
}

export function ComputerControl(){
  const [open,setOpen]=useState(false),[targets,setTargets]=useState<Target[]>([]),[selected,setSelected]=useState('')
  const [status,setStatus]=useState<Status>({active:false}),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  useEffect(()=>{
    const update=()=>void window.noriComputer?.status().then(value=>setStatus(value||{active:false})).catch(()=>{})
    update();const timer=setInterval(update,2000);return()=>clearInterval(timer)
  },[])
  const choose=async()=>{
    setError('');setBusy(true)
    try{
      if(!window.noriComputer)throw Error('Computer control is unavailable in this build.')
      const windows=await window.noriComputer.list();setTargets(windows);setOpen(true)
    }catch(error){setError(String(error instanceof Error?error.message:error))}finally{setBusy(false)}
  }
  const start=async()=>{
    const target=targets.find(item=>String(item.windowHandle)===selected)
    if(!target)return
    setBusy(true);setError('')
    try{setStatus(await window.noriComputer!.start(target))}catch(error){setError(String(error instanceof Error?error.message:error))}finally{setBusy(false)}
  }
  return <div style={{padding:'8px 0',fontSize:12}}>
    <button className="nori-new-chat" onClick={()=>void choose()} disabled={busy}>Use my computer</button>
    {status.active&&<><p>Approved window: {status.title}</p><button onClick={()=>void window.noriComputer?.stop().then(setStatus)}>Stop computer control</button></>}
    {open&&<div><p>Choose the window Nori may inspect. Every typing or button action asks for approval.</p>
      <select aria-label="Computer target window" value={selected} onChange={event=>setSelected(event.target.value)} style={{maxWidth:'100%'}}>
        <option value="">Choose a window</option>{targets.map(target=><option key={target.windowHandle} value={target.windowHandle}>{target.title}</option>)}
      </select><button disabled={busy||!selected} onClick={()=>void start()}>Allow selected window</button>
      <p>Then ask: “Use my computer to …”</p></div>}
    {error&&<p role="alert">{error}</p>}
  </div>
}
