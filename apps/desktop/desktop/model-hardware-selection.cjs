// Read-only host scan and selection policy for portable Nori launchers.
// Profiles must describe bundled models and verified runtime requirements.
const os = require('node:os')
const fs = require('node:fs')
const path = require('node:path')
const {execFile} = require('node:child_process')
const {promisify} = require('node:util')
const execute = promisify(execFile)
const MIB = 1024 ** 2

function parseInstalledRam(output, visibleBytes) {
  const capacities = JSON.parse(output)
  if (!Array.isArray(capacities) || capacities.length === 0 || capacities.length > 1024)
    throw Error('Invalid installed RAM result')
  let total = 0
  for (const capacity of capacities) {
    if (typeof capacity !== 'string' || !/^[1-9]\d*$/.test(capacity) ||
        !Number.isSafeInteger(Number(capacity))) throw Error('Invalid memory module capacity')
    total += Number(capacity)
    if (!Number.isSafeInteger(total)) throw Error('Invalid aggregate installed RAM')
  }
  if (!bytes(visibleBytes) || total < visibleBytes) throw Error('Installed RAM is below OS-visible RAM')
  return total
}

function parseGpus(output) {
  if (!output.trim()) return []
  return output.trim().split(/\r?\n/).map(line => {
    const parts = line.split(',').map(part => part.trim())
    if (parts.length !== 6) throw Error('Unrecognized GPU scan result')
    const [index, name, total, free, computeCapability, driverVersion] = parts
    if (!/^\d+$/.test(index) || !Number.isSafeInteger(Number(index)) || !/^\d+(\.\d+)?$/.test(computeCapability) ||
        ![total, free].every(value => /^\d+(\.\d+)?$/.test(value)) ||
        Number(total) <= 0 || Number(free) > Number(total)) throw Error('Invalid GPU memory/capability result')
    return {index:Number(index),name,totalBytes:Number(total)*MIB,freeBytes:Number(free)*MIB,
      computeCapability,driverVersion}
  })
}

// Linux (Nori OS, milestone 4): installed memory and the display adapters, read from sysfs without root.
// Both are information for the selection step; neither can make an unqualified profile eligible.
const GIB = 1024 ** 3
const VENDORS = Object.freeze({'0x10de':'NVIDIA','0x1002':'AMD','0x8086':'Intel'})
function linuxInstalledRam(files, visibleBytes) {
  const base = '/sys/devices/system/memory'
  const block = Number.parseInt(String(files.readFileSync(`${base}/block_size_bytes`, 'utf8')).trim(), 16)
  const online = files.readdirSync(base).filter(name => /^memory\d+$/.test(name)).filter(name => {
    try { return String(files.readFileSync(`${base}/${name}/online`, 'utf8')).trim() === '1' } catch { return false }
  }).length
  const installed = block * online
  // Memory blocks cover what the firmware handed over. A value below what the system can see, or far above it,
  // means the reading is not usable; the caller then falls back to visible memory, which is the cautious side.
  if (!Number.isSafeInteger(installed) || installed < visibleBytes || installed > visibleBytes + Math.max(4 * GIB, visibleBytes / 4))
    throw Error('Implausible sysfs memory block total')
  return installed
}
function linuxDisplayAdapters(files) {
  const base = '/sys/class/drm', out = []
  let cards = []
  try { cards = files.readdirSync(base).filter(name => /^card\d+$/.test(name)).sort() } catch { return out }
  const read = file => { try { return String(files.readFileSync(file, 'utf8')).trim() } catch { return null } }
  for (const card of cards.slice(0, 8)) {
    const vendorId = read(`${base}/${card}/device/vendor`), deviceId = read(`${base}/${card}/device/device`)
    if (!vendorId || !/^0x[0-9a-f]{4}$/i.test(vendorId)) continue
    const vram = Number(read(`${base}/${card}/device/mem_info_vram_total`))   // amdgpu exposes this; others do not
    out.push({card, vendorId: vendorId.toLowerCase(), vendor: VENDORS[vendorId.toLowerCase()] ?? 'Other',
      deviceId: deviceId && /^0x[0-9a-f]{4}$/i.test(deviceId) ? deviceId.toLowerCase() : null,
      vramBytes: Number.isSafeInteger(vram) && vram > 0 ? vram : null})
  }
  return out
}

