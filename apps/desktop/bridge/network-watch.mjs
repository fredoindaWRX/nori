import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

// Guardian network watch for the owner's own home network. The host runs a
// fixed, read-only scan (one ping per address, then the neighbour table) of
// this PC's private /24 only, keeps a device inventory in Nori's data folder,
// and hands the model a factual report so it never invents devices.
// Nothing the user typed reaches a command line; labels are stored as data.
const MAC = /^[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5}$/i
const IP = /^(?:\d{1,3}\.){3}\d{1,3}$/
const MAX_DEVICES = 512

export function requestsNetworkWatch(text) {
  const value = String(text ?? '')
  if (/\bneural\s+network|network\s+(?:effect|marketing|tv|television|show|tab|diagram|panel|request|error|graph)|\b(?:devtools|repo|repository|code|chrome|browser)\b/i.test(value)) return false
  if (networkLabelRequest(value) || networkLabelTooLong(value)) return true
  // Only the owner's own network, and only device/scan questions about it.
  const place = /\b(?:my|our|home|local)\s+(?:home\s+)?(?:network|wi-?fi|lan)\b|\bon\s+(?:my|our|the)\s+(?:wi-?fi|network)\b/i.test(value)
  const ask = /\b(?:scan|sweep|inventory|devices?|connected|who(?:'s| is)?\s+on|anything\s+(?:new|unknown|strange)|unknown|new\s+device|strangers?)\b/i.test(value)
  return (place && ask) || /\b(?:sweep|scan)\s+(?:the\s+)?(?:house|home|network|wi-?fi)\b/i.test(value)
}

// A naming command whose label is too long to save; answered instead of guessed.
export function networkLabelTooLong(text) {
  const match = String(text ?? '').trim().match(/^\s*(?:label|name|call|rename)\s+(?:(?:\d{1,3}\.){3}\d{1,3}|[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5})\s+(?:as\s+|to\s+)?(.+)$/i)
  return Boolean(match && match[1].replace(/["“”.!]/g, '').trim().length > 40)
}

// "call 10.0.0.240 driveway camera", "name 1C:69:20:27:A2:FC as porch light"
export function networkLabelRequest(text) {
  const match = String(text ?? '').trim().match(/\b(?:label|name|call|rename)\s+((?:\d{1,3}\.){3}\d{1,3}|[0-9a-f]{2}(?:[:-][0-9a-f]{2}){5})\s+(?:as\s+|to\s+)?["“]?([^"”\n]{2,40}?)["”]?[.!]?$/i)
  if (!match) return null
  const label = match[2].trim().replace(/[<>`{}[\]\\]/g, '')
  return label.length >= 2 ? { target: match[1].toLowerCase().replace(/-/g, ':'), label } : null
}

const SCAN = `$ErrorActionPreference = 'Stop'
$cfg = Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.IPv4Address } | Select-Object -First 1
if (-not $cfg) { '{"error":"no_default_network"}'; exit }
$ip = @($cfg.IPv4Address)[0]
if ($ip.PrefixLength -ne 24 -or $ip.IPAddress -notmatch '^(10\\.|192\\.168\\.|172\\.(1[6-9]|2[0-9]|3[01])\\.)') { '{"error":"not_private_24"}'; exit }
$prefix = $ip.IPAddress -replace '\\.\\d+$', ''
$tasks = 1..254 | ForEach-Object { [System.Net.NetworkInformation.Ping]::new().SendPingAsync("$prefix.$_", 600) }
try { [System.Threading.Tasks.Task]::WaitAll($tasks) } catch {}
$alive = @($tasks | Where-Object { $_.Status -eq 'RanToCompletion' -and $_.Result.Status -eq 'Success' } | ForEach-Object { $_.Result.Address.ToString() })
Start-Sleep -Milliseconds 500
$devices = @(Get-NetNeighbor -AddressFamily IPv4 -InterfaceIndex $cfg.InterfaceIndex -ErrorAction SilentlyContinue | Where-Object {
  $_.IPAddress -like "$prefix.*" -and $_.LinkLayerAddress -and $_.LinkLayerAddress -notin 'FF-FF-FF-FF-FF-FF','00-00-00-00-00-00' -and $_.State -ne 'Unreachable' } | ForEach-Object {
  [pscustomobject]@{ ip = $_.IPAddress; mac = $_.LinkLayerAddress; ping = $alive -contains $_.IPAddress } })
[pscustomobject]@{ self = $ip.IPAddress; gateway = $cfg.IPv4DefaultGateway.NextHop; subnet = "$prefix.0/24"; adapter = $cfg.InterfaceAlias; devices = $devices } | ConvertTo-Json -Depth 4 -Compress`

function assertActive(signal) { if (signal?.aborted) throw signal.reason || new Error('Nori request cancelled') }

export function scanHomeNetwork({ signal } = {}) {
  assertActive(signal)
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCAN],
    { windowsHide: true, timeout: 45000, encoding: 'utf8', maxBuffer: 1024 * 1024, signal }, (error, stdout) => {
      if (signal?.aborted) return reject(signal.reason || new Error('Nori request cancelled'))
      if (error) return reject(new Error('the network scan did not finish'))
      let value
      try { value = JSON.parse(String(stdout).trim()) } catch { return reject(new Error('the network scan returned unreadable output')) }
      if (value?.error === 'not_private_24') return reject(new Error('this PC is not on a private home network of the supported size, so nothing was scanned'))
      if (value?.error) return reject(new Error('this PC has no active home network connection'))
      const devices = (Array.isArray(value.devices) ? value.devices : value.devices ? [value.devices] : [])
        .filter(device => IP.test(device?.ip) && MAC.test(device?.mac))
        .map(device => ({ ip: device.ip, mac: device.mac.toLowerCase().replace(/-/g, ':'), ping: device.ping === true }))
        .slice(0, MAX_DEVICES)
      resolve({ self: value.self, gateway: value.gateway, subnet: value.subnet, adapter: String(value.adapter || '').slice(0, 60), devices })
    }))
}

function inventoryPath(dataRoot) {
  return path.join(dataRoot, 'network', 'inventory.json')
}

export function readInventory(dataRoot) {
  try {
    const value = JSON.parse(readFileSync(inventoryPath(dataRoot), 'utf8'))
    if (value?.schema === 'nori.network-inventory.v1' && value.devices && typeof value.devices === 'object') return value
  } catch {}
  return { schema: 'nori.network-inventory.v1', scans: 0, devices: {} }
}

function writeInventory(dataRoot, inventory, { signal } = {}) {
  assertActive(signal)
  const file = inventoryPath(dataRoot)
  mkdirSync(path.dirname(file), { recursive: true })
  assertActive(signal)
  const temporary = `${file}.tmp`
  writeFileSync(temporary, `${JSON.stringify(inventory, null, 1)}\n`, 'utf8')
  assertActive(signal)
  renameSync(temporary, file)
  assertActive(signal)
}

const privateMac = mac => /^[0-9a-f][26ae]/.test(mac)
const vendorPrefix = mac => mac.slice(0, 8)

export function labelNetworkDevice(dataRoot, { target, label }, { signal } = {}) {
  assertActive(signal)
  const inventory = readInventory(dataRoot)
  assertActive(signal)
  const entry = MAC.test(target) ? inventory.devices[target]
    : Object.values(inventory.devices).find(device => device.last_ip === target)
  if (!entry) return `I haven't seen ${target} on your network yet, so I didn't save that name. Ask me to scan the network first.`
  entry.label = label
  writeInventory(dataRoot, inventory, { signal })
  assertActive(signal)
  return `Saved: ${entry.last_ip} (${entry.mac}) is now "${label}". I'll use that name in network reports.`
}

/** Scans, updates the stored inventory, and returns a factual report for the model. */
export async function networkWatchReport({ dataRoot, scan = scanHomeNetwork, now = () => new Date(), signal } = {}) {
  assertActive(signal)
  const result = await scan({ signal })
  assertActive(signal)
  const time = now().toISOString()
  const inventory = readInventory(dataRoot)
  const firstScan = inventory.scans === 0
  const seen = new Set()
  const newDevices = []
  for (const device of result.devices) {
    seen.add(device.mac)
    const known = inventory.devices[device.mac]
    if (!known) {
      inventory.devices[device.mac] = { mac: device.mac, first_seen: time, last_seen: time, last_ip: device.ip, label: null }
      if (!firstScan) newDevices.push(device.mac)
    } else {
      known.last_seen = time
      known.previous_ip = known.last_ip !== device.ip ? known.last_ip : known.previous_ip ?? null
      known.last_ip = device.ip
    }
  }
  inventory.scans += 1
  inventory.last_scan = time
  inventory.subnet = result.subnet
  writeInventory(dataRoot, inventory, { signal })
  assertActive(signal)

  // Owner-facing report written by the host: a small local model given a long
  // device list can spend its whole output budget reasoning and return nothing.
  const lastOctet = ip => Number(ip.split('.')[3])
  const devices = [...result.devices].sort((a, b) => lastOctet(a.ip) - lastOctet(b.ip))
  const short = ip => (ip.split('.').slice(0, 3).join('.') === result.subnet.split('.').slice(0, 3).join('.') ? `.${lastOctet(ip)}` : ip)
  const groups = {}
  for (const device of devices) if (!privateMac(device.mac)) (groups[vendorPrefix(device.mac)] ??= []).push(device)
  const describe = (device, shortIp = false) => {
    const entry = inventory.devices[device.mac]
    return `${entry.label ? `**${entry.label}** — ` : ''}${shortIp ? short(device.ip) : device.ip}${newDevices.includes(device.mac) ? ' (NEW)' : ''}`
  }
  const used = new Set()
  const take = list => { list.forEach(device => used.add(device.mac)); return list }
  const router = take(devices.filter(device => device.ip === result.gateway))
  const named = take(devices.filter(device => !used.has(device.mac) && inventory.devices[device.mac].label))
  const phones = take(devices.filter(device => !used.has(device.mac) && privateMac(device.mac)))
  const makerGroups = Object.values(groups).map(list => list.filter(device => !used.has(device.mac))).filter(list => list.length > 1)
  makerGroups.forEach(take)
  const others = devices.filter(device => !used.has(device.mac))
  const fresh = devices.filter(device => newDevices.includes(device.mac))
  const missing = Object.values(inventory.devices).filter(device => !seen.has(device.mac) && device.label)

  const out = [`I scanned your home network just now (read-only: one ping per address, nothing logged into or changed). **${devices.length} devices** are connected.`]
  if (firstScan) out.push('This was my first scan, so I saved it as the baseline. From now on I\'ll point out anything new.')
  else out.push(fresh.length ? `**New since my last scan:** ${fresh.map(describe).join(', ')}. If you don't recognise it, check it in your router app.` : 'Nothing new since my last scan.')
  if (named.length) out.push('', '**Your named devices**', ...named.map(device => `- ${describe(device)}`))
  if (router.length) out.push('', `**Router:** ${router.map(describe).join(', ')}`)
  for (const list of makerGroups) out.push('', `**${list.length} devices from the same maker** (often smart-home gadgets like cameras, plugs or bulbs): ${list.map(device => describe(device, true)).join(', ')}`)
  if (phones.length) out.push('', `**Phones, tablets or laptops** (private Wi-Fi addresses): ${phones.map(device => describe(device, true)).join(', ')}`)
  if (others.length) out.push('', `**Other devices:** ${others.map(device => describe(device, true)).join(', ')}`)
  if (missing.length) out.push('', `**Named but not seen this time** (may be asleep or off): ${missing.map(device => device.label).join(', ')}`)
  const hint = others[0] || makerGroups[0]?.[0] || devices.find(device => device.ip !== result.gateway)
  if (hint) out.push('', `To name a device, say something like "call ${hint.ip} living room light".`)
  return out.join('\n')
}
