import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const learningModule = pathToFileURL(resolve(import.meta.dirname, '../bridge/nori-learning.mjs')).href

test('failed memory clear retains the previous in-memory and on-disk records', () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-memory-clear-failure-'))
  const file = join(root, 'learned-guidance.json')
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict'
      import {readFileSync, renameSync, mkdirSync} from 'node:fs'
      const memory = await import(${JSON.stringify(learningModule)})
      const file = process.env.NORI_LEARNING_FILE
      assert.equal(memory.learnFromUserText('Remember that the scratch marker is retained.').kind, 'knowledge')
      const previous = readFileSync(file, 'utf8')
      renameSync(file, file + '.preserved')
      mkdirSync(file)
      assert.deepEqual(memory.learnFromUserText('clear learning memory'), {kind:'cleared', saved:false})
      assert.ok(memory.listLearnedMemory().entries.some(entry => entry.text === 'the scratch marker is retained.'))
      assert.equal(readFileSync(file + '.preserved', 'utf8'), previous)
    `], {encoding:'utf8', windowsHide:true, env:{...process.env, NORI_LEARNING_FILE:file}})
    assert.equal(result.status, 0, result.stderr)
  } finally {
    rmSync(root, {recursive:true, force:true})
  }
})

test('explicitly remembered knowledge survives bridge restart and model change', () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-memory-persist-'))
  const file = join(root, 'learned-guidance.json')
  const run = (runtime, source) => spawnSync(process.execPath,
    ['--input-type=module', '-e', source], {
      encoding: 'utf8',
      env: { ...process.env, NORI_LEARNING_FILE: file, NORI_INFERENCE_RUNTIME: runtime },
    })
  try {
    const save = run('norllama', `
      const memory = await import(${JSON.stringify(learningModule)})
      const result = memory.learnFromUserText('Remember that Neuralese is Nori\u2019s translation layer.')
      if (result.kind !== 'knowledge') process.exit(11)
      if(memory.learnFromUserText('From now on, when I refine artwork or animation, preserve the scene and use the creative tools to carry out the refinement rather than only explaining it.').kind!=='preference')process.exit(12)
      console.log(result.kind)
    `)
    assert.equal(save.status, 0, save.stderr)
    assert.equal(save.stdout.trim(), 'knowledge')

    const restore = run('gpt-oss', `
      const memory = await import(${JSON.stringify(learningModule)})
      console.log(memory.learnedContext())
    `)
    assert.equal(restore.status, 0, restore.stderr)
    assert.match(restore.stdout, /Remembered knowledge:[\s\S]*Neuralese is Nori\u2019s translation layer/)
    assert.match(restore.stdout,/Ongoing preferences:[\s\S]*preserve the scene and use the creative tools/)

    const record = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(record.schema, 'nori.learned-guidance.v2')
    assert.equal(record.knowledge.length, 1)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('legacy preference and correction memories remain loadable', () => {
  const root = mkdtempSync(join(tmpdir(), 'nori-memory-legacy-'))
  const file = join(root, 'learned-guidance.json')
  try {
    writeFileSync(file, JSON.stringify({
      schema: 'nori.learned-guidance.v1',
      preferences: [{ text: 'The user prefers concise answers.', at: new Date().toISOString() }],
      feedback: [{ text: 'No, that answer was incorrect.', at: new Date().toISOString() }],
    }))
    const restored = spawnSync(process.execPath, ['--input-type=module', '-e', `
      const memory = await import(${JSON.stringify(learningModule)})
      console.log(memory.learnedContext())
    `], {
      encoding: 'utf8',
      env: { ...process.env, NORI_LEARNING_FILE: file },
    })
    assert.equal(restored.status, 0, restored.stderr)
    assert.match(restored.stdout, /The user prefers concise answers/)
    assert.match(restored.stdout, /No, that answer was incorrect/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
