/** Nori-owned symbolic spatial frame for the desktop workspace.
 *
 * Numeric opcodes and typed positional cells keep component-to-component
 * workspace state compact and explicit. This is a symbolic Neuralese frame,
 * not a learned latent vector and not an execution authorization token.
 */
export const SPATIAL_SCHEMA = 'nori.neuralese.spatial-workspace.v1' as const
export const SPATIAL_NODE_OPCODES = Object.freeze({
  core: 0x0101,
  model: 0x0102,
  system: 0x0103,
  surface: 0x0104,
  note: 0x0105,
  project: 0x0106,
  app: 0x0107,
} as const)
export const SPATIAL_EDGE_OPCODES = Object.freeze({
  contains: 0x0201,
  uses: 0x0202,
  opens: 0x0203,
} as const)

export type SpatialNodeKind = keyof typeof SPATIAL_NODE_OPCODES
export type SpatialRelation = keyof typeof SPATIAL_EDGE_OPCODES
export type SpatialRoom = 'CORE' | 'WORK' | 'SYSTEMS' | 'NOTES' | 'MODELS' | 'APPS'
export type SpatialOrigin = 'nori_live' | 'user_local' | 'nori_project' | 'nori_app'
export type SpatialNode = {
  id: string
  kind: SpatialNodeKind
  title: string
  status: string
  room: SpatialRoom
  x: number
  y: number
  z: number
  detail: string
  sourceId?: string
  origin: SpatialOrigin
}
export type SpatialEdge = { from: string; relation: SpatialRelation; to: string }
export type AppSpecField = {
  id: string; name: string; type: 'string' | 'integer' | 'number' | 'boolean' | 'date' | 'enum'
  required: boolean; options: string[] | null; default: string | number | boolean | null
}
export type AppSpecCollection = { id: string; name: string; fields: AppSpecField[] }
export type AppSpecView = { id: string; name: string; type: 'table' | 'form' | 'board' | 'dashboard'; collection_id: string; fields: string[] }
export type AppSpecFrame = {
  schema: 'nori.neuralese.app-spec.v1'; version: 1; opcode: number; spec_id: string; title: string; description: string
  source: { goal_cell: string; goal_sha256: string; provenance: 'untrusted_user_request' }
  data_schema: AppSpecCollection[]; views: AppSpecView[]; workflows: Array<{ id: string; name: string; trigger: string; collection_id: string; steps: Array<{ id: string; action: string; depends_on: string[] }> }>
  capabilities: string[]; unknown_fields: string[]; translation_losses: Array<{ source_pointer: string; target_pointer: string | null; status: string; reason: string }>
  trust_flags: { source_untrusted: true; model_output_untrusted: true; external_effects: false }; execution_authorized: false; frame_sha256: string
}
export type SpatialFrame = {
  schema: typeof SPATIAL_SCHEMA
  encoding: 'symbolic-opcode-slots-v1'
  nodes: Array<[id: string, opcode: number, slots: [title: string, status: string, room: SpatialRoom, x10000: number, y10000: number, z10: number, detail: string, sourceId: string], origin: number]>
  edges: Array<[fromIndex: number, relationOpcode: number, toIndex: number]>
  unresolved_fields: string[]
  translation_losses: string[]
  execution_authorized: false
}

const text = (value: unknown, field: string, max = 4000) => {
  if (typeof value !== 'string' || value.length > max) throw new Error(`Invalid spatial Neuralese cell: ${field}`)
  return value
}

