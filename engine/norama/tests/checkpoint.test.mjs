import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const program = fileURLToPath(new URL('../norama-checkpoint-test.exe', import.meta.url))
const residentProgram = fileURLToPath(new URL('../norama-resident-graph-test.exe', import.meta.url))
const cachedProgram = fileURLToPath(new URL('../norama-cached-graph-test.exe', import.meta.url))
const numericalProgram = fileURLToPath(new URL('../norama-numerical-probe.exe', import.meta.url))
const longContextProgram = fileURLToPath(new URL('../norama-long-context-probe.exe', import.meta.url))
function u32(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b }
function u64(value) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(value)); return b }
function str(value) { const b = Buffer.from(value); return Buffer.concat([u64(b.length), b]) }
function f32(value) { const b = Buffer.alloc(4); b.writeFloatLE(value); return b }
function fixture(options = {}) {
  const entries = [
    ['general.architecture', 8, str(options.architecture ?? 'llama')],
    ...Object.entries({ embedding_length: 4, 'attention.head_count': options.heads ?? 2,
      'attention.head_count_kv': 1, feed_forward_length: 8, 'rope.dimension_count': 2,
      block_count: 2, context_length: options.longContext ? 1024 : 16, vocab_size: 5 }).map(([key, value]) => [`llama.${key}`, 4, u32(value)]),
    ['llama.attention.layer_norm_rms_epsilon', 6, f32(options.epsilon ?? 1e-5)],
    ['llama.rope.freq_base', 6, f32(10000)],
  ]
  if (options.scaling) entries.push(['llama.rope.scaling.type', 8, str('unknown')])
  if (options.unknownParameter) entries.push(['llama.attention.sliding_window', 4, u32(4)])
  const tensors = []
  function tensor(name, dimensions, values) {
    tensors.push({ name, dimensions, data: Buffer.concat(values.map(f32)) })
  }
  tensor('token_embd.weight', [4, 5], Array.from({ length: 20 }, (_, i) => options.longContext
    ? ((i * 7 + Math.floor(i / 4) * 3) % 19 - 9) / 13 : i % 4 === 0 ? i / 4 + 1 : 0))
  tensor('output_norm.weight', [4], [1, 1, 1, 1])
  tensor('rope_freqs.weight', [1], [options.factor ?? 1])
  for (let layer = 0; layer < 2; layer++) {
    const prefix = `blk.${layer}.`
    for (const name of ['attn_norm.weight', 'ffn_norm.weight']) tensor(prefix + name, [4], [1, 1, 1, 1])
    let salt = layer * 7
    for (const [name, rows, columns] of [
      ['attn_q', 4, 4], ['attn_k', 2, 4], ['attn_v', 2, 4], ['attn_output', 4, 4],
      ['ffn_gate', 8, 4], ['ffn_up', 8, 4], ['ffn_down', 4, 8],
    ]) {
      salt++
      tensor(prefix + name + '.weight', [columns, rows], Array.from({ length: rows * columns },
        (_, i) => options.nonzero ? ((i + salt) % 11 - 5) / 97 : 0))
    }
  }
  if (options.missing) tensors.pop()
  if (options.extra) tensor('unhandled.bias', [1], [0])
  if (options.badShape) tensors[0].dimensions = [5, 4]
  const metadata = entries.map(([key, type, value]) => Buffer.concat([str(key), u32(type), value]))
  let offset = 0
  const data = [], descriptors = []
  for (const item of tensors) {
    descriptors.push(Buffer.concat([str(item.name), u32(item.dimensions.length), ...item.dimensions.map(u64), u32(0), u64(offset)]))
    data.push(item.data)
    const padding = (32 - item.data.length % 32) % 32
    data.push(Buffer.alloc(padding)); offset += item.data.length + padding
  }
  const header = Buffer.concat([Buffer.from('GGUF'), u32(3), u64(tensors.length), u64(metadata.length), ...metadata, ...descriptors])
  return Buffer.concat([header, Buffer.alloc((32 - header.length % 32) % 32), ...data])
}
function run(options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'norama-checkpoint-'))
  try {
    const path = join(directory, 'fixture.gguf'); writeFileSync(path, fixture(options))
    return spawnSync(options.longContext ? longContextProgram : options.numerical ? numericalProgram : options.cached ? cachedProgram : options.resident ? residentProgram : program,
      [path, ...(options.longContext ? ['--fixture'] : options.numerical ? ['0', '1', '4'] : !options.resident && !options.cached && options.nonzero ? ['--nonzero'] : [])],
      { encoding: 'utf8', timeout: 15000, windowsHide: true })
  } finally { rmSync(directory, { recursive: true, force: true }) }
}
test('complete imported graph matches independently known synthetic logits and checks cancellation', () => {
  const result = run(); assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, /analytic logits/)
})
test('257-token nonzero graph matches CPU across128-token seams and mature-cache rollback/reset', () => {
  const result = run({ longContext: true, nonzero: true })
  assert.equal(result.status, 0, result.stderr)
  const records = result.stdout.trim().split(/\r?\n/).map(JSON.parse)
  assert.deepEqual(records.filter(row => row.phase === 'cpu_vs_chunked').map(row => row.tokens), [128, 256, 257])
  assert.deepEqual(records.filter(row => row.phase && row.phase !== 'cpu_vs_chunked').map(row => row.phase),
    ['different_chunk_boundaries', 'rollback_then_reuse', 'reset_then_prefill'])
  assert.equal(records.at(-1).status, 'PASS')
  assert.equal(records.at(-1).cpu_full_context_reference, true)
  assert.equal(records.at(-1).execution_authorized, false)
})
test('long-context diagnostic rejects wrong modes,count and token IDs before model/GPU use', () => {
  for (const args of [[], ['--unknown'], ['--fixture', '1'], ['--actual'], ['--actual', ...Array(129).fill('bad')],
    ['--actual', ...Array(1025).fill('0')]]) {
    const result = spawnSync(longContextProgram, ['missing.gguf', ...args], { encoding: 'utf8', timeout: 3000, windowsHide: true })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /usage: long-context-probe|fixture takes|actual context|invalid long-context token/)
    assert.doesNotMatch(result.stderr, /cannot open model|CUDA/)
  }
})
test('bounded numerical probe compares every CPU/resident/cached/reset fixture logit', () => {
  for (const nonzero of [false, true]) {
    const result = run({ numerical: true, nonzero })
    assert.equal(result.status, 0, result.stderr)
    const records = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line))
    assert.deepEqual(records.filter(row => row.reference_top !== undefined).map(row => row.phase),
      ['cpu_vs_resident', 'cpu_vs_cached', 'cpu_vs_reset'])
    assert.equal(records.at(-1).status, 'PASS')
    assert.equal(records.at(-1).execution_authorized, false)
    assert.equal(records.at(-1).external_reference, false)
  }
})
test('numerical probe rejects invalid token/count input before reading model or touching GPU', () => {
  for (const args of [[], ['bad'], ['-1'], ['4294967296'], Array(17).fill('0')]) {
    const result = spawnSync(numericalProgram, ['missing.gguf', ...args],
      { encoding: 'utf8', timeout: 3000, windowsHide: true })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /usage: numerical-probe|invalid numerical-probe token/)
    assert.doesNotMatch(result.stderr, /cannot open model|CUDA/)
  }
})
test('nonzero imported projections and feed-forward matrices match a separately assembled model graph', () => {
  const result = run({ nonzero: true }); assert.equal(result.status, 0, result.stderr)
})
test('GPU-resident synthetic imports match CPU reference and survive cancellation/rejection', () => {
  for (const nonzero of [false, true]) {
    const result = run({ resident: true, nonzero }); assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /reference\/cancellation\/reuse pass/)
  }
})
test('incremental GPU-cached graph matches CPU prefixes and isolates/rolls back session state', () => {
  for (const nonzero of [false, true]) {
    const result = run({ cached: true, nonzero }); assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /transactional cancellation\/reset\/moves\/budgets pass/)
  }
})
test('import preflight rejects unsupported architecture,missing weights and unhandled tensors', () => {
  for (const [options, message] of [[{ architecture: 'other' }, /architecture/], [{ missing: true }, /tensor not found/],
    [{ extra: true }, /unsupported imported tensor/], [{ badShape: true }, /shape mismatch/]]) {
    const result = run(options); assert.notEqual(result.status, 0); assert.match(result.stderr, message)
  }
})
test('import preflight refuses invalid attention,norm,rotary and unknown scaling', () => {
  for (const [options, message] of [[{ heads: 3 }, /attention dimensions/], [{ epsilon: NaN }, /nonfinite/],
    [{ epsilon: 0 }, /normalization/], [{ factor: 0 }, /rotary factor/], [{ scaling: true }, /scaling metadata/],
    [{ unknownParameter: true }, /execution metadata/]]) {
    const result = run(options); assert.notEqual(result.status, 0); assert.match(result.stderr, message)
  }
})
