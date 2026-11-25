// Read-only revalidation of previously staged state; never activate or repair.
import { desktopStateSplitPlan } from './desktop-state-split-plan.mjs'
import { buildComponentManifest } from './component-integrity.mjs'
import { verifyPrivateStatePlan } from './private-state-plan.mjs'
import { verifyPrivateStateSource, verifyPrivateStateCopy } from './private-state-integrity.mjs'
import { desktopStatePartSnapshot } from './stage-desktop-state-layout.mjs'

export function verifyDesktopStateCopy(root, source) {
  const plan = desktopStateSplitPlan(root, source, { inspectExistingDestination: true })
  verifyPrivateStatePlan(root, plan.full, { inspectExistingDestination: true })
  const snapshot = {
    schema: 1, fileCount: plan.full.files.length, directories: [...plan.full.directories],
    manifest: plan.full.files.length ? buildComponentManifest(plan.source, plan.full.files.map(file => file.path)) : null,
  }
  verifyPrivateStateSource(root, plan.full, snapshot)
  for (const part of [plan.private, plan.browser]) {
    verifyPrivateStateCopy(part.destination, desktopStatePartSnapshot(snapshot, part))
  }
  verifyPrivateStateSource(root, plan.full, snapshot)
  return {
    privateFiles: plan.private.files.length, browserFiles: plan.browser.files.length,
    totalBytes: plan.full.bytes, sourceContentMatches: true, copyInventoryMatches: true,
    sourceVerifiedBeforeAndAfter: true, stateChanged: false,
    permissionsVerified: false, quiescenceVerified: false, activationAuthorized: false,
  }
}
