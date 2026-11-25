import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statfsSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { assembleLocalVideo, verifyLocalVideoAssembly } from '../bridge/local-video-assembly.mjs'

const pythonPath = 'C:\\Nori\\integrations\\image-generation\\runtime\\ComfyUI_windows_portable\\python_embeded\\python.exe'
const FIXTURE_PREFIX = 'nori-video-assembly-test-'
let cleanedFiles = 0, cleanedBytes = 0

function python(code, job) {
  const run = spawnSync(pythonPath, ['-I', '-B', '-c', code], {
    shell: false, windowsHide: true, input: JSON.stringify(job), encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 60_000,
  })
  assert.equal(run.error, undefined, run.error?.message)
  assert.equal(run.status, 0, run.stderr)
  return run.stdout.trim() ? JSON.parse(run.stdout) : undefined
}

const makeClipsCode = `import av, json, sys
from fractions import Fraction
job = json.load(sys.stdin)
for spec in job:
    with av.open(spec["path"], mode="w", format="mp4") as container:
        stream = container.add_stream("libx264", rate=spec.get("fps", 16))
        stream.width, stream.height = spec.get("width", 832), spec.get("height", 480)
        stream.pix_fmt = "yuv420p"
        stream.codec_context.thread_count = 1
        stream.codec_context.max_b_frames = 0
        stream.options = {"crf": "18", "preset": "ultrafast", "tune": "zerolatency"}
        for index in range(spec.get("frames", 33)):
            frame = av.VideoFrame(stream.width, stream.height, "rgb24")
            pixel = bytes(spec["color"])
            for plane in frame.planes:
                plane.update((pixel * ((plane.buffer_size + 2) // 3))[:plane.buffer_size])
            frame.pts, frame.time_base = index, Fraction(1, spec.get("fps", 16))
            for packet in stream.encode(frame): container.mux(packet)
        for packet in stream.encode(): container.mux(packet)
`

const inspectCode = `import av, json, sys
from fractions import Fraction
job = json.load(sys.stdin)
frames = 0
samples = {}
with av.open(job["path"], format="mov") as container:
    stream = container.streams.video[0]
    for frame in container.decode(stream):
        assert frame.pts * frame.time_base == Fraction(frames, 16)
        if frames in (0, 32, 33, 65, 66, 79):
            samples[str(frames)] = list(bytes(frame.reformat(format="rgb24").planes[0])[:3])
        frames += 1
    print(json.dumps({"frames": frames, "fps": float(stream.average_rate), "width": stream.width,
        "height": stream.height, "duration": float(stream.duration * stream.time_base), "samples": samples}))
`

function inventory(root) {
  let files = 0, bytes = 0
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    const info = lstatSync(path)
    if (info.isDirectory() && !info.isSymbolicLink()) {
      const child = inventory(path); files += child.files; bytes += child.bytes
    } else { files++; bytes += info.size }
  }
  return { files, bytes }
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), FIXTURE_PREFIX))
  const outputRoot = join(root, 'output')
  mkdirSync(outputRoot)
  t.after(() => {
    const absolute = resolve(root)
    const rel = relative(resolve(tmpdir()), absolute)
    assert.ok(!isAbsolute(rel) && !rel.startsWith('..') && rel.startsWith(FIXTURE_PREFIX))
    const before = inventory(absolute)
    rmSync(absolute, { recursive: true, force: true })
    assert.equal(existsSync(absolute), false, 'only the owned synthetic fixture must be removed')
    cleanedFiles += before.files; cleanedBytes += before.bytes
  })
  return { root, outputRoot, outputPath: join(outputRoot, 'assembled.mp4'), pythonPath }
}

function clips(f, specs = [{ color: [230, 20, 20] }, { color: [20, 220, 20] }, { color: [20, 20, 230] }]) {
  const requested = specs.map((spec, index) => ({ ...spec, path: join(f.outputRoot, `shot-${index + 1}.mp4`) }))
  python(makeClipsCode, requested)
  return requested.map(spec => spec.path)
}

