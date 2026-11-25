import {writeFileSync,linkSync,unlinkSync} from 'node:fs'
import {join} from 'node:path'
import {randomBytes} from 'node:crypto'
// The caller already owns/validates the generated Job fixture. A fully written
// same-directory hard link publishes atomically and cannot replace a foreign
// destination. Failure preserves the staging file for inspection.
export function publishJobMembership(fixture,membership){
  const bytes=JSON.stringify(membership)
  if(Buffer.byteLength(bytes)>65536)throw Error('Job membership publication exceeds bound')
  const staging=join(fixture,'.owned-job-membership-'+randomBytes(16).toString('hex')+'.tmp')
  const target=join(fixture,'owned-job-membership.json')
  writeFileSync(staging,bytes,{flag:'wx'})
  linkSync(staging,target)
  // Exact, newly generated temporary name only; the published link remains.
  unlinkSync(staging)
}
