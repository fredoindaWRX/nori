import { createHash } from 'node:crypto'
import { translateNeuraleseArtCraftActions } from './neuralese-artcraft-plan.mjs'

const PLAN_SCHEMA = 'nori.neuralese.artcraft-plan.v1'
const MAX_PLAN_BYTES = 32_768
const MAX_PLAN_NODES = 8

function exactKeys(value, keys) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function opcode(name) {
  return Number.parseInt(createHash('sha256').update(name, 'utf8').digest('hex').slice(0, 8), 16)
}

/** Repair exact catalog field labels only; never invent tools or causal edges. */
export function repairNeuraleseArtCraftSlotLabels({ output, appId, goal, definitions }) {
  if (typeof output !== 'string' || Buffer.byteLength(output, 'utf8') > MAX_PLAN_BYTES) {
    throw new TypeError('Neuralese slot-label repair requires a bounded plan.')
  }
  let proposal
  try { proposal = JSON.parse(output.trim().replace(/^\uFEFF/, '')) }
  catch { throw new TypeError('Neuralese slot-label repair requires strict JSON.') }
  if (!exactKeys(proposal, ['schema', 'app_id', 'status', 'nodes', 'clarification'])
    || proposal.schema !== PLAN_SCHEMA || proposal.app_id !== appId || proposal.status !== 'complete'
    || proposal.clarification !== null || !Array.isArray(proposal.nodes)
    || proposal.nodes.length < 1 || proposal.nodes.length > MAX_PLAN_NODES
    || !Array.isArray(definitions)) {
    throw new TypeError('Neuralese slot-label repair received a malformed plan.')
  }
  const toolsByOpcode = new Map()
  for (const definition of definitions) {
    const fn = definition?.function
    if (typeof fn?.name !== 'string' || !plainObject(fn.parameters?.properties)) continue
    const code = opcode(fn.name)
    if (toolsByOpcode.has(code)) throw new TypeError('Neuralese slot-label repair found an ambiguous registered opcode.')
    toolsByOpcode.set(code, { name: fn.name, labels: Object.keys(fn.parameters.properties) })
  }
  let repairedCount = 0
  const actions = proposal.nodes.map((node, index) => {
    if (!exactKeys(node, ['id', 'opcode', 'slots', 'depends_on']) || node.id !== `n${index}`
      || !Number.isSafeInteger(node.opcode) || !plainObject(node.slots) || !Array.isArray(node.depends_on)) {
      throw new TypeError('Neuralese slot-label repair received a malformed action node.')
    }
    const expectedDependencies = index ? [`n${index - 1}`] : []
    if (node.depends_on.length !== expectedDependencies.length
      || node.depends_on.some((id, position) => id !== expectedDependencies[position])) {
      throw new TypeError('Neuralese slot-label repair will not alter causal dependencies.')
    }
    const tool = toolsByOpcode.get(node.opcode)
    if (!tool) throw new TypeError('Neuralese slot-label repair cannot invent an app operation.')
    const args = {}
    const seen = new Set()
    for (const [key, value] of Object.entries(node.slots)) {
      let label
      if (/^(0|[1-9][0-9]*)$/.test(key)) label = tool.labels[Number(key)]
      else {
        label = tool.labels.includes(key) ? key : undefined
        if (label) repairedCount++
      }
      if (!label || seen.has(label)) throw new TypeError('Neuralese slot-label repair found an unknown or duplicate slot.')
      seen.add(label)
      args[label] = value
    }
    return { name: tool.name, args }
  })
  if (!repairedCount) throw new TypeError('Neuralese plan has no registered field-label translation error to repair.')
  return translateNeuraleseArtCraftActions({ appId, goal, actions, definitions })
}
