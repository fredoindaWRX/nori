process.env.NORI_VIDEO_OUTPUT_ROOT='C:/Nori/media-runtime/output'
const {startVideoCapableModelService}=require('./video-capable-model.cjs')
const {startAutomaticTextService}=require('./automatic-text-service.cjs')
const {createModelCapacityCheck}=require('./model-resource-fit.cjs')
const {releaseVideoRuntime}=require('./video-runtime-cleanup.cjs')
const { app, BrowserWindow, session, shell, Menu, Tray, nativeImage, screen, desktopCapturer, ipcMain, dialog } = require('electron')
// Diagnoses unexplained clean exits: records what asked the app to stop. Observation only.
try {
  const traceExit = what => console.error(`[nori-desktop] EXIT TRACE ${what} at ${new Date().toISOString()}: ${String(new Error().stack).split('\n').slice(3, 8).map(line => line.trim()).join(' <- ')}`)
  for (const name of ['quit', 'exit']) { const original = app[name].bind(app); app[name] = (...args) => { traceExit(`app.${name}`); return original(...args) } }
  const originalExit = process.exit.bind(process)
  process.exit = (...args) => { traceExit('process.exit'); return originalExit(...args) }
  app.on('before-quit', () => traceExit('before-quit'))
  app.on('session-end', () => traceExit('windows session-end'))
} catch (error) { console.error('[nori-desktop] exit trace unavailable', error?.message) }
if (process.argv.includes('--nori-wake-resident')||process.argv.includes('--nori-wake-resident-qualify')) {
  void require('./wake-resident-bootstrap.cjs').bootstrapWakeResident(require('electron'))
  return
}
const { workspaceLayout, fitWindowBounds } = require('./workspace-layout.cjs')
const { installContextMenu } = require('./context-menu.cjs')
const { createSkillInstaller } = require('./skill-installer.cjs')
const { createMemoryMap } = require('./memory-map.cjs')
const { createInsideMap } = require('./inside-map.cjs')
const { shouldAnimateIconFrames } = require('./icon-policy.cjs')
const { installDisplayMediaHandler } = require('./display-media.cjs')
const { installMediaPermissionHandlers } = require('./media-permission-policy.cjs')
const { displayImages } = require('./capture-size.cjs')
const { managedSpawn: spawn } = require('./managed-child.cjs')
const { installationIntent } = require('./installation-intent.cjs')
const { nativeModelStatus } = require('./native-model-status.cjs')
const { desktopImportedModelProfile } = require('./imported-model-profile.cjs')
const IMPORTED_MODEL_PROFILE = desktopImportedModelProfile({packaged:app.isPackaged,args:process.argv})
const NATIVE_QWEN = process.argv.includes('--nori-native-qwen')
const { appIdentity } = require('./app-identity.cjs')
const { localPage } = require('./local-page.cjs')
const { speechPagePolicy } = require('./speech-page-policy.cjs')
const { createWakeWindow } = require('./wake-window.cjs')
const { createWakeActivation } = require('./wake-activation.cjs')
const wakeActivation = createWakeActivation(process.argv)
const { acquireForegroundMicrophoneLease } = require('./foreground-microphone-lease.cjs')
const { bindWindowStartup } = require('./window-startup.cjs')
const { nativeRuntimeMode, packagedRuntimeMode, startNativeService, startGptOssService, resolveGptOssContextTokens } = require('./native-service.cjs')
process.env.NORI_INFERENCE_RUNTIME = packagedRuntimeMode({
  packaged: app.isPackaged, args: process.argv, environment: process.env,
})
process.env.NORI_GPT_OSS_ENABLED = process.env.NORI_INFERENCE_RUNTIME === 'gpt-oss' ? '1' : '0'
if (process.argv.includes('--nori-gpt-oss-heretic')) process.env.NORI_GPT_OSS_HERETIC = '1'
else process.env.NORI_GPT_OSS_HERETIC = '0'
const CODEX_LOCAL_PROVIDER = process.argv.includes('--nori-codex-provider')
if (CODEX_LOCAL_PROVIDER && (process.env.NORI_INFERENCE_RUNTIME !== 'gpt-oss' || process.argv.includes('--nori-gpt-oss-heretic'))) {
  throw new Error('The Codex local provider requires the base GPT-OSS profile')
}
process.env.NORI_CODEX_LOCAL_PROVIDER = CODEX_LOCAL_PROVIDER ? '1' : '0'
const { startNativeCore } = require('./native-core.cjs')
const { handInputPaths } = require('./input-paths.cjs')
const { startNativeDesktop, clearUnavailableRuntimeCredentials, nativeCoreEndpoint } = require('./native-desktop-startup.cjs')
const { workerEnvironment } = require('./worker-environment.cjs')
const { acquireStateOwner, recoverDeadOwnerRecord } = require('./state-owner.cjs')
const { acquireDesktopStateOwners } = require('./desktop-state-startup.cjs')
const { drainDesktopWriters, onceDesktopShutdown } = require('./desktop-writers.cjs')
const { startProjectMonitor } = require('./project-monitor.cjs')
const { createRemoteControlServer } = require('./remote-control-service.cjs')
const { tailscaleRemoteContext } = require('./tailscale-remote-context.cjs')
const { rendererConnection } = require('./connection-config.cjs')
const { createWorkspaceProjectReader } = require('./workspace-project-reader.cjs')
const { createWorkspaceAppDrafts } = require('./workspace-app-drafts.cjs')
const { workspaceProbe } = require('./workspace-probe.cjs')
const { probeSessionData } = require('./probe-session-data.cjs')
const { browserStorageFixture } = require('./browser-storage-fixture.cjs')
const { desktopStateSelection } = require('./desktop-state-selection.cjs')
const { reportProbeFailure } = require('./probe-failure.cjs')
const { inspectProbeRenderer } = require('./probe-renderer-readiness.cjs')
const { createDesktopSessionOutcome } = require('./desktop-session-outcome.cjs')
const { createDesktopLifecycleJournal, resolveDesktopJournalRoot } = require('./desktop-lifecycle-journal.cjs')
const { comfyLaunchArgs, waitForComfyStartup } = require('./comfy-startup.cjs')
const { createImageRuntimeLifecycle } = require('./image-runtime-lifecycle.cjs')
const desktopSessionState = createDesktopSessionOutcome()
const manageInstallation = installationIntent(process.argv)
const { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, writeSync } = require('node:fs')
const { createServer } = require('node:http')
const { extname, join, resolve } = require('node:path')

// Nori is commonly launched from a wrapper that may close its own console
// pipe after starting Electron. Node/Vite's logger writes asynchronously, so
// without this guard that benign condition becomes an uncaught main-process
// EPIPE and takes the desktop app down with it.
for (const stream of [process.stdout, process.stderr]) {
  stream?.on('error', (error) => {
    if (error?.code === 'EPIPE') return
    throw error
  })
}

const ROOT = resolve(__dirname, '..')
const DIST = join(ROOT, 'dist')
const SUITE_ROOT = app.isPackaged ? join(process.resourcesPath, 'NoriSuite') : resolve(ROOT, '..', '..')
const PROBE_SESSION = workspaceProbe(SUITE_ROOT, process.argv, process.env)
const CONSOLIDATED_STATE = !PROBE_SESSION || PROBE_SESSION.layoutRoot
  ? desktopStateSelection({suiteRoot:SUITE_ROOT,appRoot:ROOT,packaged:app.isPackaged,
    executable:process.execPath,probeLayoutRoot:PROBE_SESSION?.layoutRoot,stateLayout:process.env.NORI_STATE_LAYOUT})
  : null
if (CONSOLIDATED_STATE && !['norllama', 'gpt-oss'].includes(nativeRuntimeMode())) throw Error('Consolidated state requires an explicit local runtime; rollback layout refused')
const USER_DATA_ROOT = CONSOLIDATED_STATE ? CONSOLIDATED_STATE.desktop : PROBE_SESSION ? PROBE_SESSION.directory : app.isPackaged
  ? join(process.env.LOCALAPPDATA || app.getPath('userData'), 'Nori')
  : join(SUITE_ROOT, 'runtime-data')
if (app.isPackaged || PROBE_SESSION || CONSOLIDATED_STATE) app.setPath('userData', USER_DATA_ROOT)
// Validate separation on synthetic profiles first. Existing production profiles
// require explicit migration; do not silently strand their cookies/localStorage.
const PROBE_BROWSER_ROOT = CONSOLIDATED_STATE ? CONSOLIDATED_STATE.browser : PROBE_SESSION ? probeSessionData(SUITE_ROOT, USER_DATA_ROOT) : null
if (PROBE_BROWSER_ROOT) app.setPath('sessionData', PROBE_BROWSER_ROOT)
const COUNCIL_ROOT = join(SUITE_ROOT, 'nori')
const OLLAMA_ROOT = join(SUITE_ROOT, 'ollama')
// Packaged weights live beside the rest of the installed suite. Inno Setup
// grants write access only to this model-store directory so Ollama can pull or
// remove optional models without making the app binaries writable.
const OLLAMA_MODELS = join(SUITE_ROOT, 'models')
const OLLAMA_URL = `http://127.0.0.1:${Number(process.env.NORI_OLLAMA_PORT || (app.isPackaged ? 11435 : 11434))}`
const COUNCIL_PORT = Number(process.env.NORI_COUNCIL_PORT || (app.isPackaged ? 19107 : 9107))
const COUNCIL_URL = `http://127.0.0.1:${COUNCIL_PORT}`
const COUNCIL_HEALTH_URL = `${COUNCIL_URL}/health`
// Windows uses the multi-resolution ICO for taskbar clarity; PNG remains a
// fallback for the browser/app surfaces that prefer it.
const ICON = existsSync(join(ROOT, 'public', 'nori-neural-icon.ico'))
  ? join(ROOT, 'public', 'nori-neural-icon.ico')
  : existsSync(join(ROOT, 'public', 'nori-icon.ico'))
  ? join(ROOT, 'public', 'nori-icon.ico')
  : join(ROOT, 'public', 'nori-icon.png')
const LOCAL_STT_PYTHON = process.platform === 'win32'
  ? join(app.isPackaged ? SUITE_ROOT : ROOT, app.isPackaged ? 'apps' : '', app.isPackaged ? 'NoriV2' : '', '.venv-stt', 'Scripts', 'python.exe')
  : join(ROOT, '.venv-stt', 'bin', 'python')
const HOST = '127.0.0.1'
const JOURNAL_CANONICAL_ROOT = 'C:\\Nori'
const FACE_PORT = Number(process.env.NORI_DESKTOP_PORT || (app.isPackaged ? 15188 : 5188))
const FACE_ORIGIN = `http://${HOST}:${FACE_PORT}`
const BRIDGE_PORT = Number(process.env.NORI_BRIDGE_PORT || (app.isPackaged ? 18787 : 8787))
const BRIDGE_URL = `http://${HOST}:${BRIDGE_PORT}/health`
const LEGACY_BUS_URL = process.env.NORI_EVENT_BUS_HEALTH_URL || 'http://127.0.0.1:9390/health'
const LEGACY_BUS_SCRIPT = join(SUITE_ROOT, 'cortana_event_bus.py')
const COMFY_PORTABLE_ROOT = join(SUITE_ROOT, 'integrations', 'image-generation', 'runtime', 'ComfyUI_windows_portable')
const COMFY_ROOT = join(COMFY_PORTABLE_ROOT, 'ComfyUI')
const COMFY_PYTHON = join(COMFY_PORTABLE_ROOT, 'python_embeded', 'python.exe')
const COMFY_PORT = Number(process.env.NORI_COMFY_PORT || (app.isPackaged ? 18188 : 8188))
const COMFY_URL = `http://127.0.0.1:${COMFY_PORT}/system_stats`
const HAND_INPUT_PORT = Number(process.env.NORI_HAND_INPUT_PORT || (app.isPackaged ? 19393 : 9393))
const HAND_INPUT_URL = `http://127.0.0.1:${HAND_INPUT_PORT}/input`
const HAND_INPUT_SCRIPT = join(app.isPackaged ? SUITE_ROOT : ROOT, app.isPackaged ? 'apps/desktop/bridge/system_hand_input.py' : 'bridge/system_hand_input.py')
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.wasm': 'application/wasm',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.woff2': 'font/woff2',
}