/** Encode objects with a checked registry and no lossy stringification. */
export function encodeSpatialFrame(nodes: SpatialNode[], edges: SpatialEdge[]): SpatialFrame {
  if (!Array.isArray(nodes) || nodes.length > 256 || !Array.isArray(edges) || edges.length > 1024) {
    throw new Error('Spatial Neuralese frame exceeds workspace bounds')
  }
  const indices = new Map<string, number>()
  const encoded = nodes.map((node, index) => {
    if (!node || typeof node !== 'object' || !Object.hasOwn(SPATIAL_NODE_OPCODES, node.kind)) throw new Error('Unknown spatial Neuralese node opcode')
    if (typeof node.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(node.id) || indices.has(node.id)) throw new Error('Invalid or duplicate spatial node id')
    if (!['CORE', 'WORK', 'SYSTEMS', 'NOTES', 'MODELS', 'APPS'].includes(node.room)) throw new Error('Unknown spatial workspace room')
    if (!['nori_live', 'user_local', 'nori_project', 'nori_app'].includes(node.origin)) throw new Error('Unknown spatial node provenance')
    if (![node.x, node.y, node.z].every(Number.isFinite) || node.x < 0 || node.x > 1 || node.y < 0 || node.y > 1 || node.z < -20 || node.z > 20) throw new Error('Invalid spatial node coordinates')
    indices.set(node.id, index)
    return [node.id, SPATIAL_NODE_OPCODES[node.kind], [
      text(node.title, 'title', 120), text(node.status, 'status', 120), node.room,
      Math.round(node.x * 10000), Math.round(node.y * 10000), Math.round(node.z * 10),
      text(node.detail, 'detail'), text(node.sourceId ?? '', 'sourceId', 1024),
    ], node.origin === 'nori_live' ? 1 : node.origin === 'user_local' ? 2 : node.origin === 'nori_project' ? 3 : 4] as SpatialFrame['nodes'][number]
  })
  const relationCodes = SPATIAL_EDGE_OPCODES as Record<SpatialRelation, number>
  const encodedEdges = edges.map((edge) => {
    if (!edge || !(edge.relation in relationCodes)) throw new Error('Unknown spatial Neuralese edge opcode')
    const from = indices.get(edge.from), to = indices.get(edge.to)
    if (from === undefined || to === undefined || from === to) throw new Error('Spatial edge references a missing or identical node')
    return [from, relationCodes[edge.relation], to] as [number, number, number]
  })
  return {
    schema: SPATIAL_SCHEMA,
    encoding: 'symbolic-opcode-slots-v1',
    nodes: encoded,
    edges: encodedEdges,
    unresolved_fields: [],
    translation_losses: [],
    execution_authorized: false,
  }
}

export type SpatialLayout = {
  version: 1
  room: SpatialRoom
  positions: Record<string, { x: number; y: number; z: number }>
  notes: SpatialNode[]
}
export const SPATIAL_LAYOUT_KEY = 'nori.spatialWorkspace.v1'
export const DEFAULT_SPATIAL_LAYOUT: SpatialLayout = { version: 1, room: 'CORE', positions: {}, notes: [] }
const SPATIAL_ROOMS: SpatialRoom[] = ['CORE', 'WORK', 'SYSTEMS', 'NOTES', 'MODELS', 'APPS']

/** Parse bounded local layout state; reject malformed storage instead of guessing. */
export function parseSpatialLayout(raw: string | null): SpatialLayout {
  if (!raw) return { ...DEFAULT_SPATIAL_LAYOUT, positions: {}, notes: [] }
  if (raw.length > 256_000) throw new Error('Saved spatial workspace exceeds the local size limit')
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object') throw new Error('Saved spatial workspace is invalid')
  const layout = value as Partial<SpatialLayout>
  const room = layout.room
  if (Object.keys(layout).sort().join(',') !== 'notes,positions,room,version') throw new Error('Saved spatial workspace contains unmapped fields')
  if (layout.version !== 1 || !room || !SPATIAL_ROOMS.includes(room) ||
      !layout.positions || typeof layout.positions !== 'object' || Array.isArray(layout.positions) ||
      !Array.isArray(layout.notes) || layout.notes.length > 128) throw new Error('Saved spatial workspace schema is unsupported')
  const positions: SpatialLayout['positions'] = {}
  for (const [id, point] of Object.entries(layout.positions)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id) || !point || Object.keys(point).sort().join(',') !== 'x,y,z' || ![point.x, point.y, point.z].every(Number.isFinite) || point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1 || point.z < -20 || point.z > 20) {
      throw new Error('Saved spatial workspace contains an invalid placement')
    }
    positions[id] = { x: point.x, y: point.y, z: point.z }
  }
  const notes = layout.notes.map((node) => {
    const noteKeys = node && typeof node === 'object' ? Object.keys(node).sort().join(',') : ''
    if (noteKeys !== 'detail,id,kind,origin,room,status,title,x,y,z' && noteKeys !== 'detail,id,kind,origin,room,sourceId,status,title,x,y,z') throw new Error('Saved spatial workspace contains unmapped note fields')
    if (!node || node.kind !== 'note' || node.origin !== 'user_local' || node.room !== 'NOTES' ||
        typeof node.id !== 'string' || !/^note:[A-Za-z0-9-]{1,80}$/.test(node.id) ||
        ![node.x, node.y, node.z].every(Number.isFinite) || node.x < 0 || node.x > 1 || node.y < 0 || node.y > 1 || node.z < -20 || node.z > 20) {
      throw new Error('Saved spatial workspace contains a non-local or invalid note')
    }
    return { ...node, title: text(node.title, 'note title', 120), detail: text(node.detail, 'note detail', 4000), status: 'LOCAL NOTE' }
  })
  if (new Set(notes.map((note) => note.id)).size !== notes.length) throw new Error('Saved spatial workspace contains duplicate note identifiers')
  return { version: 1, room, positions, notes }
}