async function scanHardware({run=execute,system=os,files=fs}={}) {
  const host = {platform:system.platform(),arch:system.arch(),totalRamBytes:system.totalmem(),
    availableRamBytes:system.freemem(),logicalCpus:system.cpus().length,gpus:[],gpuScanError:null,
    installedRamBytes:null,installedRamSource:null,installedRamScanError:null}
  if (host.platform === 'win32') {
    try {
      const result = await run(path.win32.join(process.env.SystemRoot || 'C:\\Windows',
        'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile','-NonInteractive','-Command',
          "$capacities = @(Get-CimInstance -ClassName Win32_PhysicalMemory -ErrorAction Stop | ForEach-Object { [string]$_.Capacity }); ConvertTo-Json -InputObject $capacities -Compress"],
        {shell:false,windowsHide:true,timeout:5000,maxBuffer:65536,encoding:'utf8'})
      host.installedRamBytes = parseInstalledRam(result.stdout, host.totalRamBytes)
      host.installedRamSource = 'Win32_PhysicalMemory.Capacity'
    } catch {
      // Unknown module capacity never increases eligibility; use OS-visible RAM.
      host.installedRamScanError = 'Installed RAM scan unavailable; using OS-visible RAM conservatively.'
    }
  }
  if (host.platform === 'linux') {
    try {
      host.installedRamBytes = linuxInstalledRam(files, host.totalRamBytes)
      host.installedRamSource = 'sysfs memory blocks'
    } catch {
      host.installedRamScanError = 'Installed RAM scan unavailable; using OS-visible RAM conservatively.'
    }
    // AMD and Intel adapters are listed so the owner can see them. Only NVIDIA cards read by nvidia-smi below
    // can satisfy a CUDA profile.
    host.displayAdapters = linuxDisplayAdapters(files)
  }
  try {
    const result = await run('nvidia-smi',
      ['--query-gpu=index,name,memory.total,memory.free,compute_cap,driver_version','--format=csv,noheader,nounits'],
      {shell:false,windowsHide:true,timeout:5000,maxBuffer:65536,encoding:'utf8'})
    host.gpus = parseGpus(result.stdout)
  } catch {
    // Missing NVIDIA driver/tools is a normal CPU-only host, never proof of CUDA compatibility.
    host.gpuScanError = 'NVIDIA capability scan unavailable; CUDA candidates cannot be selected.'
  }
  // External scans can consume their timeout window; refresh host availability
  // after those queries rather than returning the older entry sample.
  host.availableRamBytes = system.freemem()
  return host
}

function bytes(value) { return Number.isSafeInteger(value) && value >= 0 }
function driverAtLeast(actual,minimum) {
  if (![actual,minimum].every(v=>typeof v==='string' && /^\d+(?:\.\d+){1,3}$/.test(v))) return false
  const a=actual.split('.').map(Number),b=minimum.split('.').map(Number)
  for(let i=0;i<Math.max(a.length,b.length);i++) {
    if((a[i]??0)!==(b[i]??0)) return (a[i]??0)>(b[i]??0)
  }
  return true
}
function validProfile(p) {
  return p && typeof p.id === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(p.id) &&
    ['norama-cuda','norama-cpu'].includes(p.backend) && typeof p.platform === 'string' &&
    typeof p.arch === 'string' && Number.isFinite(p.priority) &&
    ['minimumTotalRamBytes','minimumAvailableRamBytes','weightBytes','kvCacheBytes','workspaceBytes','safetyMarginBytes']
      .every(key => bytes(p[key])) &&
    p.weightBytes > 0 && p.safetyMarginBytes > 0 &&
    (p.backend !== 'norama-cuda' || (driverAtLeast(p.minimumDriverVersion,p.minimumDriverVersion) && Array.isArray(p.computeCapabilities) &&
      p.computeCapabilities.length > 0 && p.computeCapabilities.every(c => /^\d+\.\d+$/.test(c))))
}

