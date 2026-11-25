import {spawnSync} from 'node:child_process'
import {randomUUID,createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {resolve,join} from 'node:path'

export function appendProjectEvent(root,kind,summary,evidence=[]) {
  const result=spawnSync(join(root,'python/Python311/python.exe'),
    ['-B',join(root,'tools/project_journal.py'),'--kind',kind,'--summary',summary,
      ...evidence.flatMap(path=>['--evidence',path])],
    {shell:false,windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:65536})
  if(result.error||result.status!==0)throw Error('Project journal unavailable; workflow is not audit-complete')
  return JSON.parse(result.stdout)
}

export function snapshotProjectHistory(root) {
  const result=spawnSync(join(root,'python/Python311/python.exe'),
    ['-B',join(root,'tools/project_journal.py'),'--snapshot'],
    {shell:false,windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:65536})
  if(result.error||result.status!==0)throw Error('Project history snapshot failed; history preserved, workflow is not audit-complete')
  return JSON.parse(result.stdout)
}

// Record only fixed operation labels, source digests and outcome. Never record
// command arguments, environments, private output or exception messages.
export async function journalWorkflow(kind,label,source,action,{root=resolve(import.meta.dirname,'../../..'),write=appendProjectEvent,seal}={}) {
  if(!['build','package','verify','deploy','test'].includes(kind)||
      !/^[a-z0-9-]{1,64}$/.test(label)||typeof action!=='function')throw Error('Invalid workflow journal contract')
  const hash=createHash('sha256').update(readFileSync(join(root,source))).digest('hex')
  const id=randomUUID(),prefix=`${label} run=${id} source_sha256=${hash}`
  const snapshot=seal??(write===appendProjectEvent?snapshotProjectHistory:()=>{})
  write(root,kind,`${prefix} started`,[source])
  let value
  try { value=await action() }
  catch(error) {
    try { write(root,'failure',`${prefix} failed; no completion claimed`,[source]);snapshot(root) }
    catch(journalError) {throw new AggregateError([error,journalError],'Workflow failed and terminal audit record could not be written')}
    throw error
  }
  write(root,kind,`${prefix} completed; installed/release qualification is separate`,[source])
  snapshot(root)
  return value
}
