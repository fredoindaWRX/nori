import os from 'node:os'
import { execFile } from 'node:child_process'
import { listAdapters } from './hardware-facts.mjs'

// Read-only PC status for plain questions ("how much disk space do I have").
// Each topic runs one fixed query; no model or user text reaches a command line,
// and nothing here changes the machine, so no approval is needed.
const QUERIES = Object.freeze({
  storage: "Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { [pscustomobject]@{ drive=$_.DeviceID; label=$_.VolumeName; size_gb=[math]::Round($_.Size/1GB,1); free_gb=[math]::Round($_.FreeSpace/1GB,1) } } | ConvertTo-Json -Compress",
  memory: "Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 10 | ForEach-Object { [pscustomobject]@{ name=$_.ProcessName; memory_mb=[math]::Round($_.WorkingSet64/1MB) } } | ConvertTo-Json -Compress",
  apps: "Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | Sort-Object ProcessName -Unique | ForEach-Object { [pscustomobject]@{ name=$_.ProcessName; memory_mb=[math]::Round($_.WorkingSet64/1MB); cpu_seconds=[math]::Round($_.CPU,1) } } | ConvertTo-Json -Compress",
  battery: "Get-CimInstance Win32_Battery | ForEach-Object { [pscustomobject]@{ charge_percent=$_.EstimatedChargeRemaining; status=$_.BatteryStatus } } | ConvertTo-Json -Compress",
  network: "Get-NetAdapter -Physical | Where-Object Status -eq 'Up' | ForEach-Object { [pscustomobject]@{ adapter=$_.Name; kind=$_.MediaType; speed=$_.LinkSpeed } } | ConvertTo-Json -Compress",
  graphics: "Get-CimInstance Win32_VideoController | ForEach-Object { [pscustomobject]@{ name=$_.Name; driver=$_.DriverVersion } } | ConvertTo-Json -Compress",
  system: "$o=Get-CimInstance Win32_OperatingSystem; [pscustomobject]@{ windows=$o.Caption; version=$o.Version; last_boot=$o.LastBootUpTime.ToString('yyyy-MM-dd HH:mm') } | ConvertTo-Json -Compress",
})
const TOPICS = ['overview', 'storage', 'memory', 'apps', 'battery', 'network', 'graphics']

function run(executable, args, timeout = 15000) {
  return new Promise(resolve => execFile(executable, args, { windowsHide: true, timeout, maxBuffer: 1024 * 1024, encoding: 'utf8' },
    (error, stdout) => resolve(error ? null : String(stdout).trim())))
}
const powershell = query => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', query])
async function json(query) {
  const text = await powershell(query)
  if (!text) return []
  try { const value = JSON.parse(text); return Array.isArray(value) ? value : [value] } catch { return [] }
}

function overview() {
  const gb = bytes => Math.round(bytes / 1024 ** 3 * 10) / 10
  const cpus = os.cpus()
  return { cpu: cpus[0]?.model?.trim(), cpu_threads: cpus.length, memory_total_gb: gb(os.totalmem()),
    memory_free_gb: gb(os.freemem()), uptime_hours: Math.round(os.uptime() / 360) / 10 }
}

/** nvidia-smi CSV rows; free VRAM is computed here so the model never has to subtract. */
export function parseNvidiaGpus(text) {
  return String(text ?? '').split(/\r?\n/).filter(Boolean).map(line => {
    const [name, total, used, load, temp] = line.split(',').map(value => value.trim())
    return { name, memory_total_mb: Number(total), memory_used_mb: Number(used),
      ...(Number.isFinite(Number(total) - Number(used)) ? { memory_free_mb: Number(total) - Number(used) } : {}),
      load_percent: Number(load), temperature_c: Number(temp) }
  })
}

async function gpus() {
  const text = await run('nvidia-smi', ['--query-gpu=name,memory.total,memory.used,utilization.gpu,temperature.gpu', '--format=csv,noheader,nounits'], 8000)
  if (!text) return json(QUERIES.graphics)
  // nvidia-smi lists NVIDIA cards only. Add every other real card so a second (AMD or Intel) card is not invisible.
  const nvidia = parseNvidiaGpus(text)
  const others = ((await listAdapters()) ?? []).filter(card => card?.name && !nvidia.some(gpu => gpu.name === card.name) && !/nvidia|geforce/i.test(card.name))
    .map(card => ({ name: card.name, driver: card.driver, ...(Number(card.memory_gb) > 0 ? { memory_total_mb: Math.round(Number(card.memory_gb) * 1024) } : {}), note: 'Not an NVIDIA card: live use and temperature are not read for it. Your main model does not run on it.' }))
  return [...nvidia, ...others]
}
// Rule of thumb for "will a local model fit": weights ~ billions of parameters x bits / 8 GB.
export const GPU_FIT_NOTE = 'memory_free_mb is the measured free VRAM right now. A local model needs about (billions of parameters x bits / 8) GB for its weights (a 27B model: about 14-17 GB at 4-bit, about 29 GB at 8-bit; quantized files run a little above the formula) plus roughly 1-4 GB for a long context; it fits only if that is below the free VRAM, otherwise it spills into system RAM and runs much slower.'

export async function pcStatus(topic) {
  if (!TOPICS.includes(topic)) throw Error(`Unknown PC topic; use one of ${TOPICS.join(', ')}`)
  if (topic === 'overview') return { ...overview(), ...(await json(QUERIES.system))[0], disks: await json(QUERIES.storage) }
  if (topic === 'memory') return { ...overview(), top_processes: await json(QUERIES.memory) }
  if (topic === 'apps') {
    // Keep the result inside the 6000-char tool cell even with many windows open.
    const apps = (await json(QUERIES.apps)).sort((a, b) => b.memory_mb - a.memory_mb)
    return { open_apps: apps.slice(0, 40), ...(apps.length > 40 ? { note: `Showing the 40 largest of ${apps.length} open programs.` } : {}) }
  }
  if (topic === 'battery') {
    const batteries = await json(QUERIES.battery)
    return batteries.length ? { batteries } : { batteries: [], note: 'No battery found; this PC runs on mains power.' }
  }
  if (topic === 'graphics') {
    const list = await gpus()
    return { gpus: list, ...(list.some(gpu => Number.isFinite(gpu?.memory_free_mb)) ? { note: GPU_FIT_NOTE } : {}) }
  }
  return { [topic]: await json(QUERIES[topic]) }
}

export function createPcInfoTools({ status = pcStatus } = {}) {
  return {
    pcInfoWorker: true,
    definitions: [{ type: 'function', function: { name: 'check_pc',
      description: 'Read this Windows PC\'s current status. Read-only; changes nothing. Topics: overview (CPU, RAM, Windows, uptime, disks), storage (drives and free space), memory (RAM and the biggest memory users), apps (open programs), battery, network (connected adapters), graphics (GPU, VRAM, load, temperature).',
      parameters: { type: 'object', additionalProperties: false, required: ['topic'],
        properties: { topic: { type: 'string', enum: TOPICS } } } } }],
    async call(name, args) {
      if (name !== 'check_pc') throw Error('Unknown PC tool')
      return JSON.stringify(await status(args?.topic))
    },
  }
}