function selectModel(host, profiles) {
  if (!host || !bytes(host.totalRamBytes) || !bytes(host.availableRamBytes) ||
      host.availableRamBytes > host.totalRamBytes || !Array.isArray(host.gpus) || !Array.isArray(profiles) ||
      (host.installedRamBytes != null && (!bytes(host.installedRamBytes) || host.installedRamBytes < host.totalRamBytes)))
    throw Error('Invalid host/catalog input')
  const installedRamBytes = host.installedRamBytes ?? host.totalRamBytes
  const evaluated = profiles.map(p => {
    const reasons = []
    if (!validProfile(p)) return {id:p?.id ?? null,eligible:false,reasons:['Invalid or incomplete runtime profile']}
    if (p.bundled !== true) reasons.push('Model is not bundled')
    if (p.qualified !== true) reasons.push('Model/runtime profile has not been qualified')
    if (p.platform !== host.platform || p.arch !== host.arch) reasons.push('Unsupported operating system or architecture')
    if (installedRamBytes < p.minimumTotalRamBytes) reasons.push('Insufficient installed RAM')
    if (host.availableRamBytes < p.minimumAvailableRamBytes) reasons.push('Insufficient available RAM; close applications and rescan')
    const requiredGpuBytes = p.weightBytes+p.kvCacheBytes+p.workspaceBytes+p.safetyMarginBytes
    if (!Number.isSafeInteger(requiredGpuBytes)) reasons.push('Invalid aggregate memory budget')
    const requiredRamBytes=p.backend==='norama-cpu' ? Math.max(p.minimumAvailableRamBytes,requiredGpuBytes) : p.minimumAvailableRamBytes
    if(p.backend==='norama-cpu' && host.availableRamBytes<requiredRamBytes)
      reasons.push('Insufficient available RAM for CPU weights, cache, workspace and safety margin')
    let gpu = null
    if (p.backend === 'norama-cuda') {
      gpu = host.gpus.filter(g => g && bytes(g.index) && bytes(g.freeBytes) && bytes(g.totalBytes) &&
        (g.index === 0 || p.supportsGpuSelection === true) &&
        driverAtLeast(g.driverVersion,p.minimumDriverVersion) &&
        g.freeBytes <= g.totalBytes && p.computeCapabilities.includes(g.computeCapability) &&
        g.freeBytes >= requiredGpuBytes)
        .sort((a,b) => b.freeBytes-a.freeBytes || a.index-b.index)[0] ?? null
      if (!gpu) reasons.push('No supported NVIDIA GPU with sufficient free dedicated memory and required driver version')
    }
    return {id:p.id,backend:p.backend,priority:p.priority,eligible:reasons.length===0,
      gpuIndex:gpu?.index ?? null,requiredGpuBytes:p.backend==='norama-cuda'?requiredGpuBytes:0,requiredRamBytes,reasons}
  })
  const selected = evaluated.filter(p => p.eligible).sort((a,b) => b.priority-a.priority || a.id.localeCompare(b.id))[0] ?? null
  return {status:selected?'READY':'NO_COMPATIBLE_MODEL',selected,evaluated,
    message:selected?`Selected ${selected.id} for ${selected.backend}.`:
      'No bundled, qualified model fits this computer. Do not start inference; review compatibility details.'}
}

// One call for a boot script: scan this computer and choose from a catalog of profiles.
async function scanAndSelect(profiles, options) {
  const host = await scanHardware(options)
  return {host, selection: selectModel(host, profiles)}
}
function readCatalog(file, files = fs) {
  const value = JSON.parse(files.readFileSync(file, 'utf8'))
  const profiles = Array.isArray(value) ? value : value?.profiles
  if (!Array.isArray(profiles) || profiles.length > 64) throw Error('The catalog must be a list of at most 64 profiles')
  return profiles
}

module.exports = {parseGpus,parseInstalledRam,scanHardware,selectModel,scanAndSelect,readCatalog,linuxInstalledRam,linuxDisplayAdapters}
// node model-hardware-selection.cjs                    prints the scan
// node model-hardware-selection.cjs --select FILE.json prints the scan and the chosen profile; exit code 3 when none fits
if (require.main === module) {
  const at = process.argv.indexOf('--select')
  if (at < 0) scanHardware().then(host => console.log(JSON.stringify(host,null,2)))
  else scanAndSelect(readCatalog(process.argv[at + 1])).then(result => {
    console.log(JSON.stringify(result,null,2))
    process.exitCode = result.selection.status === 'READY' ? 0 : 3
  }).catch(error => { console.error(String(error.message)); process.exitCode = 2 })
}
