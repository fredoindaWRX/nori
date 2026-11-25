const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('noriProactive', {
  create: proposal => ipcRenderer.invoke('nori:proactive:create', proposal),
  read: () => ipcRenderer.invoke('nori:proactive:activity', 'list'),
  disableRoutine: id => ipcRenderer.invoke('nori:proactive:activity', 'disableRoutine', id),
  disableMonitor: id => ipcRenderer.invoke('nori:proactive:activity', 'disableMonitor', id),
})
contextBridge.exposeInMainWorld('noriBrowser', {
  start: target => ipcRenderer.invoke('nori:browser:start', target),
  status: () => ipcRenderer.invoke('nori:browser:status'),
  stop: () => ipcRenderer.invoke('nori:browser:stop'),
})
contextBridge.exposeInMainWorld('noriSystem', {
  confirm: taskId => ipcRenderer.invoke('nori:system:confirm', taskId),
  read: () => ipcRenderer.invoke('nori:system:activity', 'list'),
  cancel: taskId => ipcRenderer.invoke('nori:system:activity', 'cancel', taskId),
  output: taskId => ipcRenderer.invoke('nori:system:activity', 'output', taskId),
})
contextBridge.exposeInMainWorld('noriSkills', {
  openInstaller: () => ipcRenderer.invoke('nori:skills:install-local-zip'),
  openBundled: () => ipcRenderer.invoke('nori:skills:install-bundled-writing'),
  showInstalled: () => ipcRenderer.invoke('nori:skills:show-installed'),
})
contextBridge.exposeInMainWorld('noriCodingSession', {
  grant: () => ipcRenderer.invoke('nori:coding:session:grant'),
  revoke: options => ipcRenderer.invoke('nori:coding:session:revoke', options?.forget === true ? { forget: true } : undefined),
  status: () => ipcRenderer.invoke('nori:coding:session:status'),
  registerTurn: args => ipcRenderer.invoke('nori:coding:turn:register', args),
  runStatus: binding => ipcRenderer.invoke('nori:coding:run:status', binding),
  stop: binding => ipcRenderer.invoke('nori:coding:run:stop', binding),
  subscribe: callback => {
    const receive = (_event, progress) => callback(progress)
    ipcRenderer.on('nori:coding:progress', receive)
    return () => ipcRenderer.removeListener('nori:coding:progress', receive)
  },
})
contextBridge.exposeInMainWorld('noriWorkerWorkspace', {
  confirm: taskId => ipcRenderer.invoke('nori:worker:confirm', taskId),
  read: () => ipcRenderer.invoke('nori:worker:workspace:read'),
  select: () => ipcRenderer.invoke('nori:worker:workspace:select'),
})
contextBridge.exposeInMainWorld('noriComputer',{
  list:()=>ipcRenderer.invoke('nori:computer:list'),
  start:target=>ipcRenderer.invoke('nori:computer:start',target),
  status:()=>ipcRenderer.invoke('nori:computer:status'),
  stop:()=>ipcRenderer.invoke('nori:computer:stop'),
})
contextBridge.exposeInMainWorld('noriRemoteAccess', {
  read: () => ipcRenderer.invoke('nori:remote-access:read'),
})
const connection = ipcRenderer.sendSync('nori:connection:read')
if (connection) contextBridge.exposeInMainWorld('noriConnection', connection)
contextBridge.exposeInMainWorld('noriWake', {
  reveal: () => ipcRenderer.invoke('nori:wake:reveal'),
  consume: () => ipcRenderer.invoke('nori:wake:consume'),
})
contextBridge.exposeInMainWorld('noriArtifacts', {
  reveal: (appId, path) => ipcRenderer.invoke('nori:artifact:reveal', { appId, path }),
})
contextBridge.exposeInMainWorld('noriWorkspace', {
  read: () => ipcRenderer.invoke('nori:workspace:read'),
  projectList: (args) => ipcRenderer.invoke('nori:workspace:project:list', args),
  projectRead: (args) => ipcRenderer.invoke('nori:workspace:project:read', args),
  appDraftList: () => ipcRenderer.invoke('nori:workspace:app-drafts:list'),
  appDraftRead: (args) => ipcRenderer.invoke('nori:workspace:app-drafts:read', args),
  appDraftActivate: (args) => ipcRenderer.invoke('nori:workspace:app-drafts:activate', args),
  appRead: (args) => ipcRenderer.invoke('nori:workspace:apps:read', args),
  appRecords: (args) => ipcRenderer.invoke('nori:workspace:apps:records', args),
  appRecordCreate: (args) => ipcRenderer.invoke('nori:workspace:apps:record:create', args),
  appRecordUpdate: (args) => ipcRenderer.invoke('nori:workspace:apps:record:update', args),
  appRecordDelete: (args) => ipcRenderer.invoke('nori:workspace:apps:record:delete', args),
  captureDisplays: () => ipcRenderer.invoke('nori:screen:capture-displays'),
  handInput: (input) => ipcRenderer.invoke('nori:hand:input', input),
  command: (command) => ipcRenderer.invoke('nori:workspace:command', command),
  subscribe: (callback) => {
    const receive = (_event, value) => callback(value)
    ipcRenderer.on('nori:workspace:changed', receive)
    return () => ipcRenderer.removeListener('nori:workspace:changed', receive)
  },
})
contextBridge.exposeInMainWorld('noriInstall', {
  identity: () => ipcRenderer.invoke('nori:app:identity'),
  status: () => ipcRenderer.invoke('nori:models:status'),
  installDeep: () => ipcRenderer.invoke('nori:models:install-deep'),
  removeDeep: () => ipcRenderer.invoke('nori:models:remove-deep'),
  open: () => ipcRenderer.send('nori:models:open'),
  subscribeOpen: (callback) => {
    const receive = () => callback()
    ipcRenderer.on('nori:models:show', receive)
    return () => ipcRenderer.removeListener('nori:models:show', receive)
  },
  subscribeProgress: (callback) => {
    const receive = (_event, progress) => callback(progress)
    ipcRenderer.on('nori:models:progress', receive)
    return () => ipcRenderer.removeListener('nori:models:progress', receive)
  },
})

