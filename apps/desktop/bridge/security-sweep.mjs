import { execFile } from 'node:child_process'

// Security sweep of the owner's own PC (owner-requested 2026-11-10). One fixed, read-only
// PowerShell script collects facts; the host writes the report, so the model never invents a
// finding. Nothing is changed, nothing is logged into, and nothing leaves the machine. It looks at
// this PC and at the ports the home router forwards to the LAN; it does not attack anything.
export function requestsSecuritySweep(text) {
  if (String(text ?? '').length > 400) return false
  // Speech-to-text drops punctuation mid-phrase ("Security. Issues with my system.try to..."), so match on words only.
  const value = String(text ?? '').toLowerCase().replace(/[.,!?;:]+/g, ' ').replace(/\s+/g, ' ').trim()
  // Reviews of code, sites or other people's systems are not this tool.
  if (/\b(?:code|repo|repository|pull request|website|web ?site|web ?app|server|function|script|their|his|her|someone|company)\b/.test(value)) return false
  const target = /\b(?:my|this|the|our)\s+(?:whole\s+|entire\s+|own\s+)?(?:system|pc|computer|machine|laptop|desktop|windows|setup|rig)\b|\b(?:hack|penetrate|attack|break into)\s+me\b/.test(value)
  const ask = /\bsecurity\s+(?:sweep|check|audit|scan|issues?|problems?|holes?|risks?|review)\b|\b(?:penetrat\w*|pen\s?test\w*|vulnerab\w*|hack\w*|break\s+into|how\s+(?:secure|safe)|is\b.{0,20}\b(?:secure|safe)|thorough\s+sweep)\b/.test(value)
  return (target && ask) || /^\s*(?:(?:hey\s+)?nori[,:\s]+)?(?:please\s+)?(?:run|do|start)\s+(?:a\s+|the\s+)?(?:full\s+|thorough\s+|quick\s+)?security\s+(?:sweep|check|audit|scan)\b/.test(value)
}

const SWEEP = `$ErrorActionPreference = 'SilentlyContinue'
$r = [ordered]@{}
try { $m = Get-MpComputerStatus -ErrorAction Stop
  $r.defender = @{ ok = $true; enabled = [bool]$m.AntivirusEnabled; realtime = [bool]$m.RealTimeProtectionEnabled; tamper = [bool]$m.IsTamperProtected
    signatureAgeDays = [int]$m.AntivirusSignatureAge; quickScanAgeDays = [long]$m.QuickScanAge; fullScanAgeDays = [long]$m.FullScanAge } } catch { $r.defender = @{ ok = $false } }
$r.otherAntivirus = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | ForEach-Object { "$($_.displayName)" })
$r.firewall = @(Get-NetFirewallProfile | ForEach-Object { @{ name = "$($_.Name)"; enabled = ("$($_.Enabled)" -eq 'True') } })
$r.networkCategory = "$((Get-NetConnectionProfile | Select-Object -First 1).NetworkCategory)"
$r.listeners = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalAddress -notmatch '^(127\\.|::1$)' } | Group-Object LocalPort | ForEach-Object {
  $c = $_.Group[0]; @{ port = [int]$_.Name; address = "$($c.LocalAddress)"; process = "$((Get-Process -Id $c.OwningProcess).ProcessName)" } })
$r.rdpEnabled = ((Get-ItemProperty 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server').fDenyTSConnections -eq 0)
$u = Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System'
$r.uac = @{ enabled = ($u.EnableLUA -eq 1); prompt = [int]$u.ConsentPromptBehaviorAdmin }
$r.accounts = @(Get-LocalUser | Where-Object Enabled | ForEach-Object { @{ name = "$($_.Name)"; passwordRequired = [bool]$_.PasswordRequired } })
$r.guestEnabled = [bool](Get-LocalUser -Name Guest).Enabled
$r.admins = @(Get-LocalGroupMember -Group Administrators | ForEach-Object { ("$($_.Name)" -split '\\\\')[-1] })
$r.shares = @(Get-SmbShare | Where-Object { $_.Name -notmatch '\\$$' } | ForEach-Object { "$($_.Name)" })
$h = Get-HotFix | Where-Object InstalledOn | Sort-Object InstalledOn -Descending | Select-Object -First 1
$r.lastUpdateDays = if ($h) { [int]((Get-Date) - $h.InstalledOn).TotalDays } else { $null }
$r.diskEncryption = [int]((New-Object -ComObject Shell.Application).NameSpace('C:').Self.ExtendedProperty('System.Volume.BitLockerProtection'))
try { $r.secureBoot = [bool](Confirm-SecureBootUEFI -ErrorAction Stop) } catch { $r.secureBoot = $null }
$r.startup = @(Get-CimInstance Win32_StartupCommand | Select-Object -First 40 | ForEach-Object { "$($_.Name)" })
$r.remoteTools = @(Get-Process | Where-Object { $_.ProcessName -match '^(AnyDesk|TeamViewer|TeamViewer_Service|rustdesk|vncserver|winvnc|tvnserver|LogMeIn|ScreenConnect\\.ClientService|parsecd|chrome_remote_desktop_host|remoting_host|sunshine|tailscaled|ZeroTier One|ngrok)$' } | ForEach-Object { "$($_.ProcessName)" } | Sort-Object -Unique)
$r.forwards = @(); $r.routerAnswered = $false
try { $c = (New-Object -ComObject HNetCfg.NATUPnP).StaticPortMappingCollection
  if ($c) { $r.routerAnswered = $true; foreach ($m in $c) { $r.forwards += @{ external = [int]$m.ExternalPort; protocol = "$($m.Protocol)"; to = "$($m.InternalClient):$($m.InternalPort)"; name = "$($m.Description)"; enabled = [bool]$m.Enabled } } } } catch {}
$r | ConvertTo-Json -Depth 5 -Compress`

