const { execFileSync } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

function tailscaleExecutable({ platform = process.platform, programFiles = process.env.ProgramFiles,
  pathValue = process.env.Path || process.env.PATH, exists = existsSync } = {}) {
  if (platform === 'win32') {
    const candidate = join(programFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe')
    return exists(candidate) ? candidate : null
  }
  for (const directory of (pathValue || '').split(require('node:path').delimiter)) {
    const candidate = join(directory, 'tailscale')
    if (exists(candidate)) return candidate
  }
  return null
}

function tailscaleRemoteContext({ execute = execFileSync, executable = tailscaleExecutable(), port = 8444 } = {}) {
  if (!executable) throw new Error('Tailscale is unavailable')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError('Invalid Tailscale Serve port')
  let status
  try {
    const raw = execute(executable, ['status', '--json'], {
      encoding: 'utf8', windowsHide: true, timeout: 4000, maxBuffer: 2 * 1024 * 1024,
    })
    status = JSON.parse(raw)
  } catch {
    throw new Error('Tailscale identity is unavailable')
  }
  const self = status?.Self
  const login = status?.User?.[String(self?.UserID)]?.LoginName
  const dnsName = typeof self?.DNSName === 'string' ? self.DNSName.replace(/\.$/, '') : ''
  if (status?.BackendState !== 'Running' || self?.Online !== true
      || typeof login !== 'string' || !/^[^\s@]+@[^\s@]+$/.test(login)
      || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.ts\.net$/i.test(dnsName)) {
    throw new Error('Tailscale owner identity is unavailable')
  }
  return { ownerLogin: login, origin: `https://${dnsName}:${port}` }
}

module.exports = { tailscaleExecutable, tailscaleRemoteContext }

async function tailscaleRemoteContextAsync({ execute = require('node:util').promisify(require('node:child_process').execFile), executable = tailscaleExecutable(), port = 8444 } = {}) {
  if (!executable) throw Object.assign(new Error('Tailscale is unavailable'), { code: 'TAILSCALE_UNAVAILABLE' })
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new TypeError('Invalid Tailscale Serve port')
  let raw
  try {
    const result = await execute(executable, ['status', '--json'], { encoding: 'utf8', windowsHide: true, timeout: 4000, maxBuffer: 2 * 1024 * 1024 })
    raw = typeof result === 'string' ? result : result.stdout
    return tailscaleRemoteContext({ execute: () => raw, executable, port })
  } catch {
    throw Object.assign(new Error('Tailscale owner identity is unavailable'), { code: 'TAILSCALE_IDENTITY_UNAVAILABLE' })
  }
}

module.exports.tailscaleRemoteContextAsync = tailscaleRemoteContextAsync
