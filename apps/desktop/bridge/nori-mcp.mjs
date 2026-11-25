/**
 * Nori-owned MCP tool and server definitions.
 *
 * These four preserved bridge adapters (chrome, panels, ui, vision) describe
 * their tools as MCP-shaped objects. That shape is a published protocol
 * convention -- name, description, JSON-Schema input, handler -- not a
 * proprietary capability, and zod already ships the schema conversion, so
 * Nori builds the descriptors itself instead of importing a vendor agent SDK.
 *
 * This module deliberately does NOT talk to any model provider, start a
 * subprocess, or open a network connection. It is a pure descriptor builder:
 * `tool()` freezes one tool contract, `createMcpToolServer()` groups them.
 * Adapters remain excluded from the native build (electron-builder.native.yml)
 * because the native bridge does not instantiate them at all; keeping them
 * dependency-free means that exclusion is a policy choice, not a build
 * accident.
 */
import { z } from 'zod'

const MAX_TOOLS_PER_SERVER = 128
const MAX_NAME_LENGTH = 64
const NAME_PATTERN = /^[a-z][a-z0-9_]*$/
// Bounds. These are sanity limits against a malformed adapter, not product
// policy. The measured maximum across all four preserved adapters is 8141
// characters (`display`, which interpolates the shared DESIGN_SYSTEM block),
// so this ceiling leaves real headroom instead of rejecting working text.
const MAX_DESCRIPTION_LENGTH = 65536
/** An input schema may not be arbitrarily wide or deep. */
const MAX_SCHEMA_PROPERTIES = 256

/**
 * Mark a descriptor as produced by this module's own `tool()`.
 *
 * Provenance matters here: `tool()` freezes the descriptor after validating
 * name, description, schema and handler together. A hand-built object that
 * merely happens to expose a `call` function is not the same thing, and
 * accepting one is how a nameless tool became callable as `undefined`.
 *
 * A private symbol cannot be forged from outside the module without importing
 * it, and it is deliberately not exported.
 */
const NORI_TOOL = Symbol('nori.mcp-tool')

/** Validate a descriptor no matter how it was built. */
function assertValidTool(serverName, entry, position) {
  const where = `${serverName} tool #${position}`
  if (!entry || typeof entry !== 'object') {
    throw new NoriMcpDefinitionError(`${where} is not a tool descriptor`)
  }
  if (typeof entry.name !== 'string' || !NAME_PATTERN.test(entry.name) || entry.name.length > MAX_NAME_LENGTH) {
    throw new NoriMcpDefinitionError(`${where} has an invalid name: ${String(entry.name)}`)
  }
  if (typeof entry.description !== 'string'
      || !entry.description.trim()
      || entry.description.length > MAX_DESCRIPTION_LENGTH) {
    throw new NoriMcpDefinitionError(`tool ${entry.name} needs a 1..${MAX_DESCRIPTION_LENGTH} character description`)
  }
  if (!entry.inputSchema || typeof entry.inputSchema !== 'object' || Array.isArray(entry.inputSchema)
      || entry.inputSchema.type !== 'object') {
    throw new NoriMcpDefinitionError(`tool ${entry.name} needs an object input schema`)
  }
  const properties = entry.inputSchema.properties
  if (properties !== undefined && (typeof properties !== 'object' || properties === null
      || Array.isArray(properties) || Object.keys(properties).length > MAX_SCHEMA_PROPERTIES)) {
    throw new NoriMcpDefinitionError(`tool ${entry.name} has an unusable properties map`)
  }
  if (typeof entry.call !== 'function') {
    throw new NoriMcpDefinitionError(`tool ${entry.name} needs a callable handler`)
  }
  return entry.name
}

/** Raised when an adapter declares a tool or server contract Nori will not honour. */
export class NoriMcpDefinitionError extends Error {
  constructor(message) {
    super(message)
    this.name = 'NoriMcpDefinitionError'
  }
}

/**
 * Convert a zod raw-shape into the JSON Schema MCP clients consume.
 * Wrapping in z.object() is required because MCP input schemas are always
 * objects; a bare shape is what the adapters pass.
 */
function toInputSchema(shape) {
  if (shape === undefined || shape === null) return { type: 'object', properties: {}, required: [] }
  if (typeof shape !== 'object' || Array.isArray(shape)) {
    throw new NoriMcpDefinitionError('tool input schema must be a zod object shape')
  }
  return z.toJSONSchema(z.object(shape), { io: 'input' })
}