// Persist privacy-safe lifecycle milestones in the canonical append-only
// project journal. The helper is deliberately best-effort so a journal issue
// never prevents Nori from opening or cleaning up owned services.
const lifecycleJournal = createDesktopLifecycleJournal(resolveDesktopJournalRoot(SUITE_ROOT, JOURNAL_CANONICAL_ROOT))
function journalLifecycle(event, details) {
  const result = lifecycleJournal.record(event, {runtime:RUNTIME_MODE, packaged:app.isPackaged, ...details})
  if (!result.recorded && result.reason !== 'journal-unavailable') {
    console.warn('[nori-desktop] Lifecycle journal event not recorded')
  }
}
const desktopSession = Object.freeze({
  ...desktopSessionState,
  fail(code) {
    desktopSessionState.fail(code)
    journalLifecycle('failure', {code})
  },
  bootCompleted() {
    const completed = desktopSessionState.bootCompleted()
    if (completed) journalLifecycle('boot-completed')
    return completed
  },
  rendererLoaded() {
    const loaded = desktopSessionState.rendererLoaded()
    if (loaded) journalLifecycle('renderer-loaded')
    return loaded
  },
  beginQuit() {
    desktopSessionState.beginQuit()
    journalLifecycle('shutdown-started')
  },
  cleanupCompleted(success) { desktopSessionState.cleanupCompleted(success) },
  ownershipCompleted(success) { desktopSessionState.ownershipCompleted(success) },
  snapshot() { return desktopSessionState.snapshot() },
})

let window = null
let bridge = null
let codingSession = null
let computerHost = null
let browserHost = null
let council = null
let ollama = null
let nativeService = null
let gptOssService = null
let embeddingService = null
// The automatic text service (model router) and the OBS stream-mode detector that re-routes it.
let automaticTextService = null, streamMode = null, floatOrb = null
// Owner, 2026-11-16: "desktop it should just be the form with a box to type what i want". Her everyday face is the
// floating window again: her form with a type box under it; a press on her form opens the app. (2026-11-10 to
// 2026-11-16 this was off, "no text bar, just the app".) The same page feeds her state to the cooler screen.
const FLOATING_BAR = true
let gptOssCore = null
let foregroundMicrophoneLease = null
let foregroundMicrophoneHeld = process.platform !== 'win32' || nativeRuntimeMode() !== 'norllama'
let nativeExitObservation = null
let gptOssExitObservation = null
let gptOssCoreExitObservation = null
let projectMonitor = null
let remoteControl = null
let remoteControlOrigin = null
const projectMonitorOwner = new AbortController()
const RUNTIME_MODE = nativeRuntimeMode()
// Packaged runtime weights belong to this NoriSuite (including USB installs);
// source development uses the checkout root. Never reach back to build PC.
const GPT_OSS_ROOT = SUITE_ROOT
const REMOTE_CONTROL_ONLY = process.env.NORI_REMOTE_CONTROL_ONLY === '1'
if (process.env.NORI_REMOTE_CONTROL_ONLY !== undefined && !['0', '1'].includes(process.env.NORI_REMOTE_CONTROL_ONLY)) {
  throw new Error('Invalid remote-control-only mode')
}
if (RUNTIME_MODE === 'gpt-oss' && REMOTE_CONTROL_ONLY) throw new Error('GPT-OSS chat mode cannot be combined with remote-control-only mode')
let nativeCleanupDone = false
let desktopStateOwner = null
let browserStateOwner = null
let desktopCleanupVerified = false
let desktopBootPending = null
let desktopStartupCleanupFailed = false
const desktopStartupOwner = new AbortController()
let legacyBus = null
let face = null
let comfy = null
let lastOwnedComfyChild = null
let handInput = null
const handInputKey = require('node:crypto').randomBytes(48).toString('base64url')
let tray = null
let isQuitting = false
// One stray click on the tray item must not stop her: the owner asked for a confirmation.
let quitPromptOpen = false
async function confirmTrayQuit() {
  if (quitPromptOpen) return
  quitPromptOpen = true
  try {
    const { response } = await dialog.showMessageBox({ type: 'question', title: 'Quit Nori?', message: 'Quit Nori?',
      detail: 'She stops listening and shuts down until you start her again.',
      buttons: ['Keep her running', 'Quit Nori'], defaultId: 0, cancelId: 0, noLink: true })
    console.error(`[nori-desktop] Tray quit prompt answered: ${response === 1 ? 'quit' : 'keep running'}`)
    if (response === 1) app.quit()
  } finally { quitPromptOpen = false }
}
let iconFrames = []
let iconFrame = 0
let iconTimer = null
let spanningWorkspace = false
let normalWindowBounds = null
let workspaceResize = null

function workspaceState() {
  const layout = workspaceLayout(screen.getAllDisplays(), screen.getPrimaryDisplay().id)
  const viewport = window && !window.isDestroyed() ? window.getContentBounds() : layout.bounds
  return { ...layout, viewport, spanning: spanningWorkspace, maximized: Boolean(window && !window.isDestroyed() && window.isMaximized()), enabled: spanningWorkspace && layout.screens.length > 1 }
}

function publishWorkspace() {
  if (window && !window.isDestroyed()) window.webContents.send('nori:workspace:changed', workspaceState())
}

/** Nori's intended single-monitor window, centered in a display's work area.
 *  The Electron display API supplies the work area, so no resolution is
 *  hard-coded — the window follows whichever monitor is selected. */
function centeredWindowBounds(workArea, width, height) {
  const w = Math.min(Math.max(640, width), workArea.width)
  const h = Math.min(Math.max(480, height), workArea.height)
  return { x: workArea.x + Math.round((workArea.width - w) / 2),
    y: workArea.y + Math.round((workArea.height - h) / 2), width: w, height: h }
}

function arrangeWorkspace() {
  if (!window || window.isDestroyed()) return
  const layout = workspaceLayout(screen.getAllDisplays(), screen.getPrimaryDisplay().id)
  if (spanningWorkspace) {
    if (window.isFullScreen()) window.setFullScreen(false)
    if (window.isMaximized()) window.unmaximize()
    window.setBounds(layout.bounds)
  } else {
    // Single-monitor mode: Nori lives on one display, centered, at her intended
    // size, so the reactor sits mid-screen instead of over the monitor seam.
    window.setBounds(centeredWindowBounds(screen.getPrimaryDisplay().workArea, 1440, 940))
  }
  publishWorkspace()
}

function toggleWorkspace() {
  if (!window || window.isDestroyed()) return
  if (spanningWorkspace) {
    spanningWorkspace=false
    const primary=screen.getPrimaryDisplay().workArea
    const restore=normalWindowBounds || centeredWindowBounds(primary,1440,940)
    window.setBounds(fitWindowBounds(restore,screen.getDisplayMatching(restore).workArea))
  } else {
    normalWindowBounds=window.getBounds()
    spanningWorkspace=true
    arrangeWorkspace()
  }
  publishWorkspace()
}

