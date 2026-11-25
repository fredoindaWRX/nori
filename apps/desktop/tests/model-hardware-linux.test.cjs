const test = require('node:test'), assert = require('node:assert/strict')
const { mkdtempSync, writeFileSync } = require('node:fs'), { tmpdir } = require('node:os'), { join } = require('node:path')
const { scanHardware, selectModel, scanAndSelect, readCatalog } = require('../desktop/model-hardware-selection.cjs')

const GIB = 1024 ** 3
// A made-up Linux machine: sysfs memory blocks, DRM cards, and an optional nvidia-smi reply.
function machine({ totalGiB = 62, freeGiB = 40, blocks = 512, blockHex = '8000000', cards = {}, nvidia = null } = {}) {
  const tree = { '/sys/devices/system/memory/block_size_bytes': blockHex + '\n' }
  const memoryNames = []
  for (let i = 0; i < blocks; i++) { memoryNames.push(`memory${i}`); tree[`/sys/devices/system/memory/memory${i}/online`] = '1\n' }
  const cardNames = Object.keys(cards)
  for (const [card, info] of Object.entries(cards)) {
    tree[`/sys/class/drm/${card}/device/vendor`] = info.vendor + '\n'
    if (info.device) tree[`/sys/class/drm/${card}/device/device`] = info.device + '\n'
    if (info.vram) tree[`/sys/class/drm/${card}/device/mem_info_vram_total`] = String(info.vram) + '\n'
  }
  const files = {
    readFileSync: file => { if (!(file in tree)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return tree[file] },
    readdirSync: dir => dir === '/sys/devices/system/memory' ? ['block_size_bytes', 'auto_online_blocks', ...memoryNames]
      : dir === '/sys/class/drm' ? [...cardNames, 'card0-DP-1', 'version'] : (() => { throw new Error('ENOENT') })(),
  }
  const system = { platform: () => 'linux', arch: () => 'x64', totalmem: () => totalGiB * GIB, freemem: () => freeGiB * GIB, cpus: () => new Array(16).fill({}) }
  const run = async () => { if (nvidia === null) throw new Error('nvidia-smi not found'); return { stdout: nvidia } }
  return { files, system, run }
}
const profile = extra => ({ id: 'linux-cpu-9b', backend: 'norama-cpu', platform: 'linux', arch: 'x64', priority: 10, bundled: true, qualified: true,
  minimumTotalRamBytes: 16 * GIB, minimumAvailableRamBytes: 8 * GIB, weightBytes: 6 * GIB, kvCacheBytes: GIB, workspaceBytes: GIB, safetyMarginBytes: GIB, ...extra })

test('on Linux installed memory comes from sysfs memory blocks and adapters are listed', async () => {
  const host = await scanHardware(machine({ cards: { card0: { vendor: '0x10de', device: '0x2702' }, card1: { vendor: '0x1002', device: '0x67df', vram: 8 * GIB } } }))
  assert.equal(host.platform, 'linux')
  assert.equal(host.installedRamBytes, 512 * 0x8000000)          // 64 GiB installed, 62 visible
  assert.equal(host.installedRamSource, 'sysfs memory blocks')
  assert.equal(host.installedRamScanError, null)
  assert.deepEqual(host.displayAdapters, [
    { card: 'card0', vendorId: '0x10de', vendor: 'NVIDIA', deviceId: '0x2702', vramBytes: null },
    { card: 'card1', vendorId: '0x1002', vendor: 'AMD', deviceId: '0x67df', vramBytes: 8 * GIB },
  ])
  assert.deepEqual(host.gpus, []); assert.match(host.gpuScanError, /CUDA candidates cannot be selected/)
})

test('an unusable sysfs reading falls back to visible memory and never raises eligibility', async () => {
  const low = await scanHardware(machine({ blocks: 100 }))                    // 12.5 GiB "installed" on a 62 GiB machine
  assert.equal(low.installedRamBytes, null); assert.match(low.installedRamScanError, /using OS-visible RAM/)
  const wild = await scanHardware(machine({ blocks: 4096 }))                  // 512 GiB claimed
  assert.equal(wild.installedRamBytes, null)
  const none = machine(); none.files.readFileSync = () => { throw new Error('EACCES') }
  const blind = await scanHardware(none)
  assert.equal(blind.installedRamBytes, null); assert.deepEqual(blind.displayAdapters, [])
  assert.equal(selectModel(blind, [profile()]).status, 'READY', 'visible memory is still enough for the processor-only profile')
})

test('selection on Linux takes only Linux profiles that are bundled and qualified', async () => {
  const windowsOnly = profile({ id: 'win-cuda-35b', platform: 'win32' })
  const unqualified = profile({ id: 'linux-cuda-35b', backend: 'norama-cuda', qualified: false, priority: 50, minimumDriverVersion: '550.0', computeCapabilities: ['8.9'] })
  const { host, selection } = await scanAndSelect([windowsOnly, unqualified, profile()], machine({ nvidia: '0, NVIDIA GeForce RTX 4080 SUPER, 16376, 15000, 8.9, 565.57\n' }))
  assert.equal(host.gpus.length, 1)
  assert.equal(selection.status, 'READY'); assert.equal(selection.selected.id, 'linux-cpu-9b')
  const why = Object.fromEntries(selection.evaluated.map(e => [e.id, e.reasons]))
  assert.deepEqual(why['win-cuda-35b'], ['Unsupported operating system or architecture'])
  assert.deepEqual(why['linux-cuda-35b'], ['Model/runtime profile has not been qualified'])
  const nothing = await scanAndSelect([windowsOnly, unqualified], machine())
  assert.equal(nothing.selection.status, 'NO_COMPATIBLE_MODEL')
  const tight = await scanAndSelect([profile()], machine({ freeGiB: 5 }))
  assert.equal(tight.selection.status, 'NO_COMPATIBLE_MODEL')
  assert.match(tight.selection.evaluated[0].reasons.join(' '), /Insufficient available RAM/)
})

test('a catalog file is a list of profiles, or an object with a profiles list', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nori-catalog-'))
  writeFileSync(join(dir, 'a.json'), JSON.stringify([profile()]))
  writeFileSync(join(dir, 'b.json'), JSON.stringify({ profiles: [profile(), profile({ id: 'x' })] }))
  writeFileSync(join(dir, 'c.json'), JSON.stringify({ models: [] }))
  assert.equal(readCatalog(join(dir, 'a.json')).length, 1)
  assert.equal(readCatalog(join(dir, 'b.json')).length, 2)
  assert.throws(() => readCatalog(join(dir, 'c.json')), /list of at most 64 profiles/)
})
