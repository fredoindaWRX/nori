import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const executable = fileURLToPath(new URL('../norama-header.exe', import.meta.url))
function runFixture(bytes, inspect = false, args = [], program = executable) {
  const directory = mkdtempSync(join(tmpdir(), 'norama-header-test-'))
  try {
    const file = join(directory, 'fixture.gguf')
    writeFileSync(file, bytes)
    return spawnSync(program, [file, ...(inspect ? ['--inspect'] : []), ...args], { encoding: 'utf8', timeout: 3000, windowsHide: true })
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
function header(version = 3, tensors = 2n, metadata = 3n) {
  const bytes = Buffer.alloc(24)
  bytes.write('GGUF')
  bytes.writeUInt32LE(version, 4)
  bytes.writeBigUInt64LE(tensors, 8)
  bytes.writeBigUInt64LE(metadata, 16)
  return bytes
}

test('compiled independent reader accepts a v3 header', () => {
  const result = runFixture(header())
  assert.equal(result.status, 0)
  assert.match(result.stdout, /version=3 tensors=2 metadata=3/)
})
test('compiled reader rejects every truncated header length', () => {
  const bytes = header()
  for (let length = 0; length < bytes.length; length++) assert.notEqual(runFixture(bytes.subarray(0, length)).status, 0)
})
test('compiled reader rejects unsupported versions and unreasonable counts', () => {
  assert.match(runFixture(header(2)).stderr, /unsupported/)
  assert.match(runFixture(header(3, 1000001n)).stderr, /unreasonable/)
  assert.match(runFixture(header(3, 2n, 0xffffffffffffffffn)).stderr, /unreasonable/)
})
test('compiled reader rejects bad magic', () => {
  const bytes = header()
  bytes.write('FAIL')
  assert.match(runFixture(bytes).stderr, /not GGUF/)
})

function descriptor({ offset = 0n, dimensions = [1n], type = 0, name: label = 'test.weight' } = {}) {
  const name = Buffer.from(label)
  const descriptor = Buffer.alloc(8 + name.length + 4 + dimensions.length * 8 + 4 + 8)
  descriptor.writeBigUInt64LE(BigInt(name.length))
  name.copy(descriptor, 8)
  let cursor = 8 + name.length
  descriptor.writeUInt32LE(dimensions.length, cursor); cursor += 4
  for (const dimension of dimensions) { descriptor.writeBigUInt64LE(dimension, cursor); cursor += 8 }
  descriptor.writeUInt32LE(type, cursor); cursor += 4
  descriptor.writeBigUInt64LE(offset, cursor)
  return descriptor
}
function ggufFixture(tensors, metadata = [], data = Buffer.alloc(4)) {
  const directory = Buffer.concat([header(3, BigInt(tensors.length), BigInt(metadata.length)), ...metadata, ...tensors])
  const padding = Buffer.alloc((32 - directory.length % 32) % 32)
  return Buffer.concat([directory, padding, data])
}
function tensorFixture(options = {}) {
  return ggufFixture([descriptor(options)], [], options.data ?? Buffer.alloc(4))
}
function u32(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b }
function u64(value) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b }
function string(value) { const b = Buffer.from(value); return Buffer.concat([u64(b.length), b]) }
function metadata(key, type, value) {
  return Buffer.concat([string(key), u32(type), value])
}

test('independent tensor directory reader accepts a synthetic F32 tensor', () => {
  const result = runFixture(tensorFixture(), true)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /tensor byte extents validated/)
})