function configureWorkspace() {
  const owns = (event) => window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
  const verificationBroker = require('./fixed-verification-broker.cjs').createFixedVerificationBroker({
    runtime: { suiteRoot: SUITE_ROOT, python: join(SUITE_ROOT, 'python', 'Python311', 'python.exe'),
      ...(existsSync(join(SUITE_ROOT, 'tools', 'rea', 'node.exe')) ? { node: join(SUITE_ROOT, 'tools', 'rea', 'node.exe') } : {}) },
    getCore: () => PROBE_SESSION || isQuitting ? null : (gptOssCore || nativeService?.core) })
  codingSession = require('./coding-session.cjs').createCodingSession({ owns, verificationBroker,
    rememberStore: require('./coding-grants.cjs').createCodingGrants({ file: join(USER_DATA_ROOT, 'settings', 'coding-grants.json'),
      log: message => console.warn(`[nori-desktop] ${message}`) }),
    // "Your code" means hers (owner, 2026-11-16): a self-code request switches to her own self-development workspace
    // for this session; any other coding request switches back to the project the owner chose. The consent prompt for
    // each project is unchanged.
    ensureProject: async rawGoal => {
      const { isSelfCodeRequest } = await import('../bridge/self-code-workspace.mjs')
      if (isSelfCodeRequest(rawGoal)) {
        const { resolveAiderWorkspace } = await import('../bridge/aider-tools.mjs')
        const own = resolveAiderWorkspace(rawGoal, { ...process.env, NORI_ROOT: SUITE_ROOT, NORI_SUITE_ROOT: SUITE_ROOT, NORI_APP_DATA_ROOT: USER_DATA_ROOT, NORI_AIDER_WORKSPACE_ROOT: '' })
        if (typeof own !== 'string' || !own) throw Error('Nori\'s self-development workspace could not be prepared')
        const result = await workerWorkspace.switchTo(own)
        if (result.changed) console.warn('[nori-desktop] Coding project switched to Nori\'s self-development workspace')
        return
      }
      const saved = workerWorkspace.automaticWorkspace() ? workerWorkspace.savedWorkspace() : null
      if (saved) { await workerWorkspace.switchTo(saved, { automatic: false }); console.warn('[nori-desktop] Coding project switched back to the owner\'s project') }
    },
    getCore: () => PROBE_SESSION || isQuitting ? null : (gptOssCore || nativeService?.core),
    getProject: () => process.env.NORI_AIDER_WORKSPACE_ROOT || null,
    ask: async ({ project, policy, effects, verificationProfiles }) => {
      if (typeof project !== 'string' || project.length > 2048 || typeof policy !== 'string' || policy.length > 4096
          || !Array.isArray(effects) || effects.length > 12 || effects.some(effect => typeof effect !== 'string' || effect.length > 2048)
          || !Array.isArray(verificationProfiles) || verificationProfiles.length > 4) throw Error('Invalid coding consent policy')
      const profiles = JSON.stringify(verificationProfiles, null, 2)
      if (profiles.length > 8192) throw Error('Oversized trusted-test policy')
      const trustedTests = verificationProfiles.length ? profiles : 'No trusted test runner is available; automatic test execution is disabled.'
      const result = await dialog.showMessageBox(window, { type: 'warning',
        title: 'Allow Nori coding in this project?', message: 'Allow this project? Nori will remember it until you stop allowing it.',
        detail: `Project:
${project}

Nori may carry out new coding requests you send after this approval, using at most 24 editable files and 24 read-only files within this project. Existing queued tasks are not approved.

Policy:\n${policy}\n\nDeclared effects:\n${effects.join('\n')}\n\nTrusted test profiles (fixed host command templates and validated file rules):\n${trustedTests}\n\nThis also enables the local coding worker. Code and any authorized trusted tests run with your Windows account access; this is not an OS or network sandbox. Imported project code may have side effects. Stop or revoke the session at any time. The grant expires and is invalidated by project or Core changes.`,
        buttons: ['Cancel', 'Allow this project'], defaultId: 0, cancelId: 0, noLink: true })
      return result.response === 1
    },
    sendProgress: progress => {
      if (!isQuitting && window && !window.isDestroyed()) window.webContents.send('nori:coding:progress', progress)
    } })
  ipcMain.handle('nori:coding:session:grant', event => codingSession.grant(event))
  ipcMain.handle('nori:coding:session:revoke', (event, options) => codingSession.revoke(event, options?.forget === true ? { forget: true } : undefined))
  ipcMain.handle('nori:coding:session:status', event => codingSession.status(event))
  // Coding happens in her own chat loop (owner, 2026-11-24): the request goes out as an ordinary message, with no
  // project consent form and no background job. NORI_INLINE_CODING=0 restores the reviewed job.
  ipcMain.handle('nori:coding:turn:register', (event, args) => process.env.NORI_INLINE_CODING !== '0'
    ? { registered: false, reason: 'not_coding', coding: false, clientTurnId: args?.clientTurnId }
    : codingSession.registerTurn(event, args))
  ipcMain.handle('nori:coding:run:status', (event, binding) => codingSession.status(event, binding))
  ipcMain.handle('nori:coding:run:stop', (event, binding) => codingSession.stop(event, binding))
  const workerWorkspace = require('./worker-workspace.cjs').createWorkerWorkspace({ dataRoot: USER_DATA_ROOT, owns,
    activeWorkspace: process.env.NORI_AIDER_WORKSPACE_ROOT || null,
    activate: async workspace => {
      const core = gptOssCore || nativeService?.core
      if (!core?.workerApprovalKey) throw Error('Owned Core is unavailable')
      const base = nativeCoreEndpoint(core, null)
      const response = await fetch(`${base}/work/worker/project`, { method: 'POST',
        headers: { authorization: `Bearer ${core.environment.NORI_API_TOKEN}`, origin: base,
          'content-type': 'application/json', 'X-Nori-Worker-Approval': core.workerApprovalKey },
        body: JSON.stringify({ workspace }), signal: AbortSignal.timeout(15000) })
      const receipt = await response.json()
      if (!response.ok) throw Error(receipt.error || 'Project switch refused; finish or cancel pending tasks first')
      if (receipt.workspace?.toLowerCase() !== workspace.toLowerCase() || receipt.restartRequired !== false) throw Error('Invalid project-switch receipt')
      process.env.NORI_AIDER_WORKSPACE_ROOT = workspace
      process.env.NORI_AIDER_BACKGROUND = '1'
      bridge?.send({ kind: 'nori-worker-project', workspace })
      return receipt
    },
    choose: async () => {
      if (PROBE_SESSION) throw new Error('Project selection is disabled in the acceptance session')
      const result = await dialog.showOpenDialog(window, { title: 'Choose Nori coding project', properties: ['openDirectory'] })
      return result.canceled ? null : result.filePaths[0]
    } })
  ipcMain.handle('nori:worker:workspace:read', event => workerWorkspace.read(event))
  ipcMain.handle('nori:worker:workspace:select', event => {
    if (!owns(event)) throw Error('Workspace selection must come from Nori')
    codingSession?.invalidate('project-selection')
    return workerWorkspace.select(event)
  })
  const confirmWorker = require('./worker-confirmation.cjs').createWorkerConfirmation({ owns,
    getCore: () => PROBE_SESSION ? null : (gptOssCore || nativeService?.core),
    ask: async review => {
      const result = await dialog.showMessageBox(window, { type: 'question',
        title: 'Confirm Nori coding task', message: review.goal,
        detail: `Attempt ${review.attempt}\n\nEditable files:\n${review.files.join('\n')}\n\nRead-only context:\n${review.context.join('\n') || 'None'}\n\nThis confirms this attempt only. Worker capability approval and safety checks still apply.`,
        buttons: ['Cancel', 'Confirm this task'], defaultId: 0, cancelId: 0, noLink: true })
      return result.response === 1
    } })
  ipcMain.handle('nori:worker:confirm', (event, taskId) => confirmWorker(event, taskId))
  const confirmSystem = require('./system-confirmation.cjs').createSystemConfirmation({ owns,
    getCore: () => PROBE_SESSION ? null : (gptOssCore || nativeService?.core),
    ask: async ({ activation, review }) => {
      const command = review?.command
      const detail = activation
        ? 'System commands run with your Windows account access, not inside a file or network sandbox. Every command still needs separate approval. Disabling blocks future dispatch; it does not stop running tasks.'
        : `Executable: ${command.executable}\nSHA-256: ${command.executable_sha256}\nArguments (JSON): ${JSON.stringify(command.arguments)}\nWorking folder: ${command.working_directory}\nDeadline: ${command.timeout_seconds} seconds\nDeclared effects (not an enforced sandbox):\n${command.effects.join('\n')}\n\nAttempt ${review.attempt}. Approves only this exact command attempt.`
      const result = await dialog.showMessageBox(window, { type: 'warning',
        title: 'Nori System Neuron', message: activation ? `${activation === 'enable' ? 'Enable' : 'Disable'} System Neuron?` : 'Run this System command?',
        detail, buttons: ['Cancel', activation ? 'Confirm permission change' : 'Run this command'],
        defaultId: 0, cancelId: 0, noLink: true })
      return result.response === 1
    } })
  ipcMain.handle('nori:system:confirm', (event, taskId) => confirmSystem(event, taskId))
  const systemActivity = require('./system-activity.cjs').createSystemActivity({ owns,
    getCore: () => PROBE_SESSION ? null : (gptOssCore || nativeService?.core) })
  ipcMain.handle('nori:system:activity', (event, action, id) => systemActivity(event, action, id))
  const proactiveActivity = require('./proactive-activity.cjs').createProactiveActivity({ owns,
    getCore: () => PROBE_SESSION ? null : (gptOssCore || nativeService?.core) })
  ipcMain.handle('nori:proactive:activity', (event, action, id) => proactiveActivity(event, action, id))
  const createSchedule = require('./proactive-create.cjs').createProactiveSchedule({ owns,
    getCore: () => PROBE_SESSION ? null : (gptOssCore || nativeService?.core),
    ask: async review => (await dialog.showMessageBox(window, { type: 'warning', title: 'Nori scheduled routine',
      message: 'Authorize this bounded recurring goal?',
      detail: `Goal:\n${review.goal}\n\nInterval: ${review.intervalSeconds} seconds\nMaximum runs: ${review.maxRuns}\n\nRuns while Nori is available. This does not approve coding edits or System commands; their separate approvals still apply.`,
      buttons: ['Cancel', 'Authorize routine'], defaultId: 0, cancelId: 0, noLink: true })).response === 1 })
  ipcMain.handle('nori:proactive:create', (event, proposal) => createSchedule(event, proposal))
  const revealArtifact = require('./artifact-reveal.cjs').revealArtCraftArtifact({
    dataRoot: USER_DATA_ROOT, owns, showItemInFolder: file => shell.showItemInFolder(file),
  })
  ipcMain.handle('nori:artifact:reveal', (event, args) => revealArtifact(event, args))
  computerHost = require('./computer-host.cjs').createComputerHost({dialog,getWindow:()=>window,owns})
  browserHost = require('./browser-host.cjs').createBrowserHost({ dialog, getWindow: () => window, owns })
  ipcMain.handle('nori:browser:start', (event, target) => browserHost.start(event, target))
  ipcMain.handle('nori:browser:status', event => owns(event) ? browserHost.status() : null)
  ipcMain.handle('nori:browser:stop', event => owns(event) ? browserHost.stop() : null)
  ipcMain.handle('nori:computer:list',event=>computerHost.list(event))
  ipcMain.handle('nori:computer:start',(event,target)=>computerHost.start(event,target))
  ipcMain.handle('nori:computer:status',event=>owns(event)?computerHost.status():null)
  ipcMain.handle('nori:computer:stop',event=>owns(event)?computerHost.stop():null)
  const remoteAccessStatus = require('./remote-access-status.cjs').remoteAccessStatus
  ipcMain.handle('nori:remote-access:read', event => remoteAccessStatus(event, {
    owns, serviceActive: Boolean(remoteControl), origin: remoteControlOrigin,
  }))
  const projectReader = createWorkspaceProjectReader({ root: SUITE_ROOT, owns,
    loadTools: () => import('../bridge/project-tools.mjs') })
  const appDrafts = createWorkspaceAppDrafts({ root: USER_DATA_ROOT, owns,
    loadVerifier: () => import('../bridge/neuralese-app-spec.mjs') })
  const revealOnWake = createWakeWindow({ owns,
    allowed: () => !PROBE_SESSION && !isQuitting, show: showFace })
  ipcMain.handle('nori:wake:reveal', event => revealOnWake(event))
  ipcMain.handle('nori:wake:consume', event => {
    if (!window || event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame || PROBE_SESSION || isQuitting) return false
    return wakeActivation.consume()
  })
  ipcMain.on('nori:connection:read', (event) => { event.returnValue = owns(event) ? rendererConnection(BRIDGE_PORT, Boolean(PROBE_SESSION), HAND_INPUT_PORT) : null })
  ipcMain.handle('nori:workspace:read', (event) => owns(event) ? workspaceState() : null)
  ipcMain.handle('nori:workspace:project:list', (event, args) => projectReader.list(event, args))
  ipcMain.handle('nori:workspace:project:read', (event, args) => projectReader.read(event, args))
  ipcMain.handle('nori:workspace:app-drafts:list', event => appDrafts.list(event))
  ipcMain.handle('nori:workspace:app-drafts:read', (event, args) => appDrafts.read(event, args))
  ipcMain.handle('nori:workspace:app-drafts:activate', (event, args) => appDrafts.activate(event, args))
  ipcMain.handle('nori:workspace:apps:read', (event, args) => appDrafts.readApp(event, args))
  ipcMain.handle('nori:workspace:apps:records', (event, args) => appDrafts.records(event, args))
  ipcMain.handle('nori:workspace:apps:record:create', (event, args) => appDrafts.createRecord(event, args))
  ipcMain.handle('nori:workspace:apps:record:update', (event, args) => appDrafts.updateRecord(event, args))
  ipcMain.handle('nori:workspace:apps:record:delete', (event, args) => appDrafts.deleteRecord(event, args))
  ipcMain.handle('nori:hand:input', async (event, input) => {
    if (!owns(event) || PROBE_SESSION || !handInput || handInput.exitCode !== null) return false
    if (!input || typeof input !== 'object' || Object.keys(input).sort().join(',') !== 'pinch,x,y'
        || typeof input.pinch !== 'boolean' || ![input.x,input.y].every(value=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1)) return false
    try {
      const response=await fetch(HAND_INPUT_URL,{method:'POST',redirect:'error',signal:AbortSignal.timeout(500),
        headers:{origin:FACE_ORIGIN,authorization:`Bearer ${handInputKey}`,'content-type':'application/json'},body:JSON.stringify(input)})
      return response.ok
    } catch { return false }
  })
  ipcMain.handle('nori:screen:capture-displays', async (event) => {
    if (!owns(event)) return []
    if (PROBE_SESSION) throw new Error('Screen capture is disabled in the workspace acceptance session')
    const displays = screen.getAllDisplays()
    const maxWidth = Math.max(640, ...displays.map((display) => Math.min(1280, display.size.width)))
    const maxHeight = Math.max(360, ...displays.map((display) => Math.min(720, display.size.height)))
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: maxWidth, height: maxHeight },
    })
    return displayImages(displays, sources)
  })
  ipcMain.handle('nori:workspace:command', (event, command) => {
    if (!owns(event)) return null
    if (command === 'minimize') window.minimize()
    else if (command === 'toggle-maximize') window.isMaximized() ? window.unmaximize() : window.maximize()
    else if (command === 'hide') window.hide()
    else if (command === 'quit') { app.quit(); return null }
    else if (command === 'toggle-span') {
      toggleWorkspace()
    }
    publishWorkspace()
    return workspaceState()
  })
  const displaysChanged = () => {
    clearTimeout(workspaceResize)
    workspaceResize = setTimeout(arrangeWorkspace, 200)
  }
  screen.on('display-added', displaysChanged)
  screen.on('display-removed', displaysChanged)
  screen.on('display-metrics-changed', displaysChanged)
}

function configureModelManager() {
  const owns = (event) => window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
  ipcMain.handle('nori:app:identity', (event) => owns(event) ? appIdentity({
    executable: process.execPath, suiteRoot: SUITE_ROOT, stateRoot: USER_DATA_ROOT,
    packaged: app.isPackaged, version: app.getVersion(), runtime: RUNTIME_MODE,
  }) : null)
  ipcMain.handle('nori:models:status', (event) => {
    if (!owns(event)) return { installed: false, online: false }
    return nativeModelStatus(nativeService, { runtimeMode: RUNTIME_MODE, gptOssService })
  })
  for (const channel of ['nori:models:install-deep', 'nori:models:remove-deep']) {
    ipcMain.handle(channel, (event) => {
      if (!owns(event)) return { ok: false, error: 'This request did not come from Nori.' }
      return { ok: false, error: 'SoN model activation is pending. Automatic model downloads and removal are unavailable.' }
    })
  }
}
app.setName('N.O.R.I.')
// The opted-in local wake phrase can start the boot voice without requiring a
// preliminary click. Audio output still begins only in response to that wake.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
if (process.platform === 'win32') app.setAppUserModelId('ai.nori.desktop')

const ownsDesktopInstance = app.requestSingleInstanceLock()
if (!ownsDesktopInstance) app.quit()
// Acquire cooperative exclusion synchronously before ready and before creating
// any session/window. Failed acquisition never creates or adopts state.
if (ownsDesktopInstance && CONSOLIDATED_STATE) {
  const ownership = acquireDesktopStateOwners({
    desktopDirectory: CONSOLIDATED_STATE.desktop,
    browserDirectory: CONSOLIDATED_STATE.browser,
    acquireStateOwner
  })
  desktopStateOwner = ownership.desktopOwner
  browserStateOwner = ownership.browserOwner
  if (ownership.error) {
    const details = ownership.error.code === 'EEXIST'
      ? 'Another Nori session is using this private workspace. Close the other session and try again. If Nori previously crashed, its leftover lock can be recovered safely.'
      : `Nori could not open its private workspace. ${ownership.error.message}`
    dialog.showErrorBox('N.O.R.I. could not open its workspace', details)
    app.exit(1)
  }
}
app.on('child-process-gone', (_event, details) => { console.error(`[nori-desktop] Child process gone: ${details?.type} ${details?.reason} code ${details?.exitCode}`) })
app.on('second-instance', (_event, argv) => {
  if (argv.includes('--nori-install-skill')) { void openNoriSkillInstaller(argv); return }
  if (argv.includes('--nori-skill-code-approve')) { void approveNoriSkillCode(argv); return }
  if (argv.includes('--nori-connector-approve')) { void approveNoriConnectorAction(argv); return }
  wakeActivation.request(argv)
  manageInstallation.request(argv)
  if (!window) return
  // Her everyday face is the text bar (owner, 2026-11-10): starting Nori again brings that up. The full
  // window comes forward only if it is already open or a model-management request needs it.
  if (!manageInstallation.pending() && !window.isVisible()) { showFace(); return }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  if (!window.webContents.isLoading() && manageInstallation.consume()) window.webContents.send('nori:models:show')
})

ipcMain.on('nori:models:open', (event) => {
  if (window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame) {
    window.webContents.send('nori:models:show')
  }
})

function localFile(url) {
  return localPage(url, DIST, FACE_ORIGIN)
}