function noPartials(f) { assert.deepEqual(readdirSync(f.outputRoot).filter(name => name.includes('.partial.')), []) }

test('NDJSON limits individual records, not a legal 64 KiB pipe chunk plus its preceding partial line', async () => {
  // Execute the production function unchanged, supplying only deterministic child-process pipes.
  // This needs no production test-only export and no actual process, disk output, or live service.
  const moduleSource = readFileSync(new URL('../bridge/local-video-assembly.mjs', import.meta.url), 'utf8')
  const start = moduleSource.indexOf('function runHelper(')
  const end = moduleSource.indexOf('/** Probe the exact bundled CPU encoder', start)
  assert.ok(start >= 0 && end > start)
  function invoke(chunks) {
    const child = new EventEmitter()
    let killed = false, progress = 0
    child.stdout = new EventEmitter(); child.stdout.setEncoding = () => {}
    child.stderr = new EventEmitter(); child.stderr.setEncoding = () => {}
    child.stdin = new EventEmitter()
    child.kill = () => { killed = true }
    child.stdin.end = () => queueMicrotask(() => {
      for (const chunk of chunks) { if (killed) break; child.stdout.emit('data', chunk) }
      child.emit('close', killed ? 1 : 0)
    })
    const productionRunHelper = runInNewContext(`(${moduleSource.slice(start, end)})`, {
      spawn: () => child, Buffer, setTimeout, clearTimeout,
      MAX_LINE_BYTES: 64 * 1024, IDLE_TIMEOUT_MS: 120_000,
      throwIfAborted: () => {}, abortError: () => new Error('not used by this parser test'),
    })
    return { promise: productionRunHelper('unused', '', { totalFrames: 80 }, undefined, () => { progress++ }),
      wasKilled: () => killed, progressCount: () => progress }
  }
  const line = `${JSON.stringify({ type: 'progress', stage: 'assembling', frames: 16, totalFrames: 80 })}\n`
  const payload = line.repeat(2000) + `${JSON.stringify({ type: 'result', frameCount: 80 })}\n`
  const chunks = [payload.slice(0, 17), payload.slice(17, 17 + 65536), payload.slice(17 + 65536)]
  assert.equal(Buffer.byteLength(chunks[1]), 65536)
  assert.ok(Buffer.byteLength(chunks[0] + chunks[1]) > 65536)
  const valid = invoke(chunks)
  assert.equal((await valid.promise).frameCount, 80)
  assert.equal(valid.progressCount(), 2000)
  assert.equal(valid.wasKilled(), false)
  const tooLongLine = JSON.stringify({ type: 'progress', stage: 'assembling', frames: 16, totalFrames: 80, padding: 'x'.repeat(65536) })
  for (const badChunks of [[`${tooLongLine}\n`], [line, 'x'.repeat(65537)]]) {
    const invalid = invoke(badChunks)
    await assert.rejects(invalid.promise, /Invalid assembly helper output/)
    assert.equal(invalid.wasKilled(), true)
  }
})

test('bundled PyAV/libx264 preflight and three real colored shots assemble to exactly 5 seconds', async t => {
  const f = fixture(t)
  const preflight = await verifyLocalVideoAssembly(f)
  assert.equal(preflight.pythonPath, pythonPath)
  assert.equal(preflight.encoder, 'libx264')
  assert.match(preflight.pyavVersion, /^\d+\./)
  t.diagnostic(`CPU-only bundled runtime: ${preflight.pythonPath}; PyAV ${preflight.pyavVersion}; libx264`)
  const sources = clips(f)
  const events = []
  const result = await assembleLocalVideo({ ...f, clips: sources, totalFrames: 80, onProgress: event => events.push(event) })
  assert.equal(result.path, f.outputPath)
  assert.equal(result.mimeType, 'video/mp4')
  assert.equal(result.frameCount, 80)
  assert.equal(result.durationSeconds, 5)
  assert.equal(result.fps, 16)
  assert.ok(result.size > 0)
  const actual = python(inspectCode, { path: result.path })
  assert.deepEqual({ frames: actual.frames, fps: actual.fps, width: actual.width, height: actual.height, duration: actual.duration },
    { frames: 80, fps: 16, width: 832, height: 480, duration: 5 })
  for (const index of [0, 32]) assert.ok(actual.samples[index][0] > 180 && actual.samples[index][1] < 50)
  for (const index of [33, 65]) assert.ok(actual.samples[index][1] > 180 && actual.samples[index][0] < 50)
  for (const index of [66, 79]) assert.ok(actual.samples[index][2] > 180 && actual.samples[index][0] < 50)
  assert.ok(events.some(value => value.stage === 'assembling' && value.frames === 80))
  assert.ok(events.some(value => value.stage === 'verifying' && value.frames === 80))
  noPartials(f)
})

