import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { scopedWorkspacePath } from '../bridge/artcraft-mcp-tools.mjs'

test('WordCraft workspace paths map short and contract-relative names into the proper Nori roots', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'nori-artcraft-path-'))
  try {
    const inputs = path.join(base, 'app-sandboxes', 'wordcraft', 'inputs')
    const outputs = path.join(base, 'app-sandboxes', 'wordcraft', 'outputs')
    mkdirSync(inputs, { recursive: true })
    mkdirSync(outputs, { recursive: true })
    assert.equal(scopedWorkspacePath('resume.docx', inputs, 'wordcraft', 'inputs'), path.join(inputs, 'resume.docx'))
    assert.equal(scopedWorkspacePath('app-sandboxes/wordcraft/inputs/resume.docx', inputs, 'wordcraft', 'inputs'), path.join(inputs, 'resume.docx'))
    assert.equal(scopedWorkspacePath('revised.docx', outputs, 'wordcraft', 'outputs'), path.join(outputs, 'revised.docx'))
    assert.equal(scopedWorkspacePath('outputs/revised.docx', outputs, 'wordcraft', 'outputs'), path.join(outputs, 'revised.docx'))
  } finally { rmSync(base, { recursive: true, force: true }) }
})

test('WordCraft workspace path translation rejects traversal and absolute paths outside its root', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'nori-artcraft-path-'))
  const inputs = path.join(base, 'inputs')
  mkdirSync(inputs)
  try {
    assert.throws(() => scopedWorkspacePath('../outside.docx', inputs, 'wordcraft', 'inputs'), /invalid path component/)
    assert.throws(() => scopedWorkspacePath(path.join(base, 'outside.docx'), inputs, 'wordcraft', 'inputs'), /outside its Nori workspace/)
  } finally { rmSync(base, { recursive: true, force: true }) }
})