function versionDesktopAssets(html) {
  // Code-only updates can replace bytes at an existing asset filename. Give
  // those references a content-derived URL so an older immutable cache entry
  // cannot hide the update. Resolve only through the existing local-page guard.
  return html.replace(/\b(src|href)=(["'])(\/assets\/[^"'<>]+)\2/g, (match, attribute, quote, reference) => {
    const url = new URL(reference, FACE_ORIGIN)
    if (url.origin !== FACE_ORIGIN || !/^\/assets\/[A-Za-z0-9._/-]+$/.test(url.pathname)) return match
    const asset = localFile(url.href)
    if (asset === join(DIST, 'index.html')) throw new Error('Desktop asset is unavailable')
    const digest = require('node:crypto').createHash('sha256').update(readFileSync(asset)).digest('hex')
    url.searchParams.set('nori_asset', digest)
    return attribute + '=' + quote + url.pathname + url.search + url.hash + quote
  })
}

function startFace() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error('Desktop assets are missing. Run npm run build first.')
  }
  // Memory labels are her own words: withheld from the page whenever OBS is running.
  const memoryMap = createMemoryMap(USER_DATA_ROOT, { hideLabels: () => Boolean(streamMode?.obsRunning) })
  const insideMap = createInsideMap({ dataRoot: USER_DATA_ROOT, suiteRoot: SUITE_ROOT, profiles: require('./imported-model-profile.cjs').importedModelProfile,
    hide: () => Boolean(streamMode?.obsRunning) })
  face = createServer((request, response) => {
    // Her face draws one node per real memory: positions and hash prefixes only, never memory text.
    if ((request.url || '').split('?')[0] === '/memory-map') {
      response.setHeader('content-type', 'application/json')
      response.setHeader('cache-control', 'no-store')
      response.end(JSON.stringify(memoryMap()))
      return
    }
    // Blocks for what else is inside her: Knights, brains, connected systems, skills, folders, projects. Names,
    // counts and yes/no states only; paths are withheld while OBS is running.
    if ((request.url || '').split('?')[0] === '/inside-map') {
      response.setHeader('content-type', 'application/json')
      response.setHeader('cache-control', 'no-store')
      response.end(JSON.stringify(insideMap()))
      return
    }
    if ((request.url || '').split('?')[0] === '/orb-state') {
      response.setHeader('content-type', 'application/json')
      response.setHeader('cache-control', 'no-store')
      response.end(JSON.stringify(floatOrb?.state?.() ?? {}))
      return
    }
    const file = localFile(request.url || '/')
    response.setHeader('content-type', MIME[extname(file).toLowerCase()] || 'application/octet-stream')
    response.setHeader('cache-control', 'no-store')
    if (file === join(DIST, 'index.html')) {
      try {
        response.end(speechPagePolicy(versionDesktopAssets(readFileSync(file, 'utf8')), new URL(BRIDGE_URL).origin))
      } catch {
        response.statusCode = 500
        response.end('Local desktop speech policy is unavailable.')
      }
      return
    }
    createReadStream(file).on('error', () => {
      response.statusCode = 404
      response.end('Not found')
    }).pipe(response)
  })
  return new Promise((resolveReady, reject) => {
    face.once('error', reject)
    face.listen(FACE_PORT, HOST, resolveReady)
  })
}

async function bridgeIsUp() {
  try {
    const response = await fetch(BRIDGE_URL, { signal: AbortSignal.timeout(800) })
    return response.ok
  } catch { return false }
}

async function councilIsUp() {
  try { return (await fetch(COUNCIL_HEALTH_URL, { signal: AbortSignal.timeout(700) })).ok } catch { return false }
}

async function ollamaIsUp() {
  try { return (await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(700) })).ok } catch { return false }
}

function prepareSuiteRuntime() {
  if (!app.isPackaged) return
  const pythonRoots = { '3.10': 'Python310', '3.11': 'Python311' }
  const environments = [
    join(COUNCIL_ROOT, '.venv-architect'),
    join(SUITE_ROOT, 'apps', 'NoriV2', '.venv-stt'),
    join(SUITE_ROOT, 'data', 'voice-runtime'),
  ]
  for (const environment of environments) {
    const cfg = join(environment, 'pyvenv.cfg')
    if (!existsSync(cfg)) continue
    const text = readFileSync(cfg, 'utf8')
    const version = text.match(/^version\s*=\s*(\d+\.\d+)/mi)?.[1]
    const pythonHome = pythonRoots[version]
    if (!pythonHome) continue
    const portableHome = join(SUITE_ROOT, 'python', pythonHome)
    if (!existsSync(join(portableHome, 'python.exe'))) continue
    const rebased = text.replace(/^home\s*=.*$/mi, `home = ${portableHome}`)
    if (rebased !== text) writeFileSync(cfg, rebased)
  }
}

async function startOllama() {
  if (!app.isPackaged || await ollamaIsUp()) return
  const executable = join(OLLAMA_ROOT, 'ollama.exe')
  if (!existsSync(executable)) return
  ollama = spawn(executable, ['serve'], {
    cwd: OLLAMA_ROOT,
    env: { ...process.env, OLLAMA_HOST: new URL(OLLAMA_URL).host, OLLAMA_MODELS },
    stdio: 'ignore', windowsHide: true,
  })
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await ollamaIsUp()) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  ollama.kill()
  ollama = null
  throw new Error('The bundled local model service did not become ready.')
}

async function startCouncil() {
  if (!app.isPackaged || await councilIsUp()) return
  const python = join(COUNCIL_ROOT, '.venv-architect', 'Scripts', 'python.exe')
  const entry = join(COUNCIL_ROOT, 'main.py')
  if (!existsSync(python) || !existsSync(entry)) return
  const secret = join(USER_DATA_ROOT, 'secrets', 'council-token')
  if (!existsSync(secret)) {
    mkdirSync(join(USER_DATA_ROOT, 'secrets'), { recursive: true })
    writeFileSync(secret, require('node:crypto').randomBytes(48).toString('base64url'), { flag: 'wx', mode: 0o600 })
  }
  const token = readFileSync(secret, 'utf8').trim()
  if (token.length < 32) throw new Error('The local Council token is invalid.')
  process.env.NORI_API_TOKEN = token
  council = spawn(python, [entry], {
    cwd: COUNCIL_ROOT,
    env: {
      ...process.env,
      NORI_ROOT: SUITE_ROOT,
      NORI_SUITE_ROOT: SUITE_ROOT,
      NORI_APP_DATA_ROOT: USER_DATA_ROOT,
      NORI_DATA_ROOT: join(USER_DATA_ROOT, 'nori-data'),
      NORI_API_TOKEN: token,
      NORI_BIND: '127.0.0.1',
      NORI_OLLAMA_URL: OLLAMA_URL,
      OLLAMA_URL,
    },
    stdio: 'ignore', windowsHide: true,
  })
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await councilIsUp()) return
    if (council.exitCode !== null) break
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  council.kill()
  council = null
  throw new Error('The bundled Nori Council did not become ready.')
}

async function legacyBusIsUp() {
  try {
    const response = await fetch(LEGACY_BUS_URL, { signal: AbortSignal.timeout(350) })
    return response.ok
  } catch { return false }
}

async function startLegacyBus() {
  if (RUNTIME_MODE !== 'ollama-rollback') return
  if (await legacyBusIsUp() || !existsSync(LEGACY_BUS_SCRIPT)) return
  legacyBus = spawn(process.env.NORI_PYTHON || 'python', ['-u', LEGACY_BUS_SCRIPT], {
    cwd: resolve(ROOT, '..', '..'), env: process.env, stdio: 'ignore', windowsHide: true,
  })
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await legacyBusIsUp()) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  legacyBus.kill()
  legacyBus = null
}

async function comfyIsUp() {
  try { return (await fetch(COMFY_URL, { signal: AbortSignal.timeout(350) })).ok } catch { return false }
}

async function startComfy() {
  if (REMOTE_CONTROL_ONLY || PROBE_SESSION) return
  if (await comfyIsUp() || !existsSync(COMFY_PYTHON)) return
  const imageState='C:/Nori/media-runtime'
  const imageFolders=Object.fromEntries(['input','output','temp','user'].map(name=>[name,join(imageState,name)]))
  for(const directory of Object.values(imageFolders))mkdirSync(directory,{recursive:true})
  // Embedded Python's isolated configuration may ignore PYTHONDONTWRITEBYTECODE.
  // -B applies before any import and keeps the installed executable tree immutable.
  const args = comfyLaunchArgs({
    inputDirectory: imageFolders.input,
    outputDirectory: imageFolders.output,
    tempDirectory: imageFolders.temp,
    userDirectory: imageFolders.user,
    extraModelPaths: existsSync('C:/Nori/models/video/wan2.2/extra-model-paths.yaml')?'C:/Nori/models/video/wan2.2/extra-model-paths.yaml':undefined,
    port: COMFY_PORT,
  })
  comfy = spawn(COMFY_PYTHON, args, {
    cwd: COMFY_ROOT, env: {...process.env,PYTHONDONTWRITEBYTECODE:'1'}, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
  })
  const child = comfy
  lastOwnedComfyChild = child
  let stderrTail = ''
  child.stderr?.on('data', chunk => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4096)
  })
  const startup = await waitForComfyStartup(child, comfyIsUp)
  if (startup.status === 'ready') return
  console.warn('[nori-comfy] Local image runtime did not become ready:', startup.reason,
    startup.exitCode === undefined ? '' : `exit=${startup.exitCode}`,
    startup.error?.message || '', stderrTail.trim())
  if (child.exitCode !== null || child.signalCode !== null) comfy = null
  else if (child.kill()) comfy = null
}

const imageRuntime = createImageRuntimeLifecycle({
  start: () => startComfy(),
  isOwnedAlive: () => Boolean(comfy && comfy.exitCode === null && comfy.signalCode == null),
  queueBusy: async () => {
    const queue = await (await fetch(`http://127.0.0.1:${COMFY_PORT}/queue`, { signal: AbortSignal.timeout(2000) })).json()
    return (queue?.queue_running?.length ?? 1) + (queue?.queue_pending?.length ?? 1) > 0
  },
  stop: async () => {
    const child = comfy
    if (!child || child.exitCode !== null) { comfy = null; return }
    const exited = new Promise(resolveExit => child.once('exit', resolveExit))
    child.kill()
    await Promise.race([exited, new Promise(resolveWait => setTimeout(resolveWait, 10_000))])
    if (comfy === child) comfy = null
  },
})

async function startHandInput() {
  // Never adopt an unrelated local mouse-control service.
  const paths = handInputPaths({root:SUITE_ROOT,packaged:app.isPackaged,runtimeMode:RUNTIME_MODE,
    python:app.isPackaged ? LOCAL_STT_PYTHON : process.env.NORI_PYTHON,
    script:HAND_INPUT_SCRIPT,cwd:app.isPackaged ? join(SUITE_ROOT,'apps','desktop') : ROOT})
  handInput = spawn(paths.python, paths.args, {
    cwd: paths.cwd,
    env: { ...process.env, NORI_HAND_INPUT_PORT: String(HAND_INPUT_PORT), NORI_DESKTOP_ORIGIN: FACE_ORIGIN, NORI_HAND_INPUT_KEY: handInputKey },
    stdio: 'ignore', windowsHide: true,
  })
}