/**
 * Freeze one tool contract.
 *
 * The handler is stored, not called: a tool description is data. Validation
 * happens in `callTool` so a server can refuse malformed arguments before
 * the handler sees them.
 *
 * @param {string} name snake_case tool identifier
 * @param {string} description plain-text description shown to a model
 * @param {object} [shape] zod raw shape describing the arguments
 * @param {(args: object) => unknown} handler async implementation
 */
export function tool(name, description, shape, handler) {
  if (typeof name !== 'string' || !NAME_PATTERN.test(name) || name.length > MAX_NAME_LENGTH) {
    throw new NoriMcpDefinitionError(`invalid tool name: ${String(name)}`)
  }
  if (typeof description !== 'string' || !description.trim() || description.length > MAX_DESCRIPTION_LENGTH) {
    throw new NoriMcpDefinitionError(`tool ${name} needs a 1..${MAX_DESCRIPTION_LENGTH} character description`)
  }
  if (typeof handler !== 'function') throw new NoriMcpDefinitionError(`tool ${name} needs a handler function`)
  const inputSchema = toInputSchema(shape)
  const validator = z.object(shape ?? {})
  return Object.freeze({
    name,
    description,
    inputSchema,
    /** Provenance marker: this descriptor passed `tool()`'s own validation. */
    [NORI_TOOL]: true,
    /** Run the tool. Invalid arguments are refused before the handler runs. */
    async call(args) {
      return handler(validator.parse(args ?? {}))
    },
  })
}

/**
 * Group tool contracts into a server descriptor.
 *
 * `alwaysLoad` records that the tools must not be hidden behind tool search;
 * it is preserved so an adapter's intent survives the rewrite. Nothing here
 * resolves or downloads anything.
 *
 * @param {{name: string, version: string, instructions?: string,
 *          alwaysLoad?: boolean, tools: object[]}} definition
 */
export function createMcpToolServer({ name, version, instructions, alwaysLoad, tools }) {
  if (typeof name !== 'string' || !name.trim()) throw new NoriMcpDefinitionError('server needs a name')
  if (typeof version !== 'string' || !version.trim()) throw new NoriMcpDefinitionError('server needs a version')
  if (!Array.isArray(tools) || tools.length === 0) throw new NoriMcpDefinitionError(`${name} declares no tools`)
  if (tools.length > MAX_TOOLS_PER_SERVER) throw new NoriMcpDefinitionError(`${name} declares too many tools`)
  if (instructions !== undefined && typeof instructions !== 'string') {
    throw new NoriMcpDefinitionError(`${name} instructions must be text`)
  }
  // Descriptors built outside `tool()` but that pass every field check. Reported
  // so a caller can see which tools did not come through this module.
  const unprovenanced = []
  const names = new Set()
  tools.forEach((entry, position) => {
    // Full descriptor validation, not just "does it have a call function".
    // A nameless descriptor must never reach the index, or toolNames() returns
    // undefined and callTool(undefined) invokes it.
    const toolName = assertValidTool(name, entry, position)
    if (names.has(toolName)) throw new NoriMcpDefinitionError(`${name} declares ${toolName} twice`)
    names.add(toolName)
    // Prefer module-built provenance. A hand-built descriptor that passes every
    // field check above is still usable, so this is reported rather than fatal.
    if (entry[NORI_TOOL] !== true) unprovenanced.push(`${name}/${toolName}`)
  })
  const index = new Map(tools.map((entry) => [entry.name, entry]))
  return Object.freeze({
    schema: 'nori.mcp-tool-server.v1',
    name,
    version,
    instructions: instructions ?? '',
    alwaysLoad: alwaysLoad === true,
    tools: Object.freeze([...tools]),
    toolNames: () => [...names],
    /** Tools that did not originate from this module's `tool()`. */
    unprovenancedTools: () => [...unprovenanced],
    /**
     * Invoke a named tool. Unknown names, missing names and bad arguments are
     * refused rather than guessed at, so a descriptor bug can never turn into
     * an accidental call of the wrong thing.
     */
    async callTool(toolName, args) {
      if (typeof toolName !== 'string' || !toolName) {
        throw new NoriMcpDefinitionError(`${name} requires a tool name`)
      }
      const entry = index.get(toolName)
      if (!entry) throw new NoriMcpDefinitionError(`${name} has no tool ${toolName}`)
      return entry.call(args)
    },
  })
}