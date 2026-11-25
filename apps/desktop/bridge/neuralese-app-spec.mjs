import { createHash } from 'node:crypto'

export const NEURALESE_APP_SPEC_SCHEMA = 'nori.neuralese.app-spec.v1'
export const NEURALESE_APP_SPEC_OPCODE = 0x0301
const MAX_FRAME_BYTES = 256 * 1024
const ID = /^[a-z][a-z0-9_-]{0,63}$/
const DIGEST = /^[a-f0-9]{64}$/
const FIELD_TYPES = new Set(['string', 'integer', 'number', 'boolean', 'date', 'enum'])
const VIEW_TYPES = new Set(['table', 'form', 'board', 'dashboard'])
const WORKFLOW_TRIGGERS = new Set(['manual', 'record_created', 'record_updated', 'record_deleted'])
const WORKFLOW_ACTIONS = new Set(['local_data.create', 'local_data.update', 'local_data.delete', 'nori.assistant.query'])
const CAPABILITIES = new Set(['local_data.read', 'local_data.create', 'local_data.update', 'local_data.delete', 'nori.assistant.query'])
const TOP_FIELDS = ['capabilities', 'data_schema', 'description', 'execution_authorized', 'frame_sha256',
  'opcode', 'schema', 'source', 'spec_id', 'translation_losses', 'trust_flags', 'unknown_fields', 'version',
  'views', 'workflows', 'title']

function assertUnicode(value) {
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('App Neuralese strings must be valid Unicode.')
      i++
    } else if (unit >= 0xdc00 && unit <= 0xdfff) throw new TypeError('App Neuralese strings must be valid Unicode.')
  }
}

function compareUnicode(left, right) {
  const a = [...left].map(char => char.codePointAt(0))
  const b = [...right].map(char => char.codePointAt(0))
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]
  return a.length - b.length
}