async function startBridge() {
  if (await bridgeIsUp()) {
    if (RUNTIME_MODE !== 'ollama-rollback') throw new Error('Existing bridge cannot be adopted by the local runtime; its backend identity is not verified')
    return
  }
  const env = {
    ...process.env,
    // The desktop build owns a private Whisper environment. Pinning the
    // interpreter here keeps wake-word listening independent of whichever
    // Python (or browser speech API) happens to be installed on the machine.
      ...(RUNTIME_MODE === 'ollama-rollback' && existsSync(LOCAL_STT_PYTHON) ? { NORI_PYTHON: LOCAL_STT_PYTHON } : {}),
      ...(app.isPackaged && !PROBE_SESSION ? {
        NORI_STT_BACKEND: process.env.NORI_STT_BACKEND === 'whisper' ? 'whisper' : 'parakeet',
        NORI_PARAKEET_PYTHON: join(SUITE_ROOT, 'integrations/image-generation/runtime/ComfyUI_windows_portable/python_embeded/python.exe'),
      } : {}),
      ...(PROBE_SESSION ? { NORI_STT_BACKEND: 'whisper', NORI_PYTHON: join(USER_DATA_ROOT, 'missing-stt-interpreter.exe'), NORI_ALLOW_WRITES: '0' } : {}),
      NORI_WHISPER_MODEL: app.isPackaged
        ? join(SUITE_ROOT, 'data', 'whisper', 'base.en')
        : (process.env.NORI_WHISPER_MODEL || 'base.en'),
    NORI_ROOT: SUITE_ROOT,
    NORI_SUITE_ROOT: SUITE_ROOT,
    NORI_SKILL_DESKTOP_EXECUTABLE: process.execPath,
    NORI_SKILL_STORE: join(USER_DATA_ROOT, 'skills'),
    NORI_BUNDLED_WRITING_SKILLS: join(SUITE_ROOT, 'skills', 'bundled', 'avoid-ai-writing-3.38.0.zip'),
    NORI_APP_DATA_ROOT: USER_DATA_ROOT,
    NORI_DATA_ROOT: join(USER_DATA_ROOT, 'runtime-data'),
    NORI_SETTINGS_DIR: join(USER_DATA_ROOT, 'settings'),
    NORI_API_TOKEN_FILE: join(USER_DATA_ROOT, 'secrets', 'council-token'),
    NORI_API_TOKEN: process.env.NORI_API_TOKEN || '',
    NORI_OLLAMA_URL: OLLAMA_URL,
    // The owned Core chooses private ports at startup; never overwrite its
    // readiness-bound Architect endpoint with the legacy fixed port.
    // Remote-only mode deliberately has no Native Core process. Keep the
    // bridge's loopback-only fallback explicit; its Core-ready gate is false,
    // so chat cannot route work to this unavailable endpoint.
    NORI_COUNCIL_URL: REMOTE_CONTROL_ONLY ? COUNCIL_URL : nativeCoreEndpoint(gptOssCore || nativeService, COUNCIL_URL),
    NORI_COUNCIL_PORT: String(COUNCIL_PORT),
    NORI_COMFY_URL: `http://127.0.0.1:${COMFY_PORT}`,
    NORI_EVENT_BUS_HEALTH_URL: LEGACY_BUS_URL,
    NORI_EVENT_BUS_URL: process.env.NORI_EVENT_BUS_URL || 'http://127.0.0.1:9390/publish',
    NORI_DEFAULT_MODEL: process.env.NORI_DEFAULT_MODEL || 'qwen3.5:4b',
    NORI_STRONG_MODEL: process.env.NORI_STRONG_MODEL || 'qwen3.5:9b',
    NORI_BRIDGE_PORT: String(BRIDGE_PORT),
    NORI_TTS_WORKER: join(SUITE_ROOT, 'apps', 'desktop', 'bridge', 'kokoro_tts.py'),
    NORI_LOCAL_CHAT: process.env.NORI_LOCAL_CHAT ?? '1',
    // Screen analysis is opt-in and uses the pinned local GGUF vision model only.
    // The existing Windows OCR backend remains available as an explicit fallback mode.
    NORI_VISION_BACKEND: 'nori-local-gguf',
    NORI_LOCAL_VISION_BACKEND: gptOssService?.modelId === 'nori-auto' ? 'automatic-abliterated' : '',
    NORI_VISION_MODEL: '',
    NORI_VISION_OLLAMA_URL: process.env.NORI_VISION_OLLAMA_URL || OLLAMA_URL,
    NORI_ALLOWED_ORIGINS: [process.env.NORI_ALLOWED_ORIGINS, FACE_ORIGIN]
      .filter(Boolean).join(','),
    ELECTRON_RUN_AS_NODE: '1',
  }
  // Never inherit a caller-supplied mentor credential. Failure disables only
  // the mentor route; ordinary Nori startup and task approvals remain intact.
  env.NORI_MENTOR_TOKEN = ''
  if (!PROBE_SESSION && !REMOTE_CONTROL_ONLY) {
    const mentor = require('./mentor-startup.cjs').startMentorConnection({ dataRoot: USER_DATA_ROOT,
      credentialRoot: join(require('node:os').homedir(), '.nori'), port: BRIDGE_PORT })
    env.NORI_MENTOR_TOKEN = mentor.token
    if (mentor.status.outcome !== 'ready') console.warn('[nori] Private mentor connection unavailable; ordinary chat remains available.')
  }
  bridge = spawn(process.execPath, [join(ROOT, 'bridge', 'server.mjs')], {
    // app.asar is a virtual archive, not a Windows working directory. Keep
    // the source path inside the archive, but give the child process a real,
    // writable cwd in the user's profile when packaged.
    cwd: app.isPackaged ? USER_DATA_ROOT : ROOT,
    env,
    stdio: ['ignore','ignore','ignore','ipc'],
    windowsHide: true,
  })
  const codingBridge = bridge
  bridge.on('message',async message=>{
    if (message?.kind === 'nori-coding-admission') {
      if (typeof message.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(message.id)) return
      try {
        if (!codingSession || PROBE_SESSION || isQuitting || bridge !== codingBridge || !codingBridge.connected) throw Error('Owned coding session unavailable')
        const fields = Object.keys(message).sort().join(',')
        if (fields !== 'id,kind,ownerTurnId,runId,taskId' && fields !== 'cleanupOnly,id,kind,ownerTurnId,runId,taskId'
            || ('cleanupOnly' in message && message.cleanupOnly !== true)
            || !/^[a-f0-9]{32}$/.test(message.ownerTurnId || '') || !/^[a-f0-9]{32}$/.test(message.runId || '')
            || message.taskId !== message.runId) throw Error('Invalid owned coding admission')
        const result = await codingSession.acceptAdmission({ ownerTurnId: message.ownerTurnId, runId: message.runId, taskId: message.taskId }, { cleanupOnly: message.cleanupOnly === true })
        if (bridge === codingBridge && codingBridge.connected) codingBridge.send({ kind: 'nori-coding-admission-result', id: message.id, result })
      } catch (error) {
        if (bridge === codingBridge && codingBridge.connected) codingBridge.send({ kind: 'nori-coding-admission-result', id: message.id, error: String(error?.message || 'Coding admission refused').slice(0, 400) })
      }
      return
    }
    if (message?.kind === 'nori-browser-call' && typeof message.id === 'string' && /^[a-f0-9-]{36}$/i.test(message.id)) {
      const child = bridge
      try {
        if (!browserHost || PROBE_SESSION || isQuitting) throw Error('Browser control unavailable')
        const result = await browserHost.call(message.operation, message.args)
        if (child?.connected) child.send({ kind: 'nori-browser-result', id: message.id, result })
      } catch (error) { if (child?.connected) child.send({ kind: 'nori-browser-result', id: message.id, error: String(error.message).slice(0, 400) }) }
      return
    }
    if (message?.kind === 'nori-image-runtime-start') {
      if (Object.keys(message).length !== 1 || PROBE_SESSION || REMOTE_CONTROL_ONLY || isQuitting || !app.isPackaged) return
      void imageRuntime.request().catch(error => console.warn('[nori-comfy]', error.message))
      return
    }
    if(message?.kind!=='nori-computer-call'||typeof message.id!=='string'||!/^[a-f0-9-]{36}$/i.test(message.id))return
    const child=bridge
    try{
      if(!computerHost||PROBE_SESSION||isQuitting)throw Error('Desktop control is unavailable.')
      const result=await computerHost.call(message.operation,message.args)
      if(child?.connected)child.send({kind:'nori-computer-result',id:message.id,result})
    }catch(error){if(child?.connected)child.send({kind:'nori-computer-result',id:message.id,error:String(error.message).slice(0,400)})}
  })
  bridge.once('exit', () => codingSession?.invalidate('bridge-exit'))
  bridge.once('disconnect', () => codingSession?.invalidate('bridge-disconnect'))
  bridge.once('exit',()=>computerHost?.stop())
  bridge.once('disconnect',()=>computerHost?.stop())
  bridge.once('exit', () => { void browserHost?.stop().catch(() => {}) })
  bridge.once('disconnect', () => { void browserHost?.stop().catch(() => {}) })
    for (let attempt = 0; attempt < 50; attempt++) {
      if (bridge.startupError) throw bridge.startupError
      if (await bridgeIsUp()) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error('Nori bridge did not become ready.')
}

function configurePermissions() {
  const local = (url) => {
    try { return new URL(url).origin === FACE_ORIGIN } catch { return false }
  }
  const allowedPermissions = PROBE_SESSION || REMOTE_CONTROL_ONLY
    ? ['fullscreen', 'pointerLock']
    : ['media', 'fullscreen', 'pointerLock', 'display-capture']
  installMediaPermissionHandlers({
    session: session.defaultSession,
    local,
    allowedPermissions,
    microphoneHeld: () => foregroundMicrophoneHeld,
  })
  // Naming a real source is load-bearing on Windows: `useSystemPicker` is
  // macOS-only in Electron 44, so without it the page's getDisplayMedia fails
  // with "Invalid capture constraints". See display-media.cjs.
  if (!PROBE_SESSION && !REMOTE_CONTROL_ONLY) installDisplayMediaHandler(session.defaultSession, { desktopCapturer, Menu, getWindow: () => window })
}

function createWindow() {
  window = new BrowserWindow({
    title: 'N.O.R.I. v2',
    width: 1440,
    height: 940,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#020609',
    icon: currentIcon(),
    autoHideMenuBar: true,
    show: false,
    frame: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      // Tray standby must keep the local speech/VAD timers running.
      backgroundThrottling: false,
      preload: join(__dirname, 'workspace-preload.cjs'),
    },
  })
  // Windows may cache the shortcut icon separately from the running window.
  // Set the first Nori-world frame again after the native handle exists, so
  // both the taskbar button and notification-area icon begin from Nori's own
  // globe rather than Electron's fallback.
  // Either event may arrive first (or ready-to-show may never arrive). Bind
  // layout and visibility once; late events cannot re-show a user-hidden app.
  if (!floatOrb && app.isPackaged && !PROBE_SESSION && !REMOTE_CONTROL_ONLY) {
    try {
      floatOrb = require('./orb-window.cjs').createOrbWindow({ BrowserWindow, ipcMain, screen, url: `${FACE_ORIGIN}/orb.html`, origin: FACE_ORIGIN,
        preload: join(__dirname, 'orb-preload.cjs'), stateFile: join(USER_DATA_ROOT, 'settings', 'orb-window.json'), icon: currentIcon(),
        onOpenFull: showNori, log: message => console.warn(`[nori-desktop] ${message}`) })
    } catch (error) { console.warn('[nori-desktop] Floating orb unavailable', error?.message) }
    if (!FLOATING_BAR) floatOrb?.prepare()
  }
  // With the floating bar on, closing or hiding the app window brings the bar back; with it off, nothing appears.
  // As the desktop she stays where she is when the app opens over her; the small floating window still steps aside.
  window.on('show', () => { if (!floatOrb?.isDesktop?.()) floatOrb?.hide() })
  window.on('hide', () => { if (!isQuitting && FLOATING_BAR) floatOrb?.show() })
  bindWindowStartup(window, { probe: Boolean(PROBE_SESSION), currentIcon, arrangeWorkspace, showNori: showFace })
  installContextMenu(window, Menu)
  // Keep the 1920x1080 layout proportions on larger displays, up to 4K: scale
  // the whole page like browser zoom from the window's own size in DIPs. The
  // smaller ratio wins, so a window spanning two 1080p monitors stays at 1x.
  const zoomedWindow = window
  const fitZoom = () => {
    if (zoomedWindow.isDestroyed()) return
    const { width, height } = zoomedWindow.getContentBounds()
    const factor = Math.round(Math.min(2, Math.max(1, Math.min(width / 1920, height / 1080))) * 20) / 20
    if (Math.abs(zoomedWindow.webContents.getZoomFactor() - factor) > 0.001) zoomedWindow.webContents.setZoomFactor(factor)
  }
  window.on('resize', fitZoom)
  window.webContents.on('did-finish-load', fitZoom)
  window.on('resize', publishWorkspace)
  window.on('move', publishWorkspace)
  window.webContents.on('did-finish-load', () => {
    desktopSession.rendererLoaded()
    publishWorkspace()
    if (manageInstallation.consume()) window.webContents.send('nori:models:show')
  })
  window.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) codingSession?.invalidate('renderer-navigation')
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    codingSession?.invalidate('renderer-exited')
    if (!isQuitting) { console.error(`[nori-desktop] Renderer exited: ${details?.reason ?? 'unknown'} code ${details?.exitCode ?? '?'}`); desktopSession.fail('renderer-exited'); app.quit() }
  })
  const probeWindow = window
  if (PROBE_SESSION) probeWindow.webContents.once('did-finish-load', async () => {
    try {
      // Only inspect Nori's own generated UI; no capture or input injection.
      // A rendered galaxy alone is not readiness: require live metadata too.
      const deadline = Date.now() + 20000
      while (!(await inspectProbeRenderer(probeWindow, `(()=>{
        const assistant = document.querySelector('.workspace-model-card');
        const style = document.querySelector('select[aria-label="Response style"]');
        return Boolean(assistant?.textContent.includes('Nori') && style?.options.length > 1);
      })()`))) {
        if (Date.now() > deadline) throw new Error('Nori response settings were not announced to the standby interface.')
        await new Promise(resolveReady => setTimeout(resolveReady, 200))
      }
      const renderer = await inspectProbeRenderer(probeWindow, `(async()=>({
        connection: window.noriConnection,
        settings: [...document.querySelectorAll('.settings select')].map(n=>({label:n.getAttribute('aria-label'),value:n.value,options:[...n.options].map(o=>({value:o.value,label:o.textContent}))})),
        systems: [...document.querySelectorAll('.rail-left .rail-item')].map(n=>n.textContent),
        workspace: await window.noriWorkspace.read(),
        mode: document.documentElement.dataset.workspace,
        toolbars: [...document.querySelectorAll('.workspace-toolbar')].map(n=>({text:n.textContent,x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y})),
        scene: (()=>{const r=document.querySelector('.scene')?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height}:null})()
      }))()`)
      const browserCookieMode = process.argv.find(value => value.startsWith('--browser-cookie='))?.slice('--browser-cookie='.length)
      if (browserCookieMode) {
        if (!['seed', 'check'].includes(browserCookieMode)) throw Error('Invalid synthetic browser continuity mode')
        // Probe-only synthetic cookie on a nonresolving domain: no network,
        // owner cookie reads, real credentials or application tool writes.
        const fixtureUrl = 'http://nori-migration-fixture.invalid/'
        if (browserCookieMode === 'seed') {
          await session.defaultSession.cookies.set({url:fixtureUrl,name:'nori_migration_fixture',
            value:'synthetic-durable-cookie-v1',expirationDate:Math.floor(Date.now()/1000)+86400})
          await session.defaultSession.cookies.flushStore()
        }
        const cookies = await session.defaultSession.cookies.get({url:fixtureUrl,name:'nori_migration_fixture'})
        if (cookies.length !== 1 || cookies[0].value !== 'synthetic-durable-cookie-v1') throw Error('Synthetic browser cookie continuity failed')
        renderer.browserCookie = {mode:browserCookieMode,syntheticCookieVerified:true,networkUsed:false}
        if (process.env.NORI_BROWSER_STATE_FIXTURE_URL) {
          renderer.browserStorage = await browserStorageFixture({BrowserWindow,session:session.defaultSession,
            mode:browserCookieMode,url:process.env.NORI_BROWSER_STATE_FIXTURE_URL})
        }
      }
      if (process.argv.includes('--earth-check')) {
        // Explicit isolated test of Nori's own DOM, not OS input or capture.
        renderer.earth = await probeWindow.webContents.executeJavaScript(`(async()=>{
          const canvas=document.querySelector('.scene canvas');
          if(!canvas)throw Error('Orbit canvas missing');
          const r=canvas.getBoundingClientRect();
          canvas.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2}));
          const wait=ms=>new Promise(done=>setTimeout(done,ms));
          const deadline=Date.now()+25000;
          while(document.querySelector('.cesium-earth')?.dataset.ready!=='true'){
            if(Date.now()>deadline)throw Error('Earth renderer did not become ready');
            await wait(100);
          }
          await wait(3000);
          const globe=document.querySelector('.cesium-earth');
          [...globe.querySelectorAll('button')].find(button=>button.textContent==='Go to coordinates')?.click();
          await wait(100);
          const navigation=globe.querySelector('form[aria-label="Earth coordinate navigation"]');
          if(!navigation)throw Error('Earth coordinate controls missing');
          navigation.querySelector('[name="latitude"]').value='42.3601';
          navigation.querySelector('[name="longitude"]').value='-71.0589';
          navigation.requestSubmit();
          await wait(1700);
          const latitude=Number(globe.dataset.currentLatitude),longitude=Number(globe.dataset.currentLongitude);
          if(Math.abs(latitude-42.3601)>.01||Math.abs(longitude+71.0589)>.01)throw Error('Earth coordinate navigation missed destination');
          const before=Number(globe.dataset.height);
          globe.querySelector('[aria-label="Zoom in"]').click();
          await wait(1000);
          const after=Number(globe.dataset.height);
          const mapCanvas=globe.querySelector('canvas');
          const result={entryLatitude:Number(globe.dataset.latitude),entryLongitude:Number(globe.dataset.longitude),
            destinationLatitude:latitude,destinationLongitude:longitude,
            beforeHeight:before,afterHeight:after,canvasWidth:mapCanvas?.width,canvasHeight:mapCanvas?.height,provider:globe.dataset.provider};
          if(!(after<before)||!result.canvasWidth||!result.canvasHeight)throw Error('Earth zoom or canvas failed');
          for(let step=0;step<10&&Number(globe.dataset.height)>20;step++){
            globe.querySelector('[aria-label="Zoom in"]').click();
            await wait(200);
          }
          await wait(500);
          result.closeHeight=Number(globe.dataset.height);
          if(!(result.closeHeight>0&&result.closeHeight<=20))throw Error('Close Earth zoom failed');
          globe.querySelector('.earth-return').click();
          await wait(1400);
          if(document.querySelector('.cesium-earth'))throw Error('Return to orbit failed');
          return {...result,returnedToOrbit:true,imageryQualityVerified:false};
        })()`)
      }
      if (process.argv.includes('--manage-installation')) {
        const deadline = Date.now() + 10000
        let installation
        const runtimeStatus = RUNTIME_MODE === 'gpt-oss'
          ? nativeModelStatus(nativeService, { runtimeMode: RUNTIME_MODE, gptOssService })
          : nativeService.status
        do {
          installation = await probeWindow.webContents.executeJavaScript(`(()=>{
            const dialog=document.querySelector('.model-manager');
            return dialog?{text:dialog.textContent,buttons:[...dialog.querySelectorAll('button')].map(b=>({text:b.textContent,disabled:b.disabled}))}:null;
          })()`)
          if (installation?.text.includes(runtimeStatus.modelId) &&
            installation.buttons.some(b=>b.text==='20B SUPPORT PENDING'&&b.disabled)) break
          if (Date.now()>deadline) throw new Error('Native installation management did not report loaded model and pending 20B support: '+JSON.stringify(installation))
          await new Promise(done=>setTimeout(done,100))
        } while (true)
        renderer.installation=installation
      }
      let monitorEvidence
      if (process.argv.includes('--monitor-check')) {
        if (!projectMonitor) throw Error('Owned project monitor did not start')
        const response = await fetch(projectMonitor.endpoint + '/project/api/status')
        const status = await response.json()
        if (!response.ok || status.readOnly !== true || status.roadmap?.requirementCount !== 39) throw Error('Owned project monitor status failed')
        monitorEvidence = { endpoint: projectMonitor.endpoint, readOnly: status.readOnly, roadmap: status.roadmap }
      }
      // Explicit source demo must be owner-visible even if Windows/Chromium
      // never delivers ready-to-show for an initially hidden preview.
      // Keep this after live backend readiness and inside the sensor-denied probe.
      if (!app.isPackaged && process.argv.includes('--visible-demo')) showNori()
      const runtimeStatus = RUNTIME_MODE === 'gpt-oss'
        ? {...nativeModelStatus(nativeService, { runtimeMode: RUNTIME_MODE, gptOssService }),
          sensorsEnabled: 0, taskExecutionQualified: false}
        : nativeService.status
      const receipt = { desktop_probe: 'READY', windowBounds: probeWindow.getBounds(), contentBounds: probeWindow.getContentBounds(),
        privateProfile: PROBE_SESSION.directory, browserSession: app.getPath('sessionData'),
        consolidatedStateSelected: Boolean(CONSOLIDATED_STATE), selectedCoreState: CONSOLIDATED_STATE?.core,
        projectMonitor: monitorEvidence,
        renderer, runtime: runtimeStatus, sensorsDenied: true, captureDenied: true, writesEnabled: false }
      writeFileSync(join(PROBE_SESSION.directory, 'desktop-readiness.json'), JSON.stringify(receipt), { flag: 'wx' })
      if (!app.isPackaged && process.argv.includes('--native-exit-probe')) {
        // Source-only, sensor-denied synthetic fault: stop this exact owned
        // runtime after real readiness, WITHOUT requesting a stack/GUI quit.
        // The stack must classify the loss before it drains its sibling Core.
        void nativeService.runtime.stop().catch(() => {
          desktopSession.fail('native-cleanup-failed'); app.quit()
        })
      }
    } catch (error) {
      if (isQuitting || probeWindow.isDestroyed()) return
      desktopSession.fail('probe-readiness-failed')
      reportProbeFailure(PROBE_SESSION,error)
      console.error('[nori-desktop] Workspace acceptance readiness failed'); app.quit()
    }
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== FACE_ORIGIN) event.preventDefault()
  })
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key === 'F11') {
      toggleWorkspace()
      event.preventDefault()
    }
  })
  // Closing the face keeps Nori available from the Windows notification area.
  // Use the tray menu's Quit item to stop her services intentionally.
  window.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    window.hide()
  })
  window.on('closed', () => { window = null })
  void window.loadURL(`${FACE_ORIGIN}${manageInstallation.pending() ? '?manage-installation=1' : ''}`).catch(error => {
    if (!isQuitting) desktopSession.fail('renderer-load-failed')
    reportProbeFailure(PROBE_SESSION, error)
    app.quit()
  })
}

