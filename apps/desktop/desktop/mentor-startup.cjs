const fs = require('node:fs')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { createMentorCredential } = require('./mentor-credential.cjs')

function startMentorConnection({ dataRoot, credentialRoot = dataRoot, port, create = createMentorCredential }) {
  let token = '', outcome = 'unavailable', errorCode = null
  try {
    fs.mkdirSync(credentialRoot, { recursive: true, mode: 0o700 })
    token = create({ dataRoot: credentialRoot, port }).token
    outcome = 'ready'
  } catch (error) {
    // Never persist exception text, command output, paths, stacks or keys.
    errorCode = /^[A-Z][A-Z0-9_]{0,39}$/.test(error?.code || '') ? error.code : 'CREDENTIAL_PUBLICATION_FAILED'
  }
  const status = { schema: 'nori.mentor-startup.v1', pid: process.pid, outcome,
    checkedAt: new Date().toISOString(), errorCode }
  const destination = path.join(dataRoot, 'mentor-startup-status.json')
  const temporary = path.join(dataRoot, `.mentor-status-${randomBytes(8).toString('hex')}.tmp`)
  try {
    const rootInfo = fs.lstatSync(dataRoot)
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()
        || fs.realpathSync(dataRoot).toLowerCase() !== path.resolve(dataRoot).toLowerCase()) return { token, status }
    if (fs.existsSync(destination)) {
      const info = fs.lstatSync(destination)
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) return { token, status }
    }
    fs.writeFileSync(temporary, JSON.stringify(status), { flag: 'wx', mode: 0o600 })
    fs.renameSync(temporary, destination)
  } catch { /* A diagnostic failure cannot enable mentor access or block chat. */ }
  finally { try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) } catch { /* Best-effort diagnostic cleanup. */ } }
  return { token, status }
}

module.exports = { startMentorConnection }
