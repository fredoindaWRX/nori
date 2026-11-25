import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { managedInstructionCatalog, managedInstructionSkillContext } from '../bridge/managed-instruction-skills.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'nori-managed-guide-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const identity = 'a'.repeat(64), base = join(root, 'packages', identity, 'avoid-ai-writing')
  mkdirSync(join(base, 'references'), { recursive: true })
  const contents = { 'SKILL.md': '# Complete fixture guide\nPreserve the facts.', 'references/patterns.md': '# Complete fixture patterns\nAvoid stock phrases.', LICENSE: 'MIT license fixture' }
  const files = {}
  for (const [name, content] of Object.entries(contents)) {
    writeFileSync(join(base, name), content)
    files[name] = { bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') }
  }
  writeFileSync(join(root, 'registry.json'), JSON.stringify({ schema: 'nori.instruction-skills.v1', packages: {
    [identity]: { archive_sha256: identity, skills: [{ name: 'avoid-ai-writing', description: 'Writing guidance', mode: 'instruction_reference', code_execution_enabled: false, files }] },
  } }))
  return { root, base }
}

test('verified installed guidance stays short for everyday replies', t => {
  const f = fixture(t)
  assert.equal(managedInstructionCatalog(f.root).length, 1)
  const context = managedInstructionSkillContext('Good evening.', f.root)
  assert.match(context, /Write naturally and directly/)
  assert.match(context, /snark or dismissive teasing/)
  assert.ok(context.length < 1000)
})

test('explicit prose work loads the complete guide and patterns; code work stays out', t => {
  const f = fixture(t)
  const context = managedInstructionSkillContext('Rewrite this paragraph to remove AI-isms.', f.root)
  assert.match(context, /Complete fixture guide/)
  assert.match(context, /Complete fixture patterns/)
  assert.doesNotMatch(managedInstructionSkillContext('Rewrite this Python function.', f.root), /Complete fixture/)
})

test('tampered or missing registered resources cannot become chat guidance', t => {
  const f = fixture(t)
  writeFileSync(join(f.base, 'references/patterns.md'), 'tampered')
  assert.deepEqual(managedInstructionCatalog(f.root), [])
  assert.equal(managedInstructionSkillContext('Rewrite my prose.', f.root), '')
  assert.equal(managedInstructionSkillContext('Hi.', join(f.root, 'missing')), '')
})
