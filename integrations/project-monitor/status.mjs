import { readFile, lstat, realpath } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
const canonicalRoot=fileURLToPath(new URL('../../',import.meta.url))
const run = promisify(execFile)
const CAP = 512 * 1024
export async function evidence(root, name) {
  if (!/^[A-Za-z0-9_.-]+\.(?:md|json)$/.test(name)) throw new Error('Evidence filename is not allowed')
  const file = path.join(root, name)
  try {
    const info = await lstat(file)
    if (!info.isFile() || info.isSymbolicLink() || info.size > CAP) return { exists: false, unavailable: true }
    return { exists: true, updatedAt: info.mtime.toISOString(), text: await readFile(file, 'utf8') }
  } catch { return { exists: false } }
}
export async function gitStatus(repo) {
  try {
    const root=await realpath(repo)
    const environment={...process.env,GIT_OPTIONAL_LOCKS:'0'}
    // Never inherit a caller's alternate checkout/index selection.
    for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_INDEX_FILE'])delete environment[key]
    const options = { cwd: repo, timeout: 2500, maxBuffer: 32768, windowsHide: true,
      env: environment }
    const top=await run('git',['-c','core.hooksPath=','rev-parse','--show-toplevel'],options)
    const normalize=value=>process.platform==='win32'?value.toLowerCase():value
    if(normalize(await realpath(top.stdout.trim()))!==normalize(root))return {available:false}
    const results = await Promise.allSettled([
      run('git', ['-c', 'core.hooksPath=', 'rev-parse', 'HEAD'], options),
      run('git', ['-c', 'core.hooksPath=', 'status', '--porcelain', '--untracked-files=no'], options),
    ])
    if(results.some(result=>result.status!=='fulfilled'))return {available:false}
    const [head,status]=results.map(result=>result.value)
    return { available: true, head: head.stdout.trim(), cleanTracked: !status.stdout.trim(),
      changedTrackedFiles: status.stdout.trim().split('\n').filter(Boolean).length }
  } catch { return { available: false } }
}
export async function snapshot(root = path.join(canonicalRoot,'verification'), canonical = canonicalRoot) {
  const [handoff, returned, runtime, free, replay, canonicalGit, coordinatorGit, progress, uiBuild, roadmapEvidence] = await Promise.all([
    evidence(root, 'SHARED_HANDOFF_TO_CLINE_2026-09-29.md'),
    evidence(root, 'CLINE_COORDINATOR_REPAIR_RETURN_2026-09-29.md'),
    evidence(root, 'RUNTIME_VALIDATION_PROGRESS_2026-09-29.md'),
    evidence(root, 'FREE_LOCAL_RECOVERY_HANDOFF_2026-09-29.md'),
    evidence(root, 'NORI_MERGED_UI_REPLAY_RECEIPT_2026-09-29.json'),
    gitStatus(canonical), gitStatus(path.join(canonical, 'dev/worktrees/autopilot-safety')),
    evidence(root, 'PROJECT_PROGRESS.json'),
    evidence(root, 'NORI_UI_BUILD_PROGRESS_2026-09-29.json'),
    evidence(canonical, 'ROADMAP_TRACKING.json'),
  ])
  let recovery = { status: 'No current receipt' }
  if (replay.exists) {
    try { const r = JSON.parse(replay.text); recovery = { status: 'Source recovered; build not verified',
      applied: r.applied, total: r.operations, held: r.held?.length ?? null, updatedAt: replay.updatedAt } } catch {}
  }
  if (uiBuild.exists) try {
    const b = JSON.parse(uiBuild.text)
    if (b.kind === 'nori-ui-build-evidence' && b.buildPassed === true) {
      recovery.status = 'Recorded build passed; live integration still unverified'
      recovery.buildUpdatedAt = uiBuild.updatedAt
      recovery.testsPassed = Number.isInteger(b.testsPassed) && b.testsPassed >= 0 ? b.testsPassed : null
    }
  } catch {}
  let work = { summary: 'Recovery and verification in progress', blockers: [] }
  let roadmap={available:false}
  if(roadmapEvidence.exists)try {
    const r=JSON.parse(roadmapEvidence.text)
    if(r.schema_version===1&&Array.isArray(r.requirements)&&Array.isArray(r.components)){
      roadmap={available:true,releaseState:r.release_state==='VERIFIED'?'VERIFIED':'NOT_VERIFIED',
        requirementCount:r.requirements.length,componentCount:r.components.length,
        updatedAt:roadmapEvidence.updatedAt}
      if(!progress.exists)work.summary=`Nori release ${roadmap.releaseState}; ${roadmap.requirementCount} roadmap requirements tracked. Component tests do not establish full release readiness.`
    }
  }catch{}
  if (progress.exists) try {
    const p = JSON.parse(progress.text)
    work = { summary: String(p.summary ?? '').slice(0,500), updatedAt: progress.updatedAt,
      blockers: Array.isArray(p.blockers) ? p.blockers.slice(0,8).map(x=>String(x).slice(0,200)) : [] }
  } catch {}
  // Expose statuses, never raw handoffs, prompts, filesystem paths, model keys or task logs.
  return { observedAt: new Date().toISOString(), readOnly: true, work, recovery, roadmap, canonical: canonicalGit,
    coordinator: { ...coordinatorGit, returnAvailable: returned.exists, returnUpdatedAt: returned.updatedAt,
      taskLiveness: 'Not established by a handoff or an open app' },
    evidence: { handoff: handoff.updatedAt, runtime: runtime.updatedAt, freeLocal: free.updatedAt },
    notices: ['Nori inference stays free/local; this monitor does not invoke AI.',
      'Test reports are evidence from their recorded runs, not automatic live retests.',
      'No automatic main merge or installation.'] }
}