function canonical(value) {
  if (typeof value === 'string') { assertUnicode(value); return JSON.stringify(value) }
  if (value === null || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('App Neuralese values must be finite JSON numbers.')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError('App Neuralese accepts plain JSON objects only.')
  }
  const keys = Object.keys(value)
  for (const key of keys) assertUnicode(key)
  return `{${keys.sort(compareUnicode).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

const digest = value => createHash('sha256').update(canonical(value), 'utf8').digest('hex')
const text = (value, field, max) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new TypeError(`Invalid app Neuralese cell: ${field}`)
  assertUnicode(value)
  return value
}
const exactKeys = (value, expected, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort(compareUnicode).join(',') !== [...expected].sort(compareUnicode).join(',')) {
    throw new TypeError(`${label} has missing or unmapped fields.`)
  }
}
const unique = (values, label) => {
  if (new Set(values).size !== values.length) throw new TypeError(`Duplicate ${label}.`)
}
const boundedArray = (value, max, label) => {
  if (!Array.isArray(value) || value.length > max) throw new RangeError(`${label} exceeds its app Neuralese bounds.`)
}
const validId = (value, label) => {
  if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`Invalid ${label} identifier.`)
  return value
}

function validateField(field) {
  exactKeys(field, ['id', 'name', 'type', 'required', 'options', 'default'], 'Field')
  validId(field.id, 'field')
  text(field.name, 'field.name', 80)
  if (!FIELD_TYPES.has(field.type) || typeof field.required !== 'boolean') throw new TypeError('Invalid field type or required flag.')
  if (field.type === 'enum') {
    boundedArray(field.options, 64, 'Enum options')
    if (!field.options.length) throw new TypeError('Enum fields require at least one option.')
    field.options.forEach(option => text(option, 'field.options[]', 120))
    unique(field.options, 'enum option')
  } else if (field.options !== null) throw new TypeError('Only enum fields may carry options.')
  if (field.default !== null) {
    const valid = field.type === 'string' || field.type === 'date' ? typeof field.default === 'string'
      : field.type === 'integer' ? Number.isSafeInteger(field.default)
        : field.type === 'number' ? typeof field.default === 'number' && Number.isFinite(field.default)
          : field.type === 'boolean' ? typeof field.default === 'boolean'
            : field.type === 'enum' ? field.options.includes(field.default) : false
    if (!valid) throw new TypeError(`Default value does not match field ${field.id}.`)
  }
  if (field.required && field.default === null && field.type === 'enum' && field.options.length === 1) {
    // A single-option enum is valid; requiredness does not authorize a runtime action.
  }
}

function validateDataSchema(collections) {
  boundedArray(collections, 64, 'Collections')
  const collectionIds = new Set()
  const fieldIndex = new Map()
  for (const collection of collections) {
    exactKeys(collection, ['id', 'name', 'fields'], 'Collection')
    validId(collection.id, 'collection')
    if (collectionIds.has(collection.id)) throw new TypeError(`Duplicate collection ${collection.id}.`)
    collectionIds.add(collection.id)
    text(collection.name, 'collection.name', 100)
    boundedArray(collection.fields, 128, 'Fields')
    const ids = collection.fields.map(field => field?.id)
    ids.forEach(id => validId(id, 'field'))
    unique(ids, `field in ${collection.id}`)
    for (const field of collection.fields) {
      validateField(field)
      fieldIndex.set(`${collection.id}.${field.id}`, true)
    }
  }
  return { collectionIds, fieldIndex }
}

function validateViews(views, collectionIds, fieldIndex) {
  boundedArray(views, 64, 'Views')
  const ids = []
  for (const view of views) {
    exactKeys(view, ['id', 'name', 'type', 'collection_id', 'fields'], 'View')
    validId(view.id, 'view')
    ids.push(view.id)
    text(view.name, 'view.name', 100)
    if (!VIEW_TYPES.has(view.type) || !collectionIds.has(view.collection_id)) throw new TypeError(`View ${view.id} references an unsupported type or collection.`)
    boundedArray(view.fields, 128, 'View fields')
    unique(view.fields, `view field in ${view.id}`)
    for (const fieldId of view.fields) {
      validId(fieldId, 'view field')
      if (!fieldIndex.has(`${view.collection_id}.${fieldId}`)) throw new TypeError(`View ${view.id} references a missing field.`)
    }
  }
  unique(ids, 'view')
}

function validateWorkflows(workflows, collectionIds, fieldIndex, capabilities) {
  boundedArray(workflows, 64, 'Workflows')
  const ids = []
  for (const workflow of workflows) {
    exactKeys(workflow, ['id', 'name', 'trigger', 'collection_id', 'steps'], 'Workflow')
    validId(workflow.id, 'workflow')
    ids.push(workflow.id)
    text(workflow.name, 'workflow.name', 100)
    if (!WORKFLOW_TRIGGERS.has(workflow.trigger) || !collectionIds.has(workflow.collection_id)) throw new TypeError(`Workflow ${workflow.id} has an unsupported trigger or collection.`)
    boundedArray(workflow.steps, 64, 'Workflow steps')
    const earlier = new Set()
    for (const step of workflow.steps) {
      exactKeys(step, ['id', 'action', 'depends_on'], 'Workflow step')
      validId(step.id, 'workflow step')
      if (earlier.has(step.id)) throw new TypeError(`Duplicate workflow step ${step.id}.`)
      if (!WORKFLOW_ACTIONS.has(step.action)) throw new TypeError(`Unsupported workflow action ${step.action}.`)
      const requiredCapability = step.action === 'nori.assistant.query' ? 'nori.assistant.query' : step.action
      if (!capabilities.includes(requiredCapability)) throw new TypeError(`Workflow ${workflow.id} uses undeclared capability ${requiredCapability}.`)
      boundedArray(step.depends_on, 64, 'Workflow dependencies')
      unique(step.depends_on, `dependency in ${step.id}`)
      for (const dependency of step.depends_on) {
        if (!earlier.has(dependency)) throw new TypeError(`Workflow ${workflow.id} has a missing, forward, or reversed dependency edge.`)
      }
      if (step.action !== 'nori.assistant.query' && !fieldIndex.size) throw new TypeError(`Workflow ${workflow.id} requires a data schema.`)
      earlier.add(step.id)
    }
  }
  unique(ids, 'workflow')
}

function validateBody(body, expectedGoal = undefined) {
  exactKeys(body, TOP_FIELDS.filter(field => field !== 'frame_sha256'), 'App Neuralese frame')
  if (body.schema !== NEURALESE_APP_SPEC_SCHEMA || body.version !== 1 || body.opcode !== NEURALESE_APP_SPEC_OPCODE) {
    throw new TypeError('Unsupported app Neuralese schema or opcode.')
  }
  validId(body.spec_id, 'app spec')
  text(body.title, 'title', 120)
  text(body.description, 'description', 2000)
  exactKeys(body.source, ['goal_cell', 'goal_sha256', 'provenance'], 'Source payload')
  text(body.source.goal_cell, 'source.goal_cell', 20000)
  if (body.source.provenance !== 'untrusted_user_request' || body.source.goal_sha256 !== digest(body.source.goal_cell)) {
    throw new TypeError('App source provenance or goal digest is invalid.')
  }
  if (expectedGoal !== undefined && body.source.goal_cell !== expectedGoal) throw new TypeError('App source goal differs from the active user request.')

  const { collectionIds, fieldIndex } = validateDataSchema(body.data_schema)
  validateViews(body.views, collectionIds, fieldIndex)
  boundedArray(body.capabilities, 16, 'Capabilities')
  unique(body.capabilities, 'capability')
  for (const capability of body.capabilities) {
    if (!CAPABILITIES.has(capability)) throw new TypeError(`Unsupported Nori app capability: ${String(capability)}.`)
  }
  validateWorkflows(body.workflows, collectionIds, fieldIndex, body.capabilities)
  boundedArray(body.unknown_fields, 128, 'Unknown fields')
  for (const pointer of body.unknown_fields) text(pointer, 'unknown_fields[]', 512)
  unique(body.unknown_fields, 'unknown field pointer')
  boundedArray(body.translation_losses, 128, 'Translation losses')
  for (const loss of body.translation_losses) {
    exactKeys(loss, ['source_pointer', 'target_pointer', 'status', 'reason'], 'Translation loss')
    text(loss.source_pointer, 'translation_loss.source_pointer', 512)
    if (loss.target_pointer !== null) text(loss.target_pointer, 'translation_loss.target_pointer', 512)
    if (!['exact', 'normalized', 'unmapped', 'ambiguous', 'rejected'].includes(loss.status)) throw new TypeError('Unsupported translation-loss status.')
    text(loss.reason, 'translation_loss.reason', 500)
  }
  exactKeys(body.trust_flags, ['source_untrusted', 'model_output_untrusted', 'external_effects'], 'Trust flags')
  if (body.trust_flags.source_untrusted !== true || body.trust_flags.model_output_untrusted !== true
    || body.trust_flags.external_effects !== false || body.execution_authorized !== false) {
    throw new TypeError('App proposals must remain untrusted, local-only, and unauthorized.')
  }
}

/**
 * Seal a proposed app as a symbolic Neuralese frame. This is a typed proposal
 * only: it does not write files, run code, connect to services, or authorize
 * the listed capabilities.
 */
export function encodeNeuraleseAppSpec(proposal) {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) throw new TypeError('App proposal must be a plain object.')
  exactKeys(proposal, ['spec_id', 'title', 'description', 'source', 'data_schema', 'views', 'workflows',
    'capabilities', 'unknown_fields', 'translation_losses'], 'App proposal')
  exactKeys(proposal.source, ['goal_cell'], 'App source')
  const sourceGoal = text(proposal.source?.goal_cell, 'source.goal_cell', 20000)
  const unsigned = {
    schema: NEURALESE_APP_SPEC_SCHEMA,
    version: 1,
    opcode: NEURALESE_APP_SPEC_OPCODE,
    spec_id: proposal.spec_id,
    title: proposal.title,
    description: proposal.description,
    source: { goal_cell: sourceGoal, goal_sha256: digest(sourceGoal), provenance: 'untrusted_user_request' },
    data_schema: proposal.data_schema,
    views: proposal.views,
    workflows: proposal.workflows,
    capabilities: proposal.capabilities,
    unknown_fields: proposal.unknown_fields,
    translation_losses: proposal.translation_losses,
    trust_flags: { source_untrusted: true, model_output_untrusted: true, external_effects: false },
    execution_authorized: false,
  }
  validateBody(unsigned)
  const frame = { ...unsigned, frame_sha256: digest(unsigned) }
  if (Buffer.byteLength(canonical(frame), 'utf8') > MAX_FRAME_BYTES) throw new RangeError('App Neuralese frame exceeds its size limit.')
  return frame
}

/** Verify integrity and return a deterministic qualification report. */
export function verifyNeuraleseAppSpec(frame, { expectedGoal } = {}) {
  if (!frame || typeof frame !== 'object' || Array.isArray(frame) || Object.keys(frame).sort(compareUnicode).join(',') !== [...TOP_FIELDS].sort(compareUnicode).join(',')) {
    throw new TypeError('App Neuralese frame has missing or unmapped fields.')
  }
  const { frame_sha256: checksum, ...unsigned } = frame
  if (typeof checksum !== 'string' || !DIGEST.test(checksum) || digest(unsigned) !== checksum) throw new Error('App Neuralese frame integrity check failed.')
  if (Buffer.byteLength(canonical(frame), 'utf8') > MAX_FRAME_BYTES) throw new RangeError('App Neuralese frame exceeds its size limit.')
  validateBody(unsigned, expectedGoal)
  // A feature the owner asked for that local record apps cannot provide is a
  // declared exclusion: it is listed to the owner, and it does not leave any
  // part of the specified app unresolved.
  const declaredExclusion = loss => loss.status === 'unmapped' && loss.target_pointer === null
    && /^\/unsupported_features\/\d+$/.test(loss.source_pointer)
  const unresolved = [...frame.unknown_fields, ...frame.translation_losses
    .filter(loss => ['unmapped', 'ambiguous', 'rejected'].includes(loss.status) && !declaredExclusion(loss))
    .map(loss => loss.source_pointer)]
  const findings = [...new Set(unresolved)].sort(compareUnicode).map(pointer => ({
    code: frame.unknown_fields.includes(pointer) ? 'unmapped_source_field' : 'translation_loss',
    pointer,
    severity: 'incomplete',
  }))
  return {
    schema: 'nori.neuralese.app-spec-validation.v1',
    spec_id: frame.spec_id,
    frame_sha256: checksum,
    status: findings.length ? 'incomplete' : 'ready_for_local_preview',
    findings,
    execution_authorized: false,
    external_effects: false,
    materialized: false,
  }
}
