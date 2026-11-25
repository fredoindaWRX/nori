/** Consume a model pull only when its stream explicitly reports success. */
async function consumeModelProgress(body, onProgress) {
  const reader=body.getReader()
  const decoder=new TextDecoder()
  let pending='';let success=false
  const consume=(line)=>{
    if(!line.trim())return
    const progress=JSON.parse(line)
    if(progress.error)throw new Error(String(progress.error))
    if(progress.status==='success')success=true
    const count=(value)=>Number.isFinite(Number(value)) && Number(value)>=0 ? Number(value) : 0
    onProgress({status:String(progress.status||'Preparing model').slice(0,256),completed:count(progress.completed),total:count(progress.total)})
  }
  try {
    while(true){
      const {done,value}=await reader.read()
      pending+=decoder.decode(value||new Uint8Array(),{stream:!done})
      const lines=pending.split('\n');pending=lines.pop()||''
      if(pending.length>65536 || lines.some(line=>line.length>65536))throw new Error('Model progress record is too large.')
      for(const line of lines)consume(line)
      if(done){consume(pending);break}
    }
    if(!success)throw new Error('Model download ended before success was confirmed.')
  } finally {
    await reader.cancel().catch(()=>{})
    reader.releaseLock()
  }
}
module.exports={consumeModelProgress}
