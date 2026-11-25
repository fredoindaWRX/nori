// One agent turn's tool catalog: a compact base set offered on every
// non-trivial turn plus each specialist family the request matched. Being in
// the union grants nothing: every call is routed to the family that defined
// the tool, and that family's own call() keeps its validation, approval and
// receipts exactly as in a single-family turn.

// Base tools in keep-order; when a turn would exceed the catalog limit the
// tail is dropped first. Specialist families are never trimmed.
export const BASE_TOOL_ORDER = Object.freeze(['search_public_web', 'read_public_page', 'search_my_files',
  'read_my_file', 'list_my_folder', 'check_pc', 'list_skill_catalog'])
export const AGENT_MAX_TOOLS = 14
// Tools whose successful result means a file or folder was actually opened,
// listed or written; only these back a reply's file-work claims.
export const FILE_TOOL_NAMES = Object.freeze(new Set(['list_my_folder', 'search_my_files', 'read_my_file',
  'list_dir', 'read_file', 'create_document', 'save_edited_copy',
  'code_list', 'code_search', 'code_read', 'code_edit', 'code_write']))
// Owner's personal files. After one of these returns content in a turn, the
// public search tools are withdrawn so private text never becomes a web query.
export const PERSONAL_FILE_TOOL_NAMES = Object.freeze(new Set(['list_my_folder', 'search_my_files', 'read_my_file']))
export const PUBLIC_SEARCH_TOOL_NAMES = Object.freeze(new Set(['search_public_web']))

const nameOf = tool => tool?.function?.name

/**
 * families: [{ key, tools, names?, base? }] in specificity order (earlier wins
 * a duplicate name). `names` limits a family to a subset of its definitions.
 * Definitions are recomputed on every read because some families (research)
 * expose state-dependent tools.
 */
export function composeToolUnion(families, { maxTools = AGENT_MAX_TOOLS } = {}) {
  const members = families.filter(family => family?.tools && typeof family.tools.call === 'function')
  let closed = false, closing = null
  const specialists = members.filter(family => !family.base)
  const bases = members.filter(family => family.base)
  const allowed = (family, tool) => typeof nameOf(tool) === 'string' && (!family.names || family.names.includes(nameOf(tool)))
  function catalog() {
    const owners = new Map()
    if (closed) return owners
    for (const family of specialists) {
      for (const tool of family.tools.definitions || []) {
        if (allowed(family, tool) && !owners.has(nameOf(tool))) owners.set(nameOf(tool), { family, tool })
      }
    }
    let room = Math.max(0, maxTools - owners.size)
    for (const name of BASE_TOOL_ORDER) {
      if (room <= 0 || owners.has(name)) continue
      for (const family of bases) {
        const tool = (family.tools.definitions || []).find(item => nameOf(item) === name)
        if (tool && allowed(family, tool)) { owners.set(name, { family, tool }); room--; break }
      }
    }
    return owners
  }
  const family = key => members.find(member => member.key === key)?.tools ?? null
  return {
    union: true,
    get definitions() { return [...catalog().values()].map(owner => owner.tool) },
    specialistKeys: specialists.map(member => member.key),
    family,
    specialist: key => specialists.find(member => member.key === key)?.tools ?? null,
    ownerOf: name => catalog().get(name)?.family.key ?? null,
    async call(name, args, options) {
      const owner = catalog().get(name)
      if (!owner) throw new Error('That tool is not in this turn\'s catalog; nothing ran.')
      return owner.family.tools.call(name, args, options)
    },
    close() {
      if (closing) return closing
      closed = true
      closing = (async () => {
        const errors = []
        for (const tools of new Set(members.map(member => member.tools))) {
          if (typeof tools.close !== 'function') continue
          try { await tools.close() } catch (error) { errors.push(error) }
        }
        if (errors.length) throw new AggregateError(errors, 'One or more tool families could not close.')
      })()
      return closing
    },
  }
}

const TYPE_CHECK = {
  string: value => typeof value === 'string',
  integer: value => Number.isSafeInteger(value),
  number: value => typeof value === 'number' && Number.isFinite(value),
  boolean: value => typeof value === 'boolean',
  array: value => Array.isArray(value),
  object: value => Boolean(value) && typeof value === 'object' && !Array.isArray(value),
}