// The composer ZIP control uses only Nori's native, reviewed skill installer.
// Keep this inline: the BrowserWindow uses a sandboxed preload that cannot load
// arbitrary local modules through Node's restricted require().
const skillZipButtonId = 'nori-skill-zip-upload'
const mountSkillZipButton = () => {
  if (document.getElementById(skillZipButtonId)) return
  const attach = document.querySelector('.textbar-attach')
  if (!attach || typeof attach.insertAdjacentElement !== 'function') return
  const button = document.createElement('button')
  button.id = skillZipButtonId
  button.type = 'button'
  button.className = 'textbar-attach nori-skill-zip-upload'
  button.textContent = 'SKILL ZIP'
  button.title = 'Install an instruction skill from a local ZIP package'
  button.setAttribute('aria-label', 'Install an instruction skill from a local ZIP package')
  button.style.width = '62px'
  button.style.minWidth = '62px'
  button.style.padding = '0 4px'
  button.style.display = 'inline-flex'
  button.style.alignItems = 'center'
  button.style.justifyContent = 'center'
  button.style.visibility = 'visible'
  button.style.opacity = '1'
  button.style.pointerEvents = 'auto'
  button.style.whiteSpace = 'nowrap'
  button.style.position = 'relative'
  button.style.zIndex = '6'
  button.style.fontSize = '10px'
  button.style.letterSpacing = '.06em'
  button.addEventListener('click', async () => {
    if (button.disabled) return
    button.disabled = true
    button.setAttribute('aria-busy', 'true')
    button.title = 'Choose and review a local ZIP package…'
    try {
      await ipcRenderer.invoke('nori:skills:install-local-zip')
    } catch {
      button.title = 'Nori could not open the skill review. Try Settings → Skills.'
    } finally {
      button.disabled = false
      button.removeAttribute('aria-busy')
      if (!button.title.startsWith('Nori could not')) {
        button.title = 'Install an instruction skill from a local ZIP package'
      }
    }
  })
  attach.insertAdjacentElement('afterend', button)
}
const skillZipButtonObserver = typeof MutationObserver === 'function'
  ? new MutationObserver(mountSkillZipButton)
  : null
let skillZipObservedRoot = null
const startSkillZipButton = () => {
  const root = document.documentElement
  if (root && root !== skillZipObservedRoot && skillZipButtonObserver) {
    skillZipButtonObserver.observe(root, { childList: true, subtree: true })
    skillZipObservedRoot = root
  }
  mountSkillZipButton()
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startSkillZipButton, { once: true })
  else startSkillZipButton()
}