test('reader rejects full tensor extents that cross EOF even when the start is valid', () => {
  assert.match(runFixture(tensorFixture({ dimensions: [2n] }), true).stderr, /byte extent outside/)
  const fixture = tensorFixture()
  for (let bytes = 1; bytes <= 4; bytes++)
    assert.notEqual(runFixture(fixture.subarray(0, fixture.length - bytes), true).status, 0)
})
test('reader checks quantized and 16-bit storage byte lengths', () => {
  for (const [type, dimensions, size] of [[12, [256n], 144], [14, [256n], 210], [1, [1n], 2], [30, [1n], 2]]) {
    const options = { type, dimensions, data: Buffer.alloc(size) }
    assert.equal(runFixture(tensorFixture(options), true).status, 0)
    assert.match(runFixture(tensorFixture({ ...options, data: Buffer.alloc(size - 1) }), true).stderr, /byte extent outside/)
  }
  assert.match(runFixture(tensorFixture({ type: 12, dimensions: [257n] }), true).stderr, /storage block/)
  assert.match(runFixture(tensorFixture({ type: 99 }), true).stderr, /unsupported tensor storage/)
})
test('reader rejects overlapping storage and duplicate tensor names', () => {
  const overlapping = ggufFixture([descriptor({ name: 'a' }), descriptor({ name: 'b' })])
  assert.match(runFixture(overlapping, true).stderr, /overlapping/)
  const duplicate = ggufFixture([descriptor(), descriptor({ offset: 32n })], [], Buffer.alloc(36))
  assert.match(runFixture(duplicate, true).stderr, /duplicate tensor/)
})
test('reader rejects duplicate metadata and incorrect reserved value types', () => {
  const item = metadata('general.architecture', 8, string('nori-fixture'))
  assert.match(runFixture(ggufFixture([descriptor()], [item, item]), true).stderr, /duplicate metadata/)
  assert.match(runFixture(ggufFixture([descriptor()], [metadata('general.alignment', 10, u64(32))]), true).stderr, /wrong metadata type/)
  assert.match(runFixture(ggufFixture([descriptor()], [metadata('general.architecture', 4, u32(1))]), true).stderr, /wrong metadata type/)
})
test('reader rejects excessive metadata budgets, nesting and unknown empty-array types', () => {
  let item = metadata('test.values', 9, Buffer.concat([u32(0), u64(2000001)]))
  assert.match(runFixture(ggufFixture([descriptor()], [item]), true).stderr, /budget/)
  item = metadata('test.values', 9, Buffer.concat([u32(99), u64(0)]))
  assert.match(runFixture(ggufFixture([descriptor()], [item]), true).stderr, /type/)
  let nested = Buffer.from([0])
  let type = 0
  for (let depth = 0; depth < 10; depth++) { nested = Buffer.concat([u32(type), u64(1), nested]); type = 9 }
  assert.match(runFixture(ggufFixture([descriptor()], [metadata('test.values', 9, nested)]), true).stderr, /nesting/)
})
test('independent F32 weight reader loads known signed values and refuses nonfinite weights', () => {
  const data = Buffer.alloc(8); data.writeFloatLE(-1.5); data.writeFloatLE(2.25, 4)
  const result = runFixture(tensorFixture({ dimensions: [2n], data }), false, ['--read-f32', 'test.weight'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /elements=2 minimum=-1.5 maximum=2.25/)
  data.writeFloatLE(NaN)
  assert.match(runFixture(tensorFixture({ dimensions: [2n], data }), false, ['--read-f32', 'test.weight']).stderr, /nonfinite model weight/)
})
test('actual checkpoint API checks relative range boundaries and requires prior inspection', () => {
  const data = Buffer.alloc(8); data.writeFloatLE(-1.5); data.writeFloatLE(2.25, 4)
  const program = fileURLToPath(new URL('../norama-range-test.exe', import.meta.url))
  const result = runFixture(tensorFixture({ dimensions: [2n], data }), false, [], program)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /range reads and rejection checks passed/)
})
test('independent reader rejects unaligned and out-of-file tensor starts', () => {
  assert.match(runFixture(tensorFixture({ offset: 1n }), true).stderr, /unaligned/)
  assert.match(runFixture(tensorFixture({ offset: 32n }), true).stderr, /outside model/)
})
test('independent reader rejects zero and overflowing tensor dimensions', () => {
  assert.match(runFixture(tensorFixture({ dimensions: [0n] }), true).stderr, /zero tensor/)
  assert.match(runFixture(tensorFixture({ dimensions: [0xffffffffffffffffn, 2n] }), true).stderr, /overflow/)
})

test('compiled weight loader decodes complete rows across each supported storage format', () => {
  for (const [type, dimensions, data, pattern] of [
    [0, [1n, 2n], Buffer.from([0, 0, 128, 63, 0, 0, 0, 192]), /elements=2 minimum=-2 maximum=1/],
    [1, [2n], Buffer.from([0, 60, 0, 192]), /elements=2 minimum=-2 maximum=1/],
    [30, [2n], Buffer.from([128, 63, 0, 192]), /elements=2 minimum=-2 maximum=1/],
    [12, [256n, 2n], Buffer.alloc(288), /elements=512 minimum=0 maximum=0/],
    [14, [256n, 2n], Buffer.alloc(420), /elements=512 minimum=-?0 maximum=-?0/],
  ]) {
    const result = runFixture(tensorFixture({ type, dimensions, data }), false, ['--read-weights', 'test.weight'])
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, pattern)
  }
})

test('compiled weight loader rejects nonfinite compressed scales and expanded allocation bombs', () => {
  for (const [type, size, offset] of [[12, 144, 0], [14, 210, 208]]) {
    const data = Buffer.alloc(size); data.writeUInt16LE(0x7c00, offset)
    assert.match(runFixture(tensorFixture({ type, dimensions: [256n], data }), false,
      ['--read-weights', 'test.weight']).stderr, /nonfinite/)
  }
  const data = Buffer.alloc(144 * (65536 + 1))
  const result = runFixture(tensorFixture({ type: 12, dimensions: [256n, 65537n], data }), false,
    ['--read-weights', 'test.weight'])
  assert.match(result.stderr, /decoded 64 MiB limit/)
})