function loadIconFrames() {
  // A detailed static mark stays legible in the tray; legacy globe frames must not override it.
  if (!shouldAnimateIconFrames(ICON)) return
  const directory = join(ROOT, 'public', 'icons', 'nori-spin-minute')
  if (!existsSync(directory)) return
  iconFrames = readdirSync(directory)
    .filter((file) => file.endsWith('.png'))
    .sort()
    .map((file) => nativeImage.createFromPath(join(directory, file)))
    .filter((image) => !image.isEmpty())
}

function currentIcon() {
  return iconFrames[iconFrame] || (existsSync(ICON) ? ICON : undefined)
}

function startIconMotion() {
  if (iconFrames.length < 2 || iconTimer) return
  iconTimer = setInterval(() => {
    iconFrame = (iconFrame + 1) % iconFrames.length
    const image = currentIcon()
    if (window && !window.isDestroyed()) window.setIcon(image)
    if (tray && !tray.isDestroyed()) tray.setImage(image)
  // 120 source frames at 500 ms each = one complete, calm 60-second orbit.
  }, 500)
}

function showFace() {
  if (floatOrb && FLOATING_BAR) floatOrb.show()
  else showNori()
}

function showNori() {
  if (!window) createWindow()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

function requireSkillWindow(event) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) throw Error('Only Nori’s main desktop window can open Skills.')
}
function skillInstallOutcome(result) {
  const verified = result?.outcome === 'installed' && result.installed === true && result.post_install_verified === true
  return { outcome: verified ? 'installed' : result?.outcome === 'cancelled' ? 'cancelled' : 'error', installed: verified, verified }
}
ipcMain.handle('nori:skills:install-bundled-writing', async event => {
  requireSkillWindow(event)
  return skillInstallOutcome(await openNoriSkillInstaller(['--nori-install-skill', join(SUITE_ROOT, 'skills', 'bundled', 'avoid-ai-writing-3.38.0.zip')]))
})
ipcMain.handle('nori:skills:show-installed', async event => {
  requireSkillWindow(event)
  const catalog = await nativeSkillInstaller().showInstalled()
  if (catalog?.verified !== true || !Array.isArray(catalog.skills)) throw Error('The installed skill catalog was not verified.')
  return { shown: true, verified: true, count: catalog.skills.length }
})

