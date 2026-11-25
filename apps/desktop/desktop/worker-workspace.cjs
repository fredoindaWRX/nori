const fs = require('node:fs')
const path = require('node:path')

function validateWorkspace(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error('Select an absolute project folder')
  const normalized = path.resolve(value)
  if (path.parse(normalized).root === normalized) throw new Error('Select a project, not an entire drive')
  const physical = fs.realpathSync(normalized)
  if (physical.toLowerCase() !== normalized.toLowerCase() || !fs.statSync(physical).isDirectory()) {
    throw new Error('Select a real project folder, not a linked folder')
  }
  if (!fs.existsSync(path.join(physical, '.git'))) throw new Error('Background coding requires a Git project')
  return physical
}

function createWorkerWorkspace({ dataRoot, owns, choose, activate, activeWorkspace: initialWorkspace = null }) {
  if (typeof dataRoot !== 'string' || !path.isAbsolute(dataRoot)) throw new Error('Worker settings require an absolute Nori state root')
  const file = path.join(dataRoot, 'settings', 'worker-workspace.json')
  let activeWorkspace = initialWorkspace
  let selecting = false
  let persistenceWarning = null
  // Set while Nori has switched herself to her own self-development project for a "your code" request (owner,
  // 2026-11-16). The owner's saved choice in the settings file is not changed by that, so she can switch back.
  let autoWorkspace = null
  function checkStorage() {
    for (let current = path.resolve(file); ; current = path.dirname(current)) {
      let stat
      try { stat = fs.lstatSync(current) } catch (error) { if (error.code !== 'ENOENT') throw error }
      if (stat && (stat.isSymbolicLink() || fs.realpathSync(current).toLowerCase() !== current.toLowerCase()
          || (current === path.resolve(file) ? !stat.isFile() || stat.nlink !== 1 || stat.size > 16384 : !stat.isDirectory()))) {
        throw new Error('Linked, invalid, or oversized worker settings refused')
      }
      if (path.dirname(current) === current) break
    }
  }
  function read() {
    if (autoWorkspace && autoWorkspace === activeWorkspace) return { workspace: autoWorkspace, restartRequired: false, approvalGranted: false, automatic: true }
    if (persistenceWarning && activeWorkspace) return { workspace: activeWorkspace,
      restartRequired: false, approvalGranted: false, warning: persistenceWarning }
    try {
      checkStorage()
      const record = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (record.schema !== 'nori.worker-workspace.v1') throw new Error('Unsupported workspace setting')
      const workspace = validateWorkspace(record.workspace)
      return { workspace, restartRequired: workspace !== activeWorkspace, approvalGranted: false }
    } catch (error) {
      if (error.code === 'ENOENT') return { workspace: null, approvalGranted: false }
      return { workspace: null, approvalGranted: false, error: error.message }
    }
  }
  return {
    read: event => owns(event) ? read() : null,
    startup: () => {
      const saved = read()
      activeWorkspace = saved.workspace
      return saved.workspace ? { NORI_AIDER_BACKGROUND: '1', NORI_AIDER_WORKSPACE_ROOT: saved.workspace } : {}
    },
    // Main-process only (never exposed with a path over IPC): make a known project the active one for this session
    // without the folder picker and without changing the owner's saved choice. Used for Nori's own self-development
    // workspace and for going back to the owner's project afterwards.
    async switchTo(selected, { automatic = true } = {}) {
      if (selecting) throw new Error('A project selection is already in progress')
      selecting = true
      try {
        const workspace = validateWorkspace(selected)
        if (String(activeWorkspace ?? '').toLowerCase() === workspace.toLowerCase()) { autoWorkspace = automatic ? workspace : null; return { workspace, changed: false } }
        if (!activate) throw new Error('Project switching is not connected')
        const receipt = await activate(workspace)
        if (receipt?.workspace?.toLowerCase() !== workspace.toLowerCase() || receipt.restartRequired !== false) throw new Error('Core did not confirm the project switch')
        activeWorkspace = workspace
        autoWorkspace = automatic ? workspace : null
        return { workspace, changed: true }
      } finally { selecting = false }
    },
    /** The owner's own saved project (from the settings file), or null. */
    savedWorkspace: () => { try { checkStorage(); const record = JSON.parse(fs.readFileSync(file, 'utf8')); return record.schema === 'nori.worker-workspace.v1' ? validateWorkspace(record.workspace) : null } catch { return null } },
    automaticWorkspace: () => (autoWorkspace && autoWorkspace === activeWorkspace ? autoWorkspace : null),
    async select(event) {
      if (!owns(event)) throw new Error('Workspace selection must come from Nori')
      if (selecting) throw new Error('A project selection is already in progress')
      selecting = true
      try {
      const selected = await choose()
      if (!selected) return read()
      autoWorkspace = null
      if (!owns(event)) throw new Error('Nori window changed during selection')
      const workspace = validateWorkspace(selected)
      checkStorage()
      fs.mkdirSync(path.dirname(file), { recursive: true })
      checkStorage()
      const temporary = `${file}.pending`
      fs.writeFileSync(temporary, JSON.stringify({ schema: 'nori.worker-workspace.v1', workspace }), { flag: 'wx' })
      try {
      if (activate) {
        const receipt = await activate(workspace)
        if (receipt?.workspace?.toLowerCase() !== workspace.toLowerCase() || receipt.restartRequired !== false) throw new Error('Core did not confirm the selected project')
        activeWorkspace = workspace
      }
      try { checkStorage(); fs.renameSync(temporary, file); persistenceWarning = null }
      catch (error) {
        if (!activate) throw error
        persistenceWarning = 'Project is active for this session, but its setting could not be saved. Select it again before the next restart.'
        return read()
      }
      return { workspace, restartRequired: workspace !== activeWorkspace, approvalGranted: false }
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
      } finally { selecting = false }
    },
  }
}
module.exports = { createWorkerWorkspace, validateWorkspace }