test('single new shot can be trimmed to an exact non-whole-second duration', async t => {
  const f = fixture(t)
  const result = await assembleLocalVideo({ ...f, clips: clips(f, [{ color: [20, 200, 200] }]), totalFrames: 17 })
  assert.equal(result.frameCount, 17)
  assert.equal(result.durationSeconds, 17 / 16)
  assert.equal(python(inspectCode, { path: result.path }).frames, 17)
})

test('real 121-frame cinematic shot trims to exactly 120 frames at 24 fps',async t=>{
  const f=fixture(t),root=f.outputRoot,clip=join(root,'cinematic.mp4'),outputPath=join(root,'cinematic-final.mp4')
  python(makeClipsCode,[{path:clip,color:[30,140,70],frames:121,fps:24,width:704,height:1280}])
  const result=await assembleLocalVideo({clips:[clip],outputPath,totalFrames:120,fps:24,width:704,height:1280,outputRoot:root,pythonPath})
  assert.equal(result.frameCount,120);assert.equal(result.durationSeconds,5)
  const actual=python(`import av,json,sys
from fractions import Fraction
j=json.load(sys.stdin)
with av.open(j['path']) as c:
 s=c.streams.video[0];count=0
 for frame in c.decode(s):
  assert frame.pts*frame.time_base==Fraction(count,24)
  count+=1
 print(json.dumps({'count':count,'fps':float(s.average_rate),'width':s.width,'height':s.height}))`,{path:outputPath})
  assert.deepEqual(actual,{count:120,fps:24,width:704,height:1280})
})

test('cinematic assembly refuses a short 120-frame source and unsupported profile substitution',async t=>{
  const f=fixture(t),root=f.outputRoot,clip=join(root,'short-cinematic.mp4')
  python(makeClipsCode,[{path:clip,color:[30,140,70],frames:120,fps:24,width:704,height:1280}])
  const options={clips:[clip],outputPath:join(root,'no-output.mp4'),totalFrames:120,fps:24,width:704,height:1280,outputRoot:root,pythonPath}
  await assert.rejects(assembleLocalVideo(options),/expected 121 frames/)
  await assert.rejects(assembleLocalVideo({...options,width:720}),/qualified profile/)
  assert.equal(existsSync(options.outputPath),false)
})

test('corrupt input is rejected without changing inputs or leaving an output/partial', async t => {
  const f = fixture(t)
  const corrupt = join(f.outputRoot, 'corrupt.mp4')
  writeFileSync(corrupt, 'not a video')
  await assert.rejects(assembleLocalVideo({ ...f, clips: [corrupt], totalFrames: 16 }), /assembly failed/)
  assert.equal(readFileSync(corrupt, 'utf8'), 'not a video')
  assert.equal(existsSync(f.outputPath), false)
  noPartials(f)
})

test('short clips fail even when enough frames exist for the requested trim', async t => {
  const f = fixture(t)
  await assert.rejects(assembleLocalVideo({ ...f, clips: clips(f, [{ color: [200, 20, 20], frames: 20 }]), totalFrames: 16 }), /short.*expected 33 frames/)
  assert.equal(existsSync(f.outputPath), false)
  noPartials(f)
})