let instructionSkillInstaller = null
function nativeSkillInstaller() {
  return instructionSkillInstaller ??= createSkillInstaller({ suiteRoot: SUITE_ROOT,
    dataRoot: USER_DATA_ROOT, dialog, getWindow: () => window })
}
// An action in one of the owner's connected apps (Zapier) that sends or changes something runs only after this
// native prompt, once per action (owner, 2026-11-17). The prompt shows the exact call the bridge recorded.
let connectorApprover = null
async function approveNoriConnectorAction(argv = []) {
  await app.whenReady()
  const at = argv.indexOf('--nori-connector-approve')
  const id = at >= 0 ? String(argv[at + 1] ?? '') : ''
  try {
    const approval = require('./connector-approval.cjs')
    connectorApprover ??= approval.createConnectorApprover({
      settings: join(USER_DATA_ROOT, 'settings'),
      ask: async request => {
        const options = { type: 'warning', title: 'Allow Nori to act in your connected app?',
          message: `Allow Nori to run "${request.tool}" through Zapier?`,
          detail: `Exactly what will be sent:\n${approval.describeRequest(request)}\n\nThis acts in your real accounts and may not be reversible. Allowing covers this one action only; Nori asks again for every action that sends, creates, changes or deletes something.`,
          buttons: ['Cancel', 'Allow once'], defaultId: 0, cancelId: 0, noLink: true }
        const result = window && !window.isDestroyed() ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
        return result.response === 1
      } })
    return await connectorApprover.approve(id)
  } catch {
    // A request that expired or was withdrawn while the prompt was open: nothing to approve, nothing ran.
    return { approved: false, reason: 'error' }
  }
}
// Bundled skill code runs only after this native prompt (owner, 2026-11-16: "Run with approval"). The bridge asks
// for it when the owner requests a script; the prompt lists every script of that skill with its hash.
let skillCodeApprover = null
async function approveNoriSkillCode(argv = []) {
  await app.whenReady()
  const at = argv.indexOf('--nori-skill-code-approve')
  const skill = at >= 0 ? String(argv[at + 1] ?? '') : ''
  try {
    skillCodeApprover ??= require('./skill-code.cjs').createSkillCodeApprover({
      store: join(USER_DATA_ROOT, 'skills'), grantsFile: join(USER_DATA_ROOT, 'settings', 'skill-code-grants.json'),
      ask: async ({ skill: name, root, scripts }) => {
        const lines = Object.entries(scripts).map(([file, hash]) => `${file}   (${hash.slice(0, 12)})`)
        const options = { type: 'warning', title: 'Allow Nori to run this skill\'s scripts?',
          message: `Allow Nori to run the scripts that came with "${name}"?`,
          detail: `Skill folder:\n${root}\n\nScripts (${lines.length}):\n${lines.join('\n')}\n\nNori runs one of these only when you ask for it in your own message. They run with your Windows account access: this is not a sandbox. If any script changes or a new one is added, Nori asks again.`,
          buttons: ['Cancel', 'Allow these scripts'], defaultId: 0, cancelId: 0, noLink: true }
        const result = window && !window.isDestroyed() ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options)
        return result.response === 1
      } })
    return await skillCodeApprover.approve(skill)
  } catch (error) {
    dialog.showErrorBox('Nori could not check that skill', String(error.message).slice(0, 300))
    return { approved: false, reason: 'error' }
  }
}
async function openNoriSkillInstaller(argv = []) {
  await app.whenReady()
  const at = argv.indexOf('--nori-install-skill')
  const selected = at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : undefined
  const direct = argv.includes('--nori-skill-direct') && Boolean(selected)
  try { return await nativeSkillInstaller().install(selected, { direct }) }
  catch (error) {
    dialog.showErrorBox('Nori skill installation failed', String(error.message).slice(0, 500))
    return { outcome: 'error', installed: false }
  }
}
ipcMain.handle('nori:skills:install-local-zip', async event => {
  if (!window || window.isDestroyed() || event.sender !== window.webContents
      || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('Only Nori’s main desktop window can open the skill installer.')
  }
  return skillInstallOutcome(await openNoriSkillInstaller())
})
function createTray() {
  if (tray || !existsSync(ICON)) return
  tray = new Tray(currentIcon())
  tray.setToolTip('N.O.R.I. — Neural Operations & Responsive Intelligence')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: FLOATING_BAR ? 'Open full window' : 'Open Nori', click: showNori },
    ...(FLOATING_BAR ? [{ label: 'Show text box', click: () => window?.hide() }] : []),
    ...(FLOATING_BAR ? [{ label: 'Nori is the desktop', type: 'checkbox', checked: floatOrb?.isDesktop?.() !== false,
      click: item => { item.checked = floatOrb?.setDesktop?.(item.checked) === true } }] : []),
    { label: 'Hide Nori', click: () => window?.hide() },
    { type: 'separator' },
    { label: 'Quit Nori', click: () => { void confirmTrayQuit() } },
  ]))
  // A left-click brings up her everyday face: the app window, or the text bar when the floating bar is on.
  tray.on('click', () => { if (window && !window.isDestroyed() && window.isVisible()) window.focus(); else showFace() })
}

async function boot() {
  if (!PROBE_SESSION && !REMOTE_CONTROL_ONLY && process.platform === 'win32' && RUNTIME_MODE === 'norllama') {
    foregroundMicrophoneLease = await acquireForegroundMicrophoneLease(SUITE_ROOT, {
      onLost: () => {
        foregroundMicrophoneHeld = false
        desktopSession.fail('microphone-owner-lost')
        app.quit() // Existing streams must not continue after ownership loss.
      },
    })
    foregroundMicrophoneHeld = true
    if (isQuitting) return
  }
  if (CONSOLIDATED_STATE) {
    // Revalidate prepared state rather than recreating a disappeared directory
    // after the pre-ready selector accepted its permissions.
    desktopStateSelection({suiteRoot:SUITE_ROOT,appRoot:ROOT,packaged:app.isPackaged,
      executable:process.execPath,probeLayoutRoot:PROBE_SESSION?.layoutRoot,stateLayout:'consolidated-v1'})
    desktopStateOwner.assertHeld(); browserStateOwner.assertHeld()
  } else {
    mkdirSync(USER_DATA_ROOT, { recursive: true })
    const recovered = recoverDeadOwnerRecord(USER_DATA_ROOT)
    if (recovered.recovered) console.error(`[nori-desktop] Moved aside a stale owner record from dead process ${recovered.pid}`)
    desktopStateOwner = acquireStateOwner(USER_DATA_ROOT, { purpose: 'desktop' })
  }
  configurePermissions()
  if (!PROBE_SESSION && !REMOTE_CONTROL_ONLY && ['gpt-oss', 'norllama'].includes(RUNTIME_MODE)) {
    const savedWorker = require('./worker-workspace.cjs').createWorkerWorkspace({ dataRoot: USER_DATA_ROOT,
      owns: () => false, choose: async () => null }).startup()
    Object.assign(process.env, savedWorker)
  }
  configureWorkspace()
  configureModelManager()
  // Installed N.O.R.I. keeps mutable runtime data outside app.asar and uses
  // private ports so this transferable suite does not borrow a dev checkout.
  if (app.isPackaged) {
    if (!CONSOLIDATED_STATE) mkdirSync(USER_DATA_ROOT, { recursive: true })
    process.env.NORI_ROOT = SUITE_ROOT
    process.env.NORI_DATA_ROOT = join(USER_DATA_ROOT, 'nori-data')
    process.env.NORI_API_TOKEN_FILE = join(USER_DATA_ROOT, 'secrets', 'council-token')
    process.env.NORI_OLLAMA_URL = OLLAMA_URL
    process.env.NORI_COUNCIL_URL = COUNCIL_URL
    process.env.NORI_COMFY_URL = `http://127.0.0.1:${COMFY_PORT}`
    process.env.NORI_COMFY_RUNTIME_MANAGED = '1'
    process.env.NORI_BRIDGE_PORT = String(BRIDGE_PORT)
    // A portable package carrying a verified model catalog must choose from
    // that catalog when launched directly from Explorer. An explicit 0 remains
    // an operator escape hatch; invalid values fail in native-service.
    if (!NATIVE_QWEN && process.env.NORI_MINI_AUTO_MODEL === undefined &&
        existsSync(join(SUITE_ROOT, 'runtime', 'norllama', 'mini-model-catalog.json'))) {
      process.env.NORI_MINI_AUTO_MODEL = '1'
    }
    if (RUNTIME_MODE === 'ollama-rollback') {
      prepareSuiteRuntime()
      await startOllama()
      if (isQuitting) return
      await startCouncil()
      if (isQuitting) return
    }
  }
  if (REMOTE_CONTROL_ONLY) {
    nativeService = await startNativeService({ root: SUITE_ROOT, signal: desktopStartupOwner.signal })
    if (isQuitting) return
    nativeExitObservation = nativeService.exited.then(result => {
      if (result.unexpected || !isQuitting) {
        desktopSession.fail('native-runtime-exited')
        console.error('[nori-desktop] Own NorLlama runtime stopped;no fallback used'); app.quit()
      }
    }, () => { desktopSession.fail('native-runtime-exit-observation-failed'); app.quit() })
    if (isQuitting) return
    Object.assign(process.env, nativeService.environment)
    process.env.NORI_ALLOW_WRITES = '0'
    process.env.NORI_NATIVE_CORE_READY = '0'
    console.warn('[nori-desktop] Remote shell; NorLlama chat enabled; microphone, Core tools, and writes are disabled')
  } else if (RUNTIME_MODE === 'norllama') {
    if (NATIVE_QWEN) process.env.NORI_MINI_AUTO_MODEL = '0'
    nativeService = await startNativeDesktop({ root: SUITE_ROOT, signal: desktopStartupOwner.signal,
      ...(NATIVE_QWEN ? { configName: 'runtime/norllama/qwen35.json' } : {}),
      stateRoot: CONSOLIDATED_STATE?.root || USER_DATA_ROOT,
      ...(CONSOLIDATED_STATE ? { dataRoot: CONSOLIDATED_STATE.core, requirePreparedState: true } : PROBE_SESSION ? { dataRoot: join(USER_DATA_ROOT, 'core') } : {}) }, { allowUnavailable: !PROBE_SESSION })
    if (!nativeService) {
      clearUnavailableRuntimeCredentials(process.env)
      process.env.NORI_RUNTIME_MODEL_STATE = 'unavailable'
      console.warn('[nori-desktop] SoN activation pending; desktop open with inference and writes disabled')
    } else {
    // Attach even if quit arrived during startup: a previously observed loss
    // must remain failed after its asynchronous sibling cleanup completes.
    nativeExitObservation = nativeService.exited.then(result => {
      if (result.cleanupFailed) desktopSession.fail('native-cleanup-failed')
      if (result.unexpected || !isQuitting) {
        desktopSession.fail('native-service-exited')
        console.error('[nori-desktop] Own native Core/runtime stopped;no fallback used'); app.quit()
      }
    }, () => { desktopSession.fail('native-exit-observation-failed'); app.quit() })
    if (isQuitting) return
    Object.assign(process.env, nativeService.environment)
    process.env.NORI_RUNTIME_MAX_PROMPT_TOKENS = String(nativeService.status.maxPromptTokens)
    }
  } else if (RUNTIME_MODE === 'gpt-oss') {
    gptOssService = await startVideoCapableModelService({ root: GPT_OSS_ROOT, signal: desktopStartupOwner.signal,
      modelProfile: IMPORTED_MODEL_PROFILE.id,
      hereticAdapter: process.env.NORI_GPT_OSS_HERETIC === '1',
      // Use the largest supported local profile by default (78K); 64K remains
      // available for systems that need a smaller window. The KV cache stays
      // in system RAM to preserve GPU headroom.
      // NorLlama's separate default context and runtime are unchanged.
      contextTokens: resolveGptOssContextTokens(process.env.NORI_GPT_OSS_CONTEXT_TOKENS || String(IMPORTED_MODEL_PROFILE.defaultContext)),
      localAgentProvider: CODEX_LOCAL_PROVIDER },{
        // Keep one logical endpoint across model choices and video handoffs.
        // Explicit command-line profiles remain available for diagnostics.
        ...(!process.argv.some(arg=>['--nori-gpt-oss','--nori-gpt-oss-heretic','--nori-qwen38','--nori-qwen35-9b'].includes(arg))&&!CODEX_LOCAL_PROVIDER?{
          startService:async()=>{
            // Stream mode: recheck capacity when idle; keep the 35B if it fits, otherwise the 9B at minimum 64K.
            if(!streamMode&&app.isPackaged&&!PROBE_SESSION&&!REMOTE_CONTROL_ONLY){
              streamMode=require('./stream-mode.cjs').createStreamModeDetector({dataRoot:USER_DATA_ROOT,
                onChange:active=>{
                  console.log(`[nori-desktop] Stream mode ${active?'on: OBS is running, rechecking capacity for 35B or 9B at minimum 64K':'off: back to the everyday 35B when it fits'}`)
                  void automaticTextService?.refreshRoute?.().catch(()=>{})
                }})
              await streamMode.tick().catch(()=>{})
            }
            automaticTextService=await startAutomaticTextService({signal:desktopStartupOwner.signal,
              canLoad:createModelCapacityCheck(),
              onTiming:require('./model-timing-log.cjs').createModelTimingLog(USER_DATA_ROOT),
              // R84: model loads, failures, exits and watchdog resets, to learning/model-events.jsonl.
              onEvent:require('./model-timing-log.cjs').createModelEventLog(USER_DATA_ROOT),
              streamMode,
              // The helper on the second card answers a request the main model could not (R81).
              helper:require('./helper-fallback.cjs').helperRequest,
              startModel:({profile,contextTokens,signal})=>startGptOssService({root:GPT_OSS_ROOT,
                modelProfile:profile,contextTokens,signal})})
            streamMode?.start()
            return automaticTextService
          },
        }:{}),
        cleanupVideo:()=>releaseVideoRuntime(`http://127.0.0.1:${COMFY_PORT}`,{
          // The text model may come back at its smallest qualified context after media work.
          requiredFreeVramBytes:Math.min(IMPORTED_MODEL_PROFILE.minimumFreeVramMiB||12288,
            ...(IMPORTED_MODEL_PROFILE.fallbackContexts??[]).map(item=>item.minimumFreeVramMiB))*1024**2,
          isOwnedRuntimeStopped:()=>Boolean(lastOwnedComfyChild&&
            (lastOwnedComfyChild.exitCode!==null||lastOwnedComfyChild.signalCode!=null)),
        }),
      })
    if (isQuitting) return
    gptOssExitObservation = gptOssService.exited.then(result => {
      if (result.unexpected || !isQuitting) {
        desktopSession.fail('gpt-oss-service-exited')
        console.error('[nori-desktop] Owned GPT-OSS service stopped; no fallback used'); app.quit()
      }
    }, () => { desktopSession.fail('gpt-oss-service-exit-observation-failed'); app.quit() })
    if (isQuitting) return
    Object.assign(process.env, gptOssService.environment, {
      NORI_GPT_OSS_ENABLED: '1',
      NORI_GPT_OSS_URL: gptOssService.endpoint,
      NORI_GPT_OSS_SERVER_MODEL: gptOssService.modelId,
      NORI_GPT_OSS_CONTEXT_TOKENS: String(gptOssService.contextTokens),
      NORI_RUNTIME_MODEL_ID: gptOssService.modelId,
      NORI_CODEX_LOCAL_PROVIDER_URL: gptOssService.localAgentProvider?.endpoint || '',
      NORI_NATIVE_CORE_READY: '0',
      NORI_NATIVE_TOOLS_QUALIFIED: '0',
      NORI_ALLOW_WRITES: '0',
    })
    const importedRuntime = {
      environment: { NORI_INFERENCE_RUNTIME: 'gpt-oss', NORI_GPT_OSS_URL: gptOssService.endpoint,
        NORI_GPT_OSS_SERVER_MODEL: gptOssService.modelId, NORI_RUNTIME_MODEL_ID: gptOssService.modelId },
      status: { modelId: gptOssService.modelId },
    }
    Object.assign(process.env, workerEnvironment(process.env, importedRuntime))
    gptOssCore = await startNativeCore({ root: SUITE_ROOT, runtime: importedRuntime,
      environment: process.env, signal: desktopStartupOwner.signal,
      stateRoot: CONSOLIDATED_STATE?.root || USER_DATA_ROOT,
      onStartupDiagnostic: ({ code, signal: exitSignal, stderr }) => {
        console.error('[nori-desktop] Owned GPT-OSS Core startup diagnostics', {
          code, signal: exitSignal, stderr,
        })
      },
      ...(CONSOLIDATED_STATE ? { dataRoot: CONSOLIDATED_STATE.core, requirePreparedState: true }
        : PROBE_SESSION ? { dataRoot: join(USER_DATA_ROOT, 'core') } : {}) })
    if (isQuitting) return
    gptOssCoreExitObservation = gptOssCore.exited.then(result => {
      if (result.unexpected || !isQuitting) {
        desktopSession.fail('gpt-oss-core-exited')
        console.error('[nori-desktop] Owned imported GPT-OSS Core stopped; no fallback used'); app.quit()
      }
    }, () => { desktopSession.fail('gpt-oss-core-exit-observation-failed'); app.quit() })
    if (isQuitting) return
    Object.assign(process.env, gptOssCore.environment, { NORI_ALLOW_WRITES: '0' })
    console.warn('[nori-desktop] GPT-OSS chat and owned twelve-Knight Core are running locally; SoN identity, tools and durable work remain unqualified')
  }
  await startFace()
  if (isQuitting) return
  if (!REMOTE_CONTROL_ONLY && !app.isPackaged && !PROBE_SESSION) {
    await startLegacyBus()
    if (isQuitting) return
    await startHandInput()
    if (isQuitting) return
    await startComfy()
    if (isQuitting) return
  } else if (!REMOTE_CONTROL_ONLY && !PROBE_SESSION) {
    await startLegacyBus()
    if (isQuitting) return
    await startHandInput()
    if (isQuitting) return
  }
  if (!PROBE_SESSION && !REMOTE_CONTROL_ONLY) {
    try {
      const {startLocalEmbeddingService} = require('./local-embedding-service.cjs')
      embeddingService = await startLocalEmbeddingService({root:SUITE_ROOT,signal:desktopStartupOwner.signal})
      Object.assign(process.env,embeddingService.environment)
    } catch (error) {
      delete process.env.NORI_EMBEDDING_URL
      delete process.env.NORI_EMBEDDING_API_KEY
      if (!isQuitting) console.warn('[nori-desktop] Local semantic-memory model unavailable:',error.message)
    }
    if (isQuitting) return
  }
  await startBridge()
  if (isQuitting) return
  if ((!PROBE_SESSION || process.argv.includes('--monitor-check')) && !isQuitting) {
    try {
      projectMonitor = await startProjectMonitor({ root: SUITE_ROOT, port: PROBE_SESSION ? 0 : 8790, signal: projectMonitorOwner.signal })
      console.log('[nori-desktop] Owned read-only project monitor ready')
    } catch (error) {
      // An existing monitor belongs to its current owner, never this instance.
      console.error('[nori-desktop] Project monitor unavailable:', error.code || error.message)
    }
  }
  if (isQuitting) return
  loadIconFrames()
  createTray()
  if (process.argv.includes('--nori-install-skill')) void openNoriSkillInstaller(process.argv)
  createWindow()
  if (!PROBE_SESSION) {
    remoteControl = require('./private-phone-channel.cjs').createPrivatePhoneChannel({
      getContext: () => require('./tailscale-remote-context.cjs').tailscaleRemoteContextAsync(),
      create: async ({ ownerLogin, origin }) => {
        const { createWorkActivityClient } = await import('../bridge/work-activity.mjs')
        const workActivity = createWorkActivityClient({ environment: { ...process.env,
          NORI_API_TOKEN_FILE: join(USER_DATA_ROOT, 'secrets', 'council-token'),
          NORI_COUNCIL_URL: REMOTE_CONTROL_ONLY ? COUNCIL_URL : nativeCoreEndpoint(gptOssCore || nativeService, COUNCIL_URL) } })
        const activity = REMOTE_CONTROL_ONLY ? workActivity
          : require('./system-activity.cjs').createMobileTaskActivity({ workActivity,
            getCore: () => gptOssCore || nativeService?.core })
        const { createLocalVoiceClient } = await import('../bridge/remote-voice.mjs')
        const { createVoiceSession } = await import('../bridge/voice-session.mjs')
        const voice = createVoiceSession({ voice: createLocalVoiceClient({ baseUrl: `http://127.0.0.1:${BRIDGE_PORT}/` }) })
        return createRemoteControlServer({ window, ownerLogin, origin, activity, voice })
      },
      onReady: origin => {
        remoteControlOrigin = origin
        console.log('[nori-desktop] Private Tailscale control channel ready')
      },
      onUnavailable: () => { remoteControlOrigin = null },
      onDiagnostic: ({ phase, code }) => console.warn('[nori-desktop] Private phone channel unavailable', phase, code),
    })
  }
  startIconMotion()
  desktopSession.bootCompleted()
  // The image/video runtime starts on the first request (bridge IPC) and stops after 10 idle
  // minutes, instead of holding RAM and GPU memory from boot.
  if (app.isPackaged && !PROBE_SESSION) {
    const idleCheck = setInterval(() => { void imageRuntime.tick().then(result => {
      if (result === 'stopped') console.warn('[nori-comfy] Image runtime stopped after being idle; it starts again on the next image request')
    }).catch(error => console.warn('[nori-comfy]', error.message)) }, 60_000)
    idleCheck.unref?.()
  }
}

