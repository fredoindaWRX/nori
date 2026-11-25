import test from 'node:test'
import assert from 'node:assert/strict'
import { neuralActivity, NEURAL_REGIONS, NEURAL_CENTERS } from '../src/scene/neural-activity.ts'

const idle = { phase: 'dormant', level: 0, muted: true, activeTool: null, looking: null, connected: [] }
test('idle emits no processing activity; text reception activates language', () => {
  assert.deepEqual(neuralActivity(idle), NEURAL_REGIONS.map(() => 0))
  assert.equal(neuralActivity(idle, true)[0], 1)
})
test('file tools activate project and tools; web search makes no project claim', () => {
  assert.deepEqual(neuralActivity({...idle, phase:'tooling', activeTool:'Read file'}).slice(0,6), [0,1,0,0,0,1])
  assert.equal(neuralActivity({...idle, activeTool:'Web search'})[1], 0)
  assert.equal(neuralActivity({...idle, activeTool:'thread'})[1], 0)
})

test('tool execution alone does not claim model language processing', () => {
  const tooling = {...idle, phase:'tooling', activeTool:'recall_memory'}
  assert.equal(neuralActivity(tooling)[0], 0)
  assert.equal(neuralActivity(tooling)[2], 1)
  assert.equal(neuralActivity(tooling)[5], 1)
  assert.equal(neuralActivity(tooling, true)[0], 1)
  assert.equal(neuralActivity({...idle, phase:'thinking'})[0], 1)
})
test('memory and vision require an observation or relevant tool', () => {
  assert.equal(neuralActivity({...idle, activeTool:'recall_memory'})[2], 1)
  assert.equal(neuralActivity({...idle, looking:'Inspecting shared screen'})[4], 1)
  assert.equal(neuralActivity({...idle, gestures:true, screenMonitor:true})[4], 0)
})
test('native tool names and MCP filesystem events activate project activity', () => {
  for (const activeTool of ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'ReadFile', 'mcp__filesystem__read_file', 'filesystem · list_directory']) {
    const activity = neuralActivity({...idle, activeTool})
    assert.equal(activity[1], 1, activeTool)
    assert.equal(activity[5], 1, activeTool)
  }
  for (const activeTool of ['Bash', 'mcp__web__search', 'thread', 'profile']) {
    assert.equal(neuralActivity({...idle, activeTool})[1], 0, activeTool)
  }
})
test('muted input stays inactive; output and connection state are independently observable', () => {
  assert.equal(neuralActivity({...idle, phase:'listening', level:1})[3], 0)
  assert.equal(neuralActivity({...idle, phase:'listening', muted:false, level:.8})[7], .8)
  assert.equal(neuralActivity({...idle, phase:'speaking', level:NaN})[3], .25)
  assert.deepEqual(neuralActivity({...idle, connected:['local runtime']}), NEURAL_REGIONS.map(() => 0))
})

test('functional brain regions use observed activity and stable centers', () => {
  assert.equal(NEURAL_CENTERS.length, NEURAL_REGIONS.length)
  assert.equal(new Set(NEURAL_REGIONS).size, NEURAL_REGIONS.length)
  const activity = input => Object.fromEntries(NEURAL_REGIONS.map((name, i) => [name, neuralActivity({...idle, ...input})[i]]))
  assert.equal(activity({activeTool:'architect_plan'}).planning, 1)
  assert.equal(activity({phase:'thinking'}).planning, 0)
  assert.equal(activity({activeTool:'sentinel_safety_check'}).protection, 1)
  assert.equal(activity({activeTool:'spatial_presence'}).spatial, 1)
  assert.equal(activity({phase:'boot'}).lifecycle, 1)
  assert.equal(activity({phase:'listening', muted:false}).auditory, .25)
  assert.equal(activity({phase:'listening', muted:false}).voice, 0)
  assert.equal(activity({phase:'speaking'}).auditory, 0)
})
