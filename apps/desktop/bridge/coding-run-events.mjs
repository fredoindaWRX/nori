/** Host-owned coding metadata; never model text or an approval channel. */
import { randomUUID } from 'node:crypto'

const ID = /^[a-f0-9]{32}$/
const PHASES = new Set(['registered','inspecting','awaiting_session_consent','scope_ready','queued','editing','verifying','completed','blocked','failed','cancelled'])
const boundedText = (value, bytes) => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= bytes
const relative = value => typeof value === 'string' && value.length <= 240 && value.length > 0
  && !/[\x00-\x1f\x7f\\:]/.test(value) && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..')

export function codingOwnerBinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || !ID.test(value.ownerTurnId) || !ID.test(value.runId) || value.runId !== value.taskId) return null
  return Object.freeze({ ownerTurnId: value.ownerTurnId, runId: value.runId, taskId: value.taskId })
}

export function codingRunEvent(value, binding) {
  const expected = codingOwnerBinding(binding)
  if (!expected || !value || typeof value !== 'object' || Array.isArray(value)
      || value.schema !== 'nori.coding-run-event.v1' || value.owner_turn_id !== expected.ownerTurnId
      || value.run_id !== expected.runId || value.task_id !== expected.taskId
      || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.sequence > 1e9
      || !PHASES.has(value.phase) || !boundedText(value.message, 8000) || value.message.length > 2000) return null
  if (value.changed_files !== undefined && (!Array.isArray(value.changed_files) || value.changed_files.length > 24 || !value.changed_files.every(relative))) return null
  if (value.diff !== undefined && !boundedText(value.diff, 32768)) return null
  if (value.verification !== undefined) {
    const v = value.verification
    if (!v || typeof v !== 'object' || Array.isArray(v) || !['not_run','running','passed','failed','cancelled','blocked'].includes(v.status)
        || !['python-unittest','node-test'].includes(v.runner) || !(v.exit_code === null || Number.isSafeInteger(v.exit_code))
        || !boundedText(v.stdout,65536) || !boundedText(v.stderr,65536)
        || typeof v.output_truncated !== 'boolean' || typeof v.process_tree_stopped !== 'boolean') return null
  }
  return { schema:value.schema,owner_turn_id:value.owner_turn_id,run_id:value.run_id,task_id:value.task_id,sequence:value.sequence,phase:value.phase,message:value.message,
    ...(value.changed_files !== undefined ? {changed_files:[...value.changed_files]} : {}),
    ...(value.diff !== undefined ? {diff:value.diff} : {}),
    ...(value.verification !== undefined ? {verification:{status:value.verification.status,runner:value.verification.runner,
      exit_code:value.verification.exit_code,stdout:value.verification.stdout,stderr:value.verification.stderr,
      output_truncated:value.verification.output_truncated,process_tree_stopped:value.verification.process_tree_stopped}} : {}) }
}

/** One private request to this Electron-owned bridge process; never retry uncertain admission. */
export async function requestCodingAdmission(binding, { signal, channel = process, timeoutMs = 15000, cleanupOnly = false } = {}) {
  const bound = codingOwnerBinding(binding)
  if (!bound || typeof channel.send !== 'function' || channel.connected === false) throw Error('Owned coding session admission is unavailable.')
  if (!cleanupOnly) signal?.throwIfAborted()
  const id = randomUUID()
  return new Promise((resolve,reject) => {
    let settled=false
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);channel.removeListener('message',receive);channel.removeListener('disconnect',disconnected);signal?.removeEventListener('abort',abort);error?reject(error):resolve(result)}
    const abort=()=>finish(signal.reason || Error('Coding admission cancelled.'))
    const disconnected=()=>finish(Error('Owned coding admission disconnected; inspect the task before retrying.'))
    const receive=message=>{
      if (message?.kind!=='nori-coding-admission-result'||message.id!==id) return
      if (message.error) return finish(Error('Owned coding admission failed; no execution is confirmed.'))
      const result=message.result,event=codingRunEvent(result?.event,bound)
      if (cleanupOnly) {
        if (!result || result.authorized!==false || result.taskId!==bound.taskId || !['cancelled','blocked','failed','completed'].includes(result.status) || !event) return finish(Error('Owned coding cleanup could not be verified.'))
        return finish(null,{authorized:false,taskId:bound.taskId,status:result.status,event,cleanupConfirmed:result.status==='cancelled'})
      }
      if (!result || result.authorized!==true || result.taskId!==bound.taskId || result.status!=='queued' || !event) return finish(Error('Owned coding session did not authorize this exact task; inspect the task before retrying.'))
      finish(null,{authorized:true,taskId:bound.taskId,status:'queued',event})
    }
    const timer=setTimeout(()=>finish(Error('Owned coding admission timed out; inspect the task before retrying.')),timeoutMs)
    channel.on('message',receive);channel.once('disconnect',disconnected);if(!cleanupOnly)signal?.addEventListener('abort',abort,{once:true})
    try { channel.send({kind:'nori-coding-admission',id,...bound,...(cleanupOnly?{cleanupOnly:true}:{})},error=>{if(error)finish(Error('Owned coding admission could not be sent.'))}) } catch { finish(Error('Owned coding admission could not be sent.')) }
  })
}