test('wrong dimensions and frame rates are rejected', async t => {
  for (const bad of [{ width: 640 }, { fps: 24 }]) {
    const f = fixture(t)
    await assert.rejects(assembleLocalVideo({ ...f, clips: clips(f, [{ color: [200, 20, 20], ...bad }]), totalFrames: 16 }), /wrong dimensions or frame rate/)
    assert.equal(existsSync(f.outputPath), false)
    noPartials(f)
  }
})

test('cancellation kills only the owned assembler and removes its partial output', async t => {
  const f = fixture(t)
  const sources = clips(f)
  const controller = new AbortController()
  await assert.rejects(assembleLocalVideo({ ...f, clips: sources, totalFrames: 80, signal: controller.signal,
    onProgress: event => { if (event.stage === 'assembling' && event.frames >= 16) controller.abort() },
  }), { name: 'AbortError' })
  assert.ok(sources.every(path => existsSync(path)))
  assert.equal(existsSync(f.outputPath), false)
  noPartials(f)
})

test('existing destination, duplicate clip and out-of-root paths are rejected before writing', async t => {
  const f = fixture(t)
  const sources = clips(f, [{ color: [200, 20, 20] }])
  writeFileSync(f.outputPath, 'keep original')
  await assert.rejects(assembleLocalVideo({ ...f, clips: sources, totalFrames: 16 }), /already exists/)
  assert.equal(readFileSync(f.outputPath, 'utf8'), 'keep original')
  await assert.rejects(assembleLocalVideo({ ...f, outputPath: join(f.outputRoot, 'duplicate.mp4'), clips: [sources[0], sources[0]], totalFrames: 40 }), /Repeated video clips/)
  await assert.rejects(assembleLocalVideo({ ...f, outputPath: join(f.root, 'outside.mp4'), clips: sources, totalFrames: 16 }), /inside Nori/)
  await assert.rejects(assembleLocalVideo({ ...f, outputPath: join(f.outputRoot, 'inside.mp4'), clips: [join(f.root, 'outside.mp4')], totalFrames: 16 }), /inside Nori/)
  noPartials(f)
})

test('output junction escape is refused without touching the outside target', async t => {
  const f = fixture(t)
  const sources = clips(f, [{ color: [200, 20, 20] }])
  const outside = join(f.root, 'outside')
  mkdirSync(outside)
  const linked = join(f.outputRoot, 'junction')
  symlinkSync(outside, linked, 'junction')
  await assert.rejects(assembleLocalVideo({ ...f, outputPath: join(linked, 'escape.mp4'), clips: sources, totalFrames: 16 }), /escapes Nori/)
  assert.deepEqual(readdirSync(outside), [])
  noPartials(f)
})

test('racing destination is preserved by no-overwrite publication', async t => {
  const f = fixture(t)
  const sources = clips(f, [{ color: [200, 20, 20] }])
  let planted = false
  await assert.rejects(assembleLocalVideo({ ...f, clips: sources, totalFrames: 16,
    onProgress: event => { if (!planted && event.stage === 'verifying') { writeFileSync(f.outputPath, 'racing owner'); planted = true } },
  }), /EEXIST/)
  assert.equal(readFileSync(f.outputPath, 'utf8'), 'racing owner')
  noPartials(f)
})

test('missing runtime and pre-aborted jobs create no output', async t => {
  const f = fixture(t)
  const missing = join(f.root, 'missing', 'python.exe')
  await assert.rejects(verifyLocalVideoAssembly({ pythonPath: missing }), /runtime is unavailable/)
  const sources = clips(f, [{ color: [200, 20, 20] }])
  await assert.rejects(assembleLocalVideo({ ...f, pythonPath: missing, clips: sources, totalFrames: 16 }), /runtime is unavailable/)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(assembleLocalVideo({ ...f, clips: sources, totalFrames: 16, signal: controller.signal }), { name: 'AbortError' })
  assert.equal(existsSync(f.outputPath), false)
  noPartials(f)
})