if (PROBE_SESSION) {
  // Windows GUI Electron can report stdin EOF even while its launcher is live.
  // A private loopback owner heartbeat also closes the app on launcher death.
  let checkingOwner = false
  const ownerTimer = setInterval(async () => {
    if (checkingOwner || isQuitting) return
    checkingOwner = true
    try {
      const response = await fetch(PROBE_SESSION.ownerUrl, {headers:{authorization:`Bearer ${PROBE_SESSION.ownerKey}`},signal:AbortSignal.timeout(1000),redirect:'error'})
      if (!response.ok) app.quit()
    } catch { app.quit() }
    finally { checkingOwner = false }
  }, 800)
  app.once('will-quit', () => clearInterval(ownerTimer))
}

app.whenReady().then(() => {
  journalLifecycle('app-ready')
  if (ownsDesktopInstance && !isQuitting) {
    desktopBootPending = boot()
    return desktopBootPending
  }
}).catch((error) => {
  if (error.code === 'NORI_OWNED_CLEANUP_FAILED') {
    desktopStartupCleanupFailed = true; desktopSession.fail('startup-cleanup-failed')
  } else if (!isQuitting) desktopSession.fail('startup-failed')
  console.error('[nori-desktop]', error)
  reportProbeFailure(PROBE_SESSION,error)
  app.quit()
})
app.on('activate', () => { if (ownsDesktopInstance && !isQuitting) showNori() })
const shutdownDesktop = onceDesktopShutdown(async () => {
  // Startup can still be awaiting a service when quit arrives. Wait until it
  // stops assigning owned children before taking the drain snapshot.
  let startupTimer
  try {
    await Promise.race([
      desktopBootPending?.catch(error => {
        if (error.code === 'NORI_OWNED_CLEANUP_FAILED') desktopStartupCleanupFailed = true
      }),
      new Promise((_, reject) => { startupTimer = setTimeout(() => reject(Error('Desktop startup did not stop')), 30000) }),
    ])
  } finally { clearTimeout(startupTimer) }
  // Destroy capture-capable renderers before releasing the foreground gate.
  if (foregroundMicrophoneLease) {
    foregroundMicrophoneHeld = false
    for (const ownedWindow of BrowserWindow.getAllWindows()) ownedWindow.destroy()
  }
  const stopImportedStack = async () => {
    const failures = []
    try { await gptOssCore?.stop() } catch (error) { failures.push(error) }
    try { await gptOssService?.stop() } catch (error) { failures.push(error) }
    if (failures.length) throw new AggregateError(failures, 'Imported GPT-OSS stack shutdown failed')
  }
  const results = await Promise.allSettled([nativeService?.stop(), stopImportedStack(), projectMonitor?.stop(), remoteControl?.stop(), embeddingService?.stop(),
    drainDesktopWriters([bridge, council, ollama, legacyBus, comfy, handInput]),
    foregroundMicrophoneLease?.stop()])
  // A completed physical stop is not the session verdict. Join its original
  // exit observer before snapshotting health, but never await a failed drain.
  if (nativeExitObservation && results[0].status === 'fulfilled') await nativeExitObservation
  if (gptOssExitObservation && results[1].status === 'fulfilled') await gptOssExitObservation
  if (gptOssCoreExitObservation && results[1].status === 'fulfilled') await gptOssCoreExitObservation
  desktopCleanupVerified = !desktopStartupCleanupFailed && results.every(result => result.status === 'fulfilled')
  desktopSession.cleanupCompleted(desktopCleanupVerified)
  if (!desktopCleanupVerified) console.error('[nori-desktop] Owned shutdown failed')
  nativeCleanupDone = true
  app.quit()
})
app.on('before-quit', (event) => {
  codingSession?.invalidate('desktop-quit')
  computerHost?.stop()
  void browserHost?.stop().catch(() => {})
  desktopSession.beginQuit()
  isQuitting = true
  desktopStartupOwner.abort()
  projectMonitorOwner.abort()
  if (iconTimer) clearInterval(iconTimer)
  if (bridge && !bridge.killed) bridge.kill()
  if (council && !council.killed) council.kill()
  if (ollama && !ollama.killed) ollama.kill()
  if (legacyBus && !legacyBus.killed) legacyBus.kill()
  if (comfy && !comfy.killed) comfy.kill()
  if (handInput && !handInput.killed) handInput.kill()
  if (face) face.close()
  if ((nativeService || gptOssService || gptOssCore || projectMonitor || remoteControl || desktopStateOwner || foregroundMicrophoneLease) && !nativeCleanupDone) {
    event.preventDefault()
    void shutdownDesktop().catch(() => {
      // Synchronous stop failures also preserve the ownership record.
      desktopCleanupVerified = false
      desktopSession.cleanupCompleted(false)
      nativeCleanupDone = true
      console.error('[nori-desktop] Owned shutdown failed')
      app.quit()
    })
  }
})
app.on('will-quit', (event) => {
  if (desktopCleanupVerified) {
    let ownershipReleased = true
    for (const owner of [browserStateOwner,desktopStateOwner]) {
      try { owner?.release() }
      catch { ownershipReleased = false; console.error('[nori-desktop] Profile ownership changed; record preserved') }
    }
    desktopSession.ownershipCompleted(ownershipReleased)
  }
  const outcome = desktopSession.snapshot()
  journalLifecycle('session-ended', {outcome:outcome.outcome})
  if (PROBE_SESSION) {
    // Bounded synthetic diagnostics through this ORIGINAL GUI's pipe only.
    // No profile write, credential, authenticated guardian proof or disk adoption.
    try { writeSync(process.stdout.fd, JSON.stringify({ desktop_session_outcome: outcome, rootPid: process.pid }) + '\n') } catch {}
  }
  if (ownsDesktopInstance && outcome.recommendedExitCode !== 0) {
    // All ordinary cleanup/release work above has run. Exit failure rather
    // than allowing Electron's default app.quit() code0 to hide session faults.
    event.preventDefault()
    app.exit(outcome.recommendedExitCode)
  }
})