export function collectSecurityFacts({ signal } = {}) {
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SWEEP],
    { windowsHide: true, timeout: 90_000, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, signal }, (error, stdout) => {
      if (signal?.aborted) return reject(signal.reason || new Error('Nori request cancelled'))
      try { resolve(JSON.parse(String(stdout).trim())) } catch { reject(new Error(error ? 'the security sweep did not finish' : 'the security sweep returned unreadable output')) }
    }))
}

// Ports that matter when they answer on the network, with what they are.
const RISKY_PORTS = Object.freeze({ 21: 'FTP file transfer', 22: 'SSH remote login', 23: 'Telnet remote login', 135: 'Windows RPC', 139: 'Windows file sharing (NetBIOS)',
  445: 'Windows file sharing (SMB)', 3389: 'Remote Desktop', 5900: 'VNC remote control', 5985: 'Windows remote management', 5986: 'Windows remote management' })
const list = value => (Array.isArray(value) ? value : value == null ? [] : [value])
const clean = (value, limit = 48) => String(value ?? '').replace(/[^\w .:+()\-@]/g, '').slice(0, limit)

/** Turns collected facts into findings. Every line comes from a measured value. */
export function securityFindings(facts) {
  const risk = [], check = [], good = []
  const d = facts.defender ?? {}
  const others = list(facts.otherAntivirus).map(name => clean(name)).filter(name => name && !/defender/i.test(name))
  if (d.ok && d.enabled && d.realtime) {
    good.push(`Windows Defender is on with real-time protection${d.tamper ? ' and tamper protection' : ''}.`)
    if (d.signatureAgeDays > 7) check.push(`Virus definitions are ${d.signatureAgeDays} days old. Run Windows Update.`)
    if (!d.tamper) check.push('Defender tamper protection is off, so malware could switch the antivirus off.')
    if (d.quickScanAgeDays > 30) check.push(d.quickScanAgeDays > 100000 ? 'Defender has never run a scan on this PC.' : `The last Defender scan was ${d.quickScanAgeDays} days ago.`)
  } else if (others.length) good.push(`Antivirus installed: ${others.join(', ')}. Windows Defender is not the active one, so I could not read its status.`)
  else risk.push(d.ok ? 'Windows Defender real-time protection is OFF and I found no other antivirus.' : 'I could not read the antivirus status, and I found no other antivirus product.')

  const off = list(facts.firewall).filter(profile => !profile.enabled).map(profile => clean(profile.name))
  if (!list(facts.firewall).length) check.push('I could not read the Windows Firewall state.')
  else if (off.length) risk.push(`Windows Firewall is OFF for: ${off.join(', ')}.`)
  else good.push('Windows Firewall is on for every network type.')
  if (facts.networkCategory === 'Public') good.push('This network is set to Public, the stricter firewall setting.')
  else if (facts.networkCategory === 'Private') check.push('This network is set to Private, which lets other devices on your Wi-Fi see this PC. Fine at home; not on shared Wi-Fi.')

  const forwards = list(facts.forwards).filter(item => item.enabled !== false)
  if (forwards.length) risk.push(`Your router forwards ${forwards.length} port(s) from the internet into your home: ${forwards.slice(0, 8).map(item => `${item.external}/${clean(item.protocol, 4)} to ${clean(item.to, 24)}${item.name ? ` (${clean(item.name, 30)})` : ''}`).join('; ')}. Anyone on the internet can reach these. Remove any you do not recognise in the router app.`)
  else if (facts.routerAnswered) good.push('Your router reports no ports forwarded from the internet (UPnP list is empty).')
  else check.push('The router did not answer the port-forward query, so I could not see what it exposes to the internet. Check "port forwarding" in the Xfinity app.')

  if (facts.rdpEnabled) risk.push('Remote Desktop is turned ON. If you do not use it, turn it off in Settings > System > Remote Desktop.')
  else good.push('Remote Desktop is off.')

  const listeners = list(facts.listeners)
  const exposed = listeners.filter(item => RISKY_PORTS[item.port])
  // With the firewall off nothing stands between these ports and every device on the same network.
  const unguarded = off.length > 0
  if (unguarded && exposed.length) risk.push(`With the firewall off, any device on your network can reach: ${exposed.map(item => `port ${item.port} (${RISKY_PORTS[item.port]})`).join(', ')}. Turning the firewall on closes this.`)
  else for (const item of exposed) check.push(`Port ${item.port} (${RISKY_PORTS[item.port]}) is listening for other devices${item.process ? `, by ${clean(item.process, 30)}` : ''}. The firewall decides whether they get in.`)
  const other = listeners.filter(item => !RISKY_PORTS[item.port] && item.port < 49152)
  if (other.length) check.push(`${other.length} other program port(s) accept connections from the network: ${other.slice(0, 12).map(item => `${item.port} (${clean(item.process, 24) || 'unknown'})`).join(', ')}${other.length > 12 ? ', and more' : ''}. Close any program here you do not recognise.`)
  if (!exposed.length && !other.length) good.push('No program is listening for connections from other devices on well-known ports.')

  if (facts.uac?.enabled === false) risk.push('User Account Control is OFF. Programs can make system changes without asking.')
  else if (facts.uac?.prompt === 0) risk.push('User Account Control never prompts, so programs can raise their own privileges silently.')
  else good.push('User Account Control is on.')

  const accounts = list(facts.accounts)
  const noPassword = accounts.filter(account => account.passwordRequired === false).map(account => clean(account.name, 24))
  if (facts.guestEnabled) risk.push('The Guest account is enabled.')
  if (noPassword.length) check.push(`Account(s) allowed to have no password: ${noPassword.join(', ')}. A Microsoft account with a PIN shows up this way too; make sure a password or PIN is set.`)
  const admins = list(facts.admins).map(name => clean(name, 24)).filter(Boolean)
  if (admins.length > 2) check.push(`${admins.length} accounts have administrator rights: ${admins.join(', ')}.`)
  else if (admins.length) good.push(`Administrator accounts: ${admins.join(', ')}.`)

  const shares = list(facts.shares).map(name => clean(name, 24)).filter(Boolean)
  if (shares.length) check.push(`Shared folders visible on the network: ${shares.join(', ')}.`)
  if (Number.isFinite(facts.lastUpdateDays)) (facts.lastUpdateDays > 45 ? check : good).push(facts.lastUpdateDays > 45
    ? `The last Windows update installed ${facts.lastUpdateDays} days ago. Check Windows Update.` : `Windows updated ${facts.lastUpdateDays} day(s) ago.`)
  if (facts.diskEncryption === 1) good.push('Drive C: is encrypted.')
  else if (facts.diskEncryption === 2) check.push('Drive C: is not encrypted. Anyone who takes the PC or the drive can read your files without your password.')
  if (facts.secureBoot === true) good.push('Secure Boot is on.')
  else if (facts.secureBoot === false) check.push('Secure Boot is off.')
  const remote = list(facts.remoteTools).map(name => clean(name, 30)).filter(Boolean)
  if (remote.length) check.push(`Remote-access software is running: ${remote.join(', ')}. Make sure each one is yours.`)
  const startup = list(facts.startup).map(name => clean(name, 30)).filter(Boolean)
  if (startup.length) check.push(`${startup.length} program(s) start with Windows: ${startup.slice(0, 15).join(', ')}${startup.length > 15 ? ', and more' : ''}. Remove any you do not recognise (Task Manager > Startup apps).`)
  return { risk, check, good }
}

export function securityReport(facts) {
  const { risk, check, good } = securityFindings(facts)
  const out = [`I ran a read-only security sweep of this PC and asked your router what it exposes. Nothing was changed. **${risk.length} risk(s), ${check.length} thing(s) to look at, ${good.length} okay.**`]
  if (risk.length) out.push('', '**Fix these**', ...risk.map(line => `- ${line}`))
  if (check.length) out.push('', '**Worth a look**', ...check.map(line => `- ${line}`))
  if (good.length) out.push('', '**Okay**', ...good.map(line => `- ${line}`))
  out.push('', 'What this does not cover: I did not attack the PC from outside your home, scan files for malware, test passwords, or check your phone, router login or online accounts. For malware, run a Defender full scan.')
  return out.join('\n')
}

/** Host-written sweep report for the owner's request. */
export async function securitySweepReply({ signal, collect = collectSecurityFacts } = {}) {
  return securityReport(await collect({ signal }))
}