test('runtime discovery uses trusted Nori roots only and never PATH', async t => {
  const f = fixture(t)
  const names = ['NORI_ROOT', 'NORI_SUITE_ROOT']
  const previous = names.map(name => process.env[name])
  try {
    delete process.env.NORI_ROOT; delete process.env.NORI_SUITE_ROOT
    await assert.rejects(verifyLocalVideoAssembly(), /runtime is unavailable/)
    process.env.NORI_SUITE_ROOT = resolve(dirname(pythonPath), '..', '..', '..', '..', '..')
    const result = await verifyLocalVideoAssembly()
    assert.equal(result.pythonPath, pythonPath)
  } finally {
    names.forEach((name, index) => { if (previous[index] === undefined) delete process.env[name]; else process.env[name] = previous[index] })
  }
  noPartials(f)
})

test('actual ASAR-loaded helper preflights and assembles exactly 5 seconds under Electron-as-Node without UI', async t => {
  const f = fixture(t)
  const sources = clips(f)
  const stage = join(f.root, 'tiny-package')
  mkdirSync(join(stage, 'bridge'), { recursive: true })
  for (const name of ['local-video-assembly.mjs', 'local-video-assembly.py']) {
    copyFileSync(new URL(`../bridge/${name}`, import.meta.url), join(stage, 'bridge', name))
  }
  const asar = createRequire(import.meta.url)('C:/Nori/apps/desktop/node_modules/@electron/asar/lib/asar.js')
  const archive = join(f.root, 'assembly-test.asar')
  await asar.createPackage(stage, archive)
  const helperBytes = readFileSync(new URL('../bridge/local-video-assembly.py', import.meta.url))
  assert.deepEqual(asar.extractFile(archive, 'bridge/local-video-assembly.py'), helperBytes)
  const electronPath = 'C:\\Nori\\runtime\\electron\\v44.4.5\\electron.exe'
  const script = `const fs = require('node:fs'); const {pathToFileURL} = require('node:url');
const chunks = []; process.stdin.on('data', chunk => chunks.push(chunk));
process.stdin.on('end', async () => {
  try {
    const job = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const helper = fs.readFileSync(job.helperPath, 'utf8');
    if (!helper.includes('CPU-only, streaming assembly')) throw Error('ASAR Python helper is missing');
    const mod = await import(pathToFileURL(job.modulePath).href);
    const preflight = await mod.verifyLocalVideoAssembly(job.options);
    const result = await mod.assembleLocalVideo(job.options);
    console.log(JSON.stringify({preflight, result, electronVersion: process.versions.electron, helperBytes: Buffer.byteLength(helper)}));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
});`
  const run = spawnSync(electronPath, ['-e', script], {
    shell: false, windowsHide: true, encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    input: JSON.stringify({ modulePath: join(archive, 'bridge', 'local-video-assembly.mjs'),
      helperPath: join(archive, 'bridge', 'local-video-assembly.py'),
      options: { ...f, clips: sources, totalFrames: 80 } }),
  })
  assert.equal(run.error, undefined, run.error?.message)
  assert.equal(run.status, 0, run.stderr)
  const actual = JSON.parse(run.stdout.trim())
  assert.equal(actual.electronVersion, '44.4.5')
  assert.equal(actual.helperBytes, helperBytes.length)
  assert.equal(actual.preflight.pythonPath, pythonPath)
  assert.equal(actual.preflight.encoder, 'libx264')
  assert.equal(actual.result.frameCount, 80)
  assert.equal(actual.result.durationSeconds, 5)
  assert.equal(python(inspectCode, { path: actual.result.path }).frames, 80)
  noPartials(f)
  t.diagnostic(`Actual tiny ASAR helper read and 80-frame encode passed using ${electronPath} with ELECTRON_RUN_AS_NODE=1; no UI.`)
})

test.after(() => {
  const disk = statfsSync('C:\\')
  console.log(`Synthetic fixture cleanup verified: ${cleanedFiles} files, ${cleanedBytes} bytes removed; C: free ${disk.bavail * disk.bsize} bytes. No live Nori output or GPU was used.`)
})