function schemaProblem(schema, value, label) {
  if (!schema || typeof schema !== 'object') return null
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) return `${label} must be one of: ${schema.enum.slice(0, 12).join(', ')}`
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : []
  if (types.length && !types.some(type => TYPE_CHECK[type]?.(value))) return `${label} must be ${types.join(' or ')}`
  if (typeof value === 'string') {
    if (Number.isSafeInteger(schema.maxLength) && value.length > schema.maxLength) return `${label} is longer than ${schema.maxLength} characters`
    if (Number.isSafeInteger(schema.minLength) && value.length < schema.minLength) return `${label} is shorter than ${schema.minLength} characters`
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return `${label} is below ${schema.minimum}`
    if (typeof schema.maximum === 'number' && value > schema.maximum) return `${label} is above ${schema.maximum}`
  }
  if (Array.isArray(value)) {
    if (Number.isSafeInteger(schema.maxItems) && value.length > schema.maxItems) return `${label} has more than ${schema.maxItems} items`
    if (Number.isSafeInteger(schema.minItems) && value.length < schema.minItems) return `${label} has fewer than ${schema.minItems} items`
    for (const item of value) { const problem = schemaProblem(schema.items, item, `${label} item`); if (problem) return problem }
  }
  return null
}

/** Host-side check of model arguments against the offered schema; returns a short problem or null. */
export function toolArgsProblem(definition, args) {
  const parameters = definition?.function?.parameters || {}
  if (!TYPE_CHECK.object(args)) return 'arguments must be one JSON object'
  const properties = parameters.properties || {}
  for (const field of Array.isArray(parameters.required) ? parameters.required : []) {
    if (!Object.hasOwn(args, field)) return `missing required field "${field}"`
  }
  for (const [field, value] of Object.entries(args)) {
    if (!Object.hasOwn(properties, field)) {
      if (parameters.additionalProperties === false) return `unknown field "${String(field).slice(0, 40)}"`
      continue
    }
    const problem = schemaProblem(properties[field], value, `"${field}"`)
    if (problem) return problem
  }
  return null
}

function parsedValue(raw) {
  const value = raw.trim()
  if (/^-?\d{1,15}(?:\.\d+)?$/.test(value)) return Number(value)
  if (value === 'true' || value === 'false') return value === 'true'
  if (/^[[{]/.test(value)) { try { return JSON.parse(value) } catch {} }
  return value
}

/**
 * A tool call the model wrote as text instead of the API's tool_calls field:
 * Qwen XML (<tool_call><function=name><parameter=k>v</parameter>…), Hermes
 * JSON inside <tool_call>, or a whole reply that is one {"name","arguments"}
 * object. Recovered only for an offered name; the caller still validates the
 * arguments against the offered schema before anything runs.
 */
export function textualToolCall(text, offeredTools) {
  const source = String(text ?? '')
  if (source.length > 65536) return null
  const offered = name => offeredTools?.some(tool => nameOf(tool) === name)
  const xml = /<tool_call>\s*<function=([A-Za-z0-9_]{1,64})>([\s\S]{0,40000}?)<\/function>/i.exec(source)
  if (xml) {
    if (!offered(xml[1])) return null
    const args = {}
    for (const [, key, raw] of xml[2].matchAll(/<parameter=([A-Za-z0-9_]{1,64})>([\s\S]{0,32768}?)<\/parameter>/gi)) args[key] = parsedValue(raw)
    return { name: xml[1], args }
  }
  const tagged = /<tool_call>\s*(\{[\s\S]{0,40000}\})\s*<\/tool_call>/i.exec(source)?.[1]
  const bare = source.trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, '$1')
  for (const candidate of [tagged, /^\{[\s\S]*\}$/.test(bare) ? bare : null]) {
    if (!candidate) continue
    let value
    try { value = JSON.parse(candidate) } catch { continue }
    const name = value?.name ?? value?.function?.name
    let args = value?.arguments ?? value?.parameters ?? value?.function?.arguments ?? {}
    if (typeof args === 'string') { try { args = JSON.parse(args) } catch { return null } }
    if (typeof name === 'string' && offered(name) && TYPE_CHECK.object(args)) return { name, args }
  }
  return null
}
