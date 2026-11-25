// Process-local capability only. Disk records and matching paths cannot mint
// reuse authority. The owning runner, not its readiness callback, holds finish.
export function createGuardedRestartRegistry(){
  const records=new WeakMap()
  const freeze=value=>{
    if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}
    return value
  }
  return Object.freeze({
    issue(data){
      const handle=Object.freeze({syntheticOnly:true,desktopLayout:'consolidated-v1'})
      records.set(handle,{data:freeze(structuredClone(data)),status:'fresh',cycle:0})
      return handle
    },
    begin(handle){
      const record=records.get(handle)
      if(!record)throw Error('Original process-local guarded restart capability required')
      if(!['fresh','reusable'].includes(record.status))throw Error('Guarded restart state is active or poisoned; explicit recovery required')
      record.status='active'
      let finished=false
      return Object.freeze({data:record.data,cycle:record.cycle,previousReadiness:record.previousReadiness,
        finish(success,readiness){
          if(finished)throw Error('Guarded restart cycle already finalized')
          finished=true;record.status='poisoned'
          if(success!==true)return
          if(typeof readiness?.sha256!=='string'||!/^[a-f0-9]{64}$/.test(readiness.sha256)||
            typeof readiness?.fixture!=='string')throw Error('Successful guarded restart requires captured readiness evidence')
          record.previousReadiness=Object.freeze({...readiness})
          record.cycle++;record.status='reusable'
        }})
    },
  })
}
