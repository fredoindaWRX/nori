import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import path from 'node:path'
import { installationPaths } from './installation-paths.mjs'
import { artcraftMcpLaunchConfig } from './artcraft-mcp-launch.mjs'

const PROTOCOL = '2025-06-18'
const MAX_FRAME_BYTES = 4 * 1024 * 1024
const MAX_TOOLS = 512
const MAX_RESULT_BYTES = 8192
const ALL_APP_IDS = Object.freeze(['photocraft', 'vectorcraft', 'filmcraft', 'lightcraft', 'pdfcraft', 'effectcraft',
  'designcraft', 'figcraft', 'wordcraft', 'soundcraft', 'deckcraft', 'cadcraft', 'gridcraft'])
const DECKCRAFT_TOOL_DESCRIPTIONS = Object.freeze({
  new_presentation: 'Start a blank presentation with an optional theme.',
  add_slide: 'Add a slide with an optional layout, title, and body.',
  add_shape: 'Add a preset shape with size, position, fill, and optional text.',
  add_text_box: 'Add a text box with position, size, and content.',
  save_presentation: 'Save the active presentation in Nori’s output folder.',
  inspect_document: 'Inspect the open presentation, slides, theme, and selection.',
  export: 'Export the presentation to a supported file format.',
  open_presentation: 'Open a presentation from Nori’s input folder.',
})
const SCOPED_APPS = new Set(ALL_APP_IDS)
const EFFECT_TOOL_DESCRIPTIONS = Object.freeze({
  open_project: 'New/open project.', get_project: 'Inspect project.',
  save_project: 'Save local output.', execute_command: 'Run listed edit.',
  render_preview: 'Render at time.', list_commands: 'List commands.',
})
const CAD_SAFE_COMMANDS = Object.freeze(['line', 'pline', 'circle', 'arc', 'rectang', 'polygon', 'ellipse', 'text', 'mtext',
  'move', 'copy', 'rotate', 'scale', 'mirror', 'offset', 'trim', 'extend', 'fillet', 'chamfer'])
// CADCraft v0.7.0: crates/engine/src/cmd/{draw,draw2,modify}.rs.
// Keep the existing command authority; unknown JSON keys are never forwarded.
const CAD_COMMAND_PARAMS = Object.freeze({
  line: ['points', 'closed'], pline: ['vertices', 'points', 'closed', 'width'],
  circle: ['center', 'radius', 'diameter', 'p1', 'p2', 'p3'], arc: ['p1', 'p2', 'p3', 'center', 'radius', 'start', 'end'],
  rectang: ['p1', 'p2', 'dimensions', 'area', 'length', 'breadth', 'rotation', 'fillet', 'chamfer', 'width', 'elevation', 'thickness'],
  polygon: ['sides', 'center', 'radius', 'inscribed', 'angle', 'edge'], ellipse: ['center', 'major', 'ratio', 'start', 'end', 'isocircle'],
  text: ['at', 'text', 'height', 'rotation', 'justify'],
  mtext: ['at', 'text', 'height', 'width', 'attach', 'justify', 'rotation', 'style', 'lineSpacing', 'lineSpacingExact', 'list', 'indent', 'firstIndent', 'rightIndent', 'tabs', 'align', 'columns'],
  move: ['handles', 'from', 'to', 'delta'], copy: ['handles', 'from', 'to', 'delta', 'count'],
  rotate: ['handles', 'base', 'angle', 'copy'], scale: ['handles', 'base', 'factor', 'copy'], mirror: ['handles', 'p1', 'p2', 'erase'],
  offset: ['handle', 'distance', 'side', 'erase', 'layer'],
  trim: ['handle', 'pick', 'fence', 'crossing', 'edges', 'edgeMode', 'mode'], extend: ['handle', 'pick', 'fence', 'crossing', 'edges', 'edgeMode'],
  fillet: ['h1', 'p1', 'h2', 'p2', 'radius', 'trim', 'handle', 'polyline'],
  chamfer: ['h1', 'p1', 'h2', 'p2', 'd1', 'd2', 'length', 'angle', 'trim', 'handle', 'polyline'],
})
const CAD_POINT_SCHEMA = Object.freeze({ type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 })
const CAD_EXECUTE_DESCRIPTION = 'rectang: p1,p2=[x,y]. line: points=[[x,y],...]. circle: center=[x,y],radius=n. No extra keys.'
const CAD_TOOL_DESCRIPTIONS = Object.freeze({ execute: CAD_EXECUTE_DESCRIPTION,
  new_drawing: 'New drawing; metric=true means mm.', inspect_drawing: 'Inspect drawing geometry.',
  query_entities: 'Query entities and handles.', render: 'Render drawing to PNG.',
  save: 'Save DXF/DWG; SVG/PNG/PDF exports.', open: 'Open local DXF.' })

export function validateNoriCadCraftCommand(args) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  if (!object(args) || Object.keys(args).some(key => !['command', 'params'].includes(key))
    || !CAD_SAFE_COMMANDS.includes(args.command)) {
    throw new Error('CADCraft command is outside Nori’s restricted drawing command set.')
  }
  const { command, params } = args
  const allowed = CAD_COMMAND_PARAMS[command]
  if (!object(params) || Object.keys(params).some(key => !allowed.includes(key))) {
    throw new Error(`CADCraft ${command} accepts only parameters: ${allowed.join(', ')}. Coordinates use [x,y] arrays, not x/y objects.`)
  }
  // Rectangle validation covers the native variants, not one user fixture.
  // Other commands retain native geometric validation after this key allowlist.
  if (command !== 'rectang') return
  const pair = value => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
  const requirePair = key => {
    if (!pair(params[key])) throw new Error(`CADCraft rectang requires ${key} as a finite [x,y] array.`)
  }
  requirePair('p1')
  if (Object.hasOwn(params, 'p2')) requirePair('p2')
  for (const key of ['rotation', 'fillet', 'width', 'elevation', 'thickness', 'area', 'length', 'breadth']) {
    if (Object.hasOwn(params, key) && (!Number.isFinite(params[key])
      || (['fillet', 'width'].includes(key) && params[key] < 0)
      || (['area', 'length', 'breadth'].includes(key) && params[key] <= 0))) {
      throw new Error(`CADCraft rectang parameter ${key} has an invalid numeric value.`)
    }
  }
  if (Object.hasOwn(params, 'chamfer') && (!pair(params.chamfer) || params.chamfer.some(value => value < 0))) {
    throw new Error('CADCraft rectang chamfer requires two finite, nonnegative distances.')
  }
  let width, height
  if (Object.hasOwn(params, 'dimensions')) {
    if (!pair(params.dimensions)) throw new Error('CADCraft rectang dimensions requires [length,width].')
    ;[width, height] = params.dimensions
  } else if (Object.hasOwn(params, 'area')) {
    if (!Object.hasOwn(params, 'length') && !Object.hasOwn(params, 'breadth')) {
      throw new Error('CADCraft rectang area requires a positive length or breadth.')
    }
    width = params.length ?? params.area / params.breadth
    height = params.area / width
  } else {
    requirePair('p2')
    const rotation = (params.rotation ?? 0) * Math.PI / 180
    const dx = params.p2[0] - params.p1[0], dy = params.p2[1] - params.p1[1]
    width = dx * Math.cos(rotation) + dy * Math.sin(rotation)
    height = dy * Math.cos(rotation) - dx * Math.sin(rotation)
  }
  if (![width, height].every(value => Number.isFinite(value) && Math.abs(value) >= 1e-12)) {
    throw new Error('CADCraft rectang coordinates must define a finite, nonzero-area rectangle.')
  }
}
const EFFECT_SAFE_COMMAND_PARAMS = Object.freeze({
  'comp.new': Object.freeze(['name', 'width', 'height', 'frameRate', 'duration', 'background', 'renderer']),
  'layer.newText': Object.freeze(['text', 'name', 'position', 'box', 'vertical', 'size', 'font', 'fill']),
  'shape.newShape': Object.freeze(['layer', 'kind', 'size', 'position', 'space', 'name', 'fill', 'stroke', 'strokeWidth']),
})
const EFFECT_SAFE_PARAM_SCHEMA = Object.freeze({
  name: { type: 'string' }, width: { type: 'number' }, height: { type: 'number' }, frameRate: { type: 'number' }, duration: { type: 'number' },
  background: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }] },
  renderer: { type: 'string', enum: ['classic3D', 'advanced3D'] }, text: { type: 'string' },
  position: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 3 }, box: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
  vertical: { type: 'boolean' }, size: { anyOf: [{ type: 'number' }, { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }] },
  font: { type: 'string' }, fill: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }] },
  stroke: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 }] },
  layer: { type: 'string' }, kind: { type: 'string', enum: ['rect', 'rounded', 'ellipse', 'polygon', 'star'] },
  space: { type: 'string', enum: ['comp', 'layer'] }, strokeWidth: { type: 'number' },
  path: { type: 'string', enum: ['transform/position'] }, time: { type: 'number', minimum: 0, maximum: 3600 },
  value: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 3 },
})
export function validateNoriEffectCraftCommand(args, { positionKeys = false } = {}) {
  const commands = positionKeys ? { ...EFFECT_SAFE_COMMAND_PARAMS, 'prop.addKey': ['layer', 'path', 'time', 'value'] } : EFFECT_SAFE_COMMAND_PARAMS
  if (!args || Object.keys(args).some(key => !['command', 'params'].includes(key)) || !Object.hasOwn(commands, args.command)) {
    throw new Error('EffectCraft command is outside Nori’s creation-safe command set.')
  }
  const params = args.params === undefined ? {} : args.params
  if (!params || typeof params !== 'object' || Array.isArray(params)
    || Object.keys(params).some(key => !commands[args.command].includes(key))) {
    throw new Error(`EffectCraft ${args.command} accepts only parameters: ${commands[args.command].join(', ')}.`)
  }
  if (args.command === 'prop.addKey' && (params.path !== 'transform/position'
    || !Number.isFinite(params.time) || params.time < 0 || params.time > 3600
    || !Array.isArray(params.value) || params.value.length < 2 || params.value.length > 3
    || params.value.some(value => !Number.isFinite(value)))) {
    throw new Error('EffectCraft position keyframes require a bounded time and finite coordinate array.')
  }
}
export function effectCraftCreatedLayer(result) {
  if (result?.isError) throw new Error('EffectCraft did not create a layer; the animation is incomplete.')
  const text = result?.content?.find(item => item?.type === 'text')?.text
  if (typeof text !== 'string') throw new Error('EffectCraft did not return a created layer handle; the animation is incomplete.')
  let payload
  try { payload = JSON.parse(text) } catch { throw new Error('EffectCraft returned an invalid created layer handle; the animation is incomplete.') }
  if (!Number.isSafeInteger(payload?.layer) || payload.layer < 1) {
    throw new Error('EffectCraft did not return a valid created layer handle; the animation is incomplete.')
  }
  return payload.layer
}
export function validateNoriMotionSpec(args) {
  const width=args.width??320,height=args.height??240,frameRate=args.frameRate??24
  const pair=value=>Array.isArray(value)&&value.length===2&&value.every(n=>Number.isFinite(n)&&Math.abs(n)<=4096)
  if (Object.keys(args).some(key=>!['duration','kind','size','fill','direction','path','width','height','frameRate'].includes(key))
    || !Number.isFinite(args.duration)||args.duration<0.1||args.duration>30
    || !['ellipse','rect','rounded','polygon','star'].includes(args.kind)
    || !pair(args.size)||args.size.some(n=>n<=0)||!['left-to-right','right-to-left','top-to-bottom','bottom-to-top'].includes(args.direction)
    || !/^#[0-9a-f]{6}$/i.test(args.fill)
    || !Number.isInteger(width)||width<64||width>1280||!Number.isInteger(height)||height<64||height>1280
    || !Number.isInteger(frameRate)||frameRate<1||frameRate>60) throw new Error('Animation requires a bounded shape, hex fill, duration, canvas and registered motion direction.')
  if(args.size[0]+2>=width||args.size[1]+2>=height) throw new Error('Animation shape must fit fully inside the canvas with room to move.')
  const horizontal=args.direction==='left-to-right'||args.direction==='right-to-left'
  const start=horizontal?[args.size[0]/2+1,height/2]:[width/2,args.size[1]/2+1]
  const end=horizontal?[width-args.size[0]/2-1,height/2]:[width/2,height-args.size[1]/2-1]
  if(args.direction==='right-to-left'||args.direction==='bottom-to-top') return {width,height,frameRate,start:end,end:start}
  return {width,height,frameRate,start,end}
}
export function validateNoriPresentationSpec(args) {
  if (Object.keys(args).some(key=>!['slides','path'].includes(key)) || !Array.isArray(args.slides)
    || args.slides.length<1||args.slides.length>10||args.slides.some(slide=>!slide||typeof slide!=='object'||Array.isArray(slide)
      ||Object.keys(slide).some(key=>!['title','body'].includes(key))||typeof slide.title!=='string'||!slide.title.trim()||slide.title.length>200
      ||typeof slide.body!=='string'||slide.body.length>2000)) throw new Error('A text presentation needs 1–10 slides with bounded title and body strings.')
}
const DESIGN_SAFE_COMMAND_PARAMS = Object.freeze({
  'frame.create': Object.freeze(['spread', 'rect', 'shape', 'content', 'sides', 'text', 'caret', 'vertical']),
})
const FILM_COMMAND_PARAMS = Object.freeze({
  'file.newProject': ['name'],
  'file.newSequence': ['name', 'width', 'height', 'fps', 'sampleRate', 'video', 'audio', 'mix', 'trackType'],
  'file.saveAs': ['path'],
  'file.saveCopy': ['path'],
  'file.newBin': ['name', 'parent'],
  'file.newAdjustmentLayer': ['seconds'],
  'file.newBarsAndTone': ['seconds'],
  'file.newBlackVideo': ['seconds'],
  'file.newColorMatte': ['color', 'seconds'],
  'file.newTransparentVideo': [],
  'edit.pasteMedia': ['paths', 'insert', 'place', 'bin'],
})
const FILE_PATHS = Object.freeze({
  photocraft: Object.freeze({ doc_open: { path: 'inputs' }, doc_save: { path: 'outputs' } }),
  vectorcraft: Object.freeze({ open_file: { path: 'inputs' }, save_file: { path: 'outputs' } }),
  pdfcraft: Object.freeze({ doc_open: { path: 'inputs' }, doc_save: { path: 'outputs' } }),
  effectcraft: Object.freeze({ open_project: { path: 'inputs' }, save_project: { path: 'outputs' } }),
  wordcraft: Object.freeze({ open_document: { path: 'inputs' }, save_document: { path: 'outputs' } }),
  soundcraft: Object.freeze({ open_session: { path: 'inputs' }, import_audio: { path: 'inputs' },
    save_session: { path: 'outputs' }, bounce_mix: { path: 'outputs' } }),
  filmcraft: Object.freeze({ media_import: { paths: 'inputs' } }),
  lightcraft: Object.freeze({ import: { paths: 'inputs' }, render_photo: { path: 'outputs' }, export: { dir: 'outputs', path: 'outputs' } }),
  designcraft: Object.freeze({ open_document: { path: 'inputs' }, place_image: { path: 'inputs' }, save_document: { path: 'outputs' },
    render_page: { path: 'outputs' }, export_png: { path: 'outputs' }, screenshot: { path: 'outputs' } }),
  figcraft: Object.freeze({ open_file: { path: 'inputs' }, save_file: { path: 'outputs' }, export: { path: 'outputs' } }),
  deckcraft: Object.freeze({ open_presentation: { path: 'inputs' }, insert_picture: { path: 'inputs' },
    save_presentation: { path: 'outputs' }, export: { path: 'outputs' } }),
  cadcraft: Object.freeze({ open: { path: 'inputs' }, save: { path: 'outputs' }, render: { path: 'outputs' } }),
  gridcraft: Object.freeze({ open_workbook: { path: 'inputs' }, save_workbook: { path: 'outputs' }, screenshot: { path: 'outputs' } }),
})
const REQUIRED_OUTPUT_PATHS = Object.freeze({
  photocraft: { doc_save: ['path'] }, vectorcraft: { save_file: ['path'] }, pdfcraft: { doc_save: ['path'] },
  effectcraft: { save_project: ['path'] }, wordcraft: { save_document: ['path'] }, soundcraft: { save_session: ['path'], bounce_mix: ['path'] },
  designcraft: { save_document: ['path'], export_png: ['path'] }, figcraft: { save_file: ['path'] },
  deckcraft: { save_presentation: ['path'], export: ['path'] }, cadcraft: { save: ['path'], render: ['path'] }, gridcraft: { save_workbook: ['path'] },
  lightcraft: { render_photo: ['path'], export: ['path'] },
})
const TOOL_SPECS = Object.freeze({
  photocraft: Object.freeze({ command_list: ['filter'], command_run: ['id', 'params'], doc_new: ['width', 'height', 'mode', 'depth'],
    doc_open: ['path'], doc_save: ['doc', 'path'] }),
  vectorcraft: Object.freeze({ list_commands: ['filter'], run_command: ['command', 'params'], inspect_document: [],
    open_file: ['path'], save_file: ['path'] }),
  pdfcraft: Object.freeze({ doc_open: ['path'], doc_info: ['doc'], text_extract: ['doc', 'pages'],
    command_list: ['doc', 'filter'], command_run: ['id', 'params'], doc_save: ['doc', 'path'] }),
  effectcraft: Object.freeze({ list_commands: ['filter'], execute_command: ['command', 'params'], get_project: [],
    open_project: ['path', 'demo', 'new'], save_project: ['path'], render_preview: ['comp', 'time', 'max_side'] }),
  wordcraft: Object.freeze({ list_commands: ['query'], execute: ['command', 'params'], new_document: ['template'],
    open_document: ['path'], save_document: ['path'], type_text: ['text'], get_text: [], inspect_document: [], render_page: ['page'] }),
  soundcraft: Object.freeze({ list_commands: ['filter'], execute: ['command', 'params'], new_session: ['demo'],
    open_session: ['path'], save_session: ['path', 'replace'], import_audio: ['path', 'track'], bounce_mix: ['path'] }),
  filmcraft: Object.freeze({ command_list: ['enabled_only', 'filter'], command_run: ['id', 'params'], media_import: ['paths', 'bin', 'image_sequence'],
    project_inspect: [], sequence_inspect: [], doc_inspect: [], render_frame: ['seconds', 'max_side'], render_preview: ['seconds', 'max_side'] }),
  lightcraft: Object.freeze({ list_commands: ['filter'], import: ['paths', 'album', 'destination', 'mode', 'organize', 'rename'], query_photos: ['filter', 'limit', 'offset', 'sort'],
    select_photos: ['active', 'ids', 'mode'], set_develop: ['id', 'label', 'settings', 'values'], crop: ['id', 'aspect', 'angle', 'bounds'],
    render_photo: ['format', 'id', 'path', 'size'], export: ['ids', 'path', 'format', 'quality', 'width', 'height', 'removeLocation'] }),
  designcraft: Object.freeze({ list_commands: ['enabledOnly', 'filter'], execute: ['command', 'params'], new_document: ['title', 'preset', 'width', 'height', 'pages', 'margins', 'bleed', 'columns', 'gutter', 'facingPages'],
    open_document: ['path'], save_document: ['path'], set_story_text: ['story', 'frame', 'text'], get_story: ['story', 'frame'],
    place_image: ['path', 'name', 'spread', 'frame', 'x', 'y', 'width', 'base64'], render_page: ['page', 'path', 'scale'], export_png: ['page', 'path', 'scale'] }),
  figcraft: Object.freeze({ create_node: ['type', 'name', 'parent', 'index', 'x', 'y', 'width', 'height', 'text', 'props'],
    set_properties: ['ids', 'props'], inspect_document: ['allPages', 'depth'], get_node: ['id', 'depth'], export: ['path', 'format', 'size', 'scale', 'ids'],
    open_file: ['path', 'variables'], save_file: ['path'] }),
  deckcraft: Object.freeze({ new_presentation: ['blank', 'theme'], open_presentation: ['path'], save_presentation: ['path'], export: ['path', 'format', 'slides', 'all', 'dpi'],
    inspect_document: [], inspect_slide: ['index'], render_slide: ['slide', 'scale'], add_slide: ['title', 'body', 'layout'], add_shape: ['preset', 'x', 'y', 'w', 'h', 'fill', 'line', 'text'],
    add_text_box: ['x', 'y', 'w', 'h', 'text', 'size', 'color', 'align'], set_text: ['id', 'text'], insert_picture: ['path', 'name', 'x', 'y', 'w', 'h'] }),
  cadcraft: Object.freeze({ list_commands: ['filter'], new_drawing: ['metric'], execute: ['command', 'params'], inspect_drawing: ['entities', 'limit'], query_entities: ['type', 'layer', 'limit', 'offset', 'window', 'crossing'],
    open: ['path'], save: ['path'], render: ['fit', 'height', 'width', 'window', 'path'], find_text: ['contains', 'layer', 'limit', 'offset', 'window'] }),
  gridcraft: Object.freeze({ new_workbook: ['sample'], open_workbook: ['path'], save_workbook: ['path'], inspect_workbook: [], read_range: ['range', 'sheet', 'formatted', 'formulas'],
    write_range: ['range', 'values'], set_cell: ['cell', 'input'], get_cell: ['cell'], evaluate_formula: ['cell', 'formula'], format_range: ['range', 'bold', 'italic', 'underline', 'fillColor', 'fontColor', 'fontSize', 'fontName', 'numberFormat', 'wrapText', 'horizontalAlign'],
    insert_chart: ['range', 'type', 'subtype', 'at', 'title'], create_table: ['range', 'name', 'style', 'header'], sort_range: ['range', 'keys', 'header'], filter: ['range', 'column', 'values', 'custom', 'blanks', 'clear'] }),
})

function stripSchemaDescriptions(value) {
  if (Array.isArray(value)) return value.map(stripSchemaDescriptions)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'description' && key !== 'title' && key !== '$schema')
    .map(([key, child]) => [key, stripSchemaDescriptions(child)]))
}

function narrowInputSchema(schema, allowedProperties) {
  const properties = Object.fromEntries(Object.entries(schema.properties)
    .filter(([name]) => allowedProperties.includes(name))
    .map(([name, definition]) => [name, stripSchemaDescriptions(definition)]))
  const required = Array.isArray(schema.required) ? schema.required.filter(name => Object.hasOwn(properties, name)) : []
  return { type: 'object', additionalProperties: false, properties, required }
}

function toolName(appId, sourceName) {
  const suffix = String(sourceName).replace(/[^a-zA-Z0-9_-]/g, '_')
  const prefix = `artcraft_${appId}_`
  if (!suffix || suffix.length + prefix.length > 64) throw new Error(`ArtCraft MCP tool name is not supported: ${sourceName}`)
  return prefix + suffix
}

function makeTransport(child, timeoutMs) {
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
  const iterator = lines[Symbol.asyncIterator]()
  let nextId = 1
  let closed = false
  let stderrTail = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { stderrTail = (stderrTail + chunk).slice(-2048) })

  async function request(method, params) {
    if (closed || child.exitCode !== null) throw new Error(`ArtCraft ${method} MCP request has no live server.`)
    const id = nextId++
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    if (Buffer.byteLength(message, 'utf8') > MAX_FRAME_BYTES) throw new Error('ArtCraft MCP request exceeded its frame limit.')
    if (!child.stdin.write(`${message}\n`)) await new Promise((resolve, reject) => {
      child.stdin.once('drain', resolve)
      child.stdin.once('error', reject)
    })
    let timer
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`ArtCraft MCP ${method} timed out.`)), timeoutMs) })
    const response = (async () => {
      for (;;) {
        const { value, done } = await iterator.next()
        if (done) throw new Error(`ArtCraft MCP server closed during ${method}${stderrTail ? `: ${stderrTail.trim().slice(-300)}` : ''}.`)
        if (Buffer.byteLength(value, 'utf8') > MAX_FRAME_BYTES) throw new Error('ArtCraft MCP response exceeded its frame limit.')
        let item
        try { item = JSON.parse(value) } catch { continue }
        if (item?.id !== id) continue
        if (item.error) throw new Error(`ArtCraft MCP ${method} failed: ${String(item.error.message || item.error.code || 'unknown error').slice(0, 400)}`)
        return item.result
      }
    })()
    try { return await Promise.race([response, timeout]) }
    finally { clearTimeout(timer) }
  }

  function notify(method, params = {}) {
    if (closed || child.exitCode !== null) return
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  async function close() {
    if (closed) return
    closed = true
    lines.close()
    child.stdin.end()
    if (child.exitCode !== null) return
    await new Promise(resolve => {
      const timer = setTimeout(() => {
        if (child.exitCode === null) child.kill()
        resolve()
      }, 1500)
      child.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }
  return { request, notify, close }
}

function compactMcpResult(result, maxBytes) {
  const content = Array.isArray(result?.content) ? result.content.map(item => {
    if (item?.type === 'text') return { type: 'text', text: String(item.text || '').slice(0, 6000) }
    if (item?.type === 'image') return { type: 'image', note: `Image result omitted from text-only model context (${item.mimeType || 'unknown type'}).` }
    return { type: String(item?.type || 'unknown'), note: 'Unsupported MCP content block omitted.' }
  }) : []
  const safe = { isError: result?.isError === true, content,
    ...(result?.structuredContent && typeof result.structuredContent === 'object'
      ? { structuredContent: result.structuredContent } : {}) }
  let encoded = JSON.stringify(safe)
  if (Buffer.byteLength(encoded, 'utf8') > maxBytes) {
    safe.content = content.slice(0, 2).map(item => item.type === 'text'
      ? { type: 'text', text: item.text.slice(0, 1000) } : item)
    safe.truncated = true
    encoded = JSON.stringify(safe)
  }
  if (Buffer.byteLength(encoded, 'utf8') > maxBytes) throw new Error('ArtCraft MCP result exceeds the local tool output limit.')
  return encoded
}

function vectorDocumentObjectCount(result) {
  const text = Array.isArray(result?.content)
    ? result.content.find(item => item?.type === 'text')?.text : ''
  if (typeof text !== 'string') return null
  let document
  try { document = JSON.parse(text) } catch { return null }
  let count = 0
  const visit = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 32 || count > 10000) return
    if (Array.isArray(node)) { for (const child of node) visit(child, depth + 1); return }
    if (typeof node.kind === 'string' && node.kind !== 'Layer') count++
    for (const [key, value] of Object.entries(node)) if (key === 'children' || key === 'layers') visit(value, depth + 1)
  }
  visit(document.layers)
  return count
}

export function isNoriArtCraftMcpScoped(appId) {
  return SCOPED_APPS.has(String(appId || ''))
}

function selectedToolSpecs(appId, goal) {
  const all = TOOL_SPECS[appId]
  const text = String(goal || '')
  if (/\b(?:list|show|which|what)\b.*\b(?:commands|tools)\b/i.test(text)) {
    const name = Object.hasOwn(all, 'command_list') ? 'command_list'
      : Object.hasOwn(all, 'list_commands') ? 'list_commands' : null
    if (name) return { [name]: all[name] }
  }
  if (appId === 'wordcraft') {
    const names = ['new_document', 'type_text', 'get_text', 'save_document']
    if (/\b(?:open|read|edit|revise|update|existing|modify)\b/i.test(text)) names.push('open_document')
    return Object.fromEntries(names.filter(name => Object.hasOwn(all, name)).map(name => [name, all[name]]))
  }
  if (appId === 'effectcraft') {
    const names = ['open_project', 'get_project', 'save_project']
    if (/\b(?:create|make|build|design|draw|generate|compose)\b/i.test(text)) names.push('execute_command')
    if (/\b(?:render|preview)\b/i.test(text)) names.push('render_preview')
    return Object.fromEntries(names.map(name => [name, all[name]]))
  }
  if (appId === 'soundcraft') {
    const names = ['new_session', 'save_session', 'bounce_mix']
    if (/\b(?:import|audio file|track|source audio|open|edit|existing)\b/i.test(text)) names.push('import_audio', 'open_session')
    return Object.fromEntries(names.map(name => [name, all[name]]))
  }
  if (appId === 'pdfcraft' && /\b(?:extract|read|inspect|summari[sz]e)\b/i.test(text)) {
    const names = ['doc_open', 'doc_info', 'text_extract']
    if (/\b(?:save|copy|export)\b/i.test(text)) names.push('doc_save')
    return Object.fromEntries(names.map(name => [name, all[name]]))
  }
  if (appId === 'vectorcraft') {
    const editsExisting = /\b(?:open|read|edit|revise|update|existing|modify)\b/i.test(text)
    // New-art requests do not need the large command catalog or document
    // inspection schema in the model prompt. The command runner remains
    // available, and its compact command hints are supplied by the caller.
    const names = editsExisting
      ? ['list_commands', 'run_command', 'inspect_document', 'open_file', 'save_file']
      : ['run_command', 'save_file']
    return Object.fromEntries(names.map(name => [name, all[name]]))
  }
  if (appId === 'filmcraft') {
    const names = ['command_list', 'command_run', 'media_import', 'project_inspect', 'sequence_inspect', 'render_preview']
    return Object.fromEntries(names.map(name => [name, all[name]]))
  }
  if (appId === 'lightcraft') {
    const names = []
    if (/\b(?:import|add|ingest|library)\b/i.test(text)) names.push('import')
    names.push('query_photos')
    if (/\b(?:select|choose|pick)\b/i.test(text)) names.push('select_photos')
    if (/\b(?:edit|adjust|develop|retouch|crop|color|exposure|photo)\b/i.test(text)) names.push('set_develop')
    const asksForExport = /\b(?:export|save|deliver|output)\b/i.test(text)
    if (asksForExport) names.push('export')
    else if (/\b(?:render|preview)\b/i.test(text)) names.push('render_photo')
    if (!names.length) names.push('query_photos')
    const allowed = {
      import: ['paths'], query_photos: ['filter', 'limit', 'sort'], select_photos: ['active', 'ids', 'mode'],
      set_develop: ['id', 'values'], crop: ['id', 'aspect', 'angle', 'bounds'], render_photo: ['format', 'id', 'path'],
      export: ['ids', 'path', 'format', 'quality', 'width', 'height', 'removeLocation'],
    }
    return Object.fromEntries(names.map(name => [name, allowed[name]]))
  }
  if (appId === 'designcraft') {
    const editing = /\b(?:open|read|edit|revise|update|existing|modify)\b/i.test(text)
    const names = ['new_document', 'execute', 'save_document', 'get_story']
    if (editing || /\b(?:text|copy|write|wording|story)\b/i.test(text)) names.push('set_story_text')
    if (editing || /\b(?:image|photo|picture|graphic)\b/i.test(text)) names.push('place_image')
    if (/\b(?:render|preview|png|image|export)\b/i.test(text)) names.push('export_png')
    if (editing) names.push('open_document')
    return Object.fromEntries(names.map(name => [name, all[name]]))
  }
  if (appId === 'figcraft') {
    const names = ['create_node', 'set_properties', 'inspect_document', 'get_node', 'export', 'save_file']
    if (/\b(?:open|read|edit|revise|update|existing|modify)\b/i.test(text)) names.push('open_file')
    return Object.fromEntries(names.map(name => [name, all[name]]))
  }
  if (appId === 'deckcraft') {
    const names = ['new_presentation', 'add_slide', 'add_shape', 'add_text_box', 'save_presentation', 'inspect_document']
    if (/\b(?:export|render|preview|pdf|pptx)\b/i.test(text)) names.push('export')
    if (/\b(?:open|read|edit|revise|update|existing|modify)\b/i.test(text)) names.push('open_presentation')
    return Object.fromEntries(names.map(name => [name, all[name]]))
  }
  if (appId === 'cadcraft') {
    const names = ['new_drawing', 'execute', 'inspect_drawing', 'query_entities', 'render', 'save']
    if (/\b(?:open|read|edit|revise|update|existing|modify)\b/i.test(text)) names.push('open')
    return Object.fromEntries(names.map(name => [name, all[name]]))
  }
  if (appId === 'gridcraft') {
    const names = ['new_workbook', 'write_range', 'set_cell', 'save_workbook']
    if (/\b(?:read|inspect|summari[sz]e|check|verify|confirm|analy[sz]e)\b/i.test(text)) names.push('read_range', 'get_cell')
    if (/\b(?:formula|calculate|evaluate)\b/i.test(text)) names.push('evaluate_formula')
    if (/\b(?:format|style|color|bold|italic)\b/i.test(text)) names.push('format_range')
    if (/\b(?:chart|graph|visuali[sz]e)\b/i.test(text)) names.push('insert_chart')
    if (/\b(?:table|sort|filter)\b/i.test(text)) names.push('create_table', 'sort_range', 'filter')
    if (/\b(?:open|read|edit|revise|update|existing|modify)\b/i.test(text)) names.push('open_workbook')
    return Object.fromEntries(names.map(name => [name, all[name]]))
  }
  return all
}

export function vectorArtworkViewport(svg) {
  const root = typeof svg === 'string' && /<svg\b([^>]*)>/i.exec(svg)
  if (!root) throw new Error('Vector artwork needs an SVG root.')
  const attributes = root[1]
  const attribute = name => new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(attributes)?.[2]
  const viewBox = attribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  if (viewBox && (viewBox.length !== 4 || viewBox.some(n => !Number.isFinite(n)) || viewBox[2] <= 0 || viewBox[3] <= 0)) {
    throw new Error('Vector artwork has an invalid viewBox.')
  }
  const dimension = (name, index, fallback) => {
    const value = attribute(name)
    if (value !== undefined && !/^\d+(?:\.\d+)?(?:px)?$/i.test(value.trim())) {
      throw new Error('Vector artwork dimensions must use pixels.')
    }
    const number = value === undefined ? (viewBox?.[index] ?? fallback) : Number(value.trim().replace(/px$/i, ''))
    if (!Number.isInteger(number) || number < 1 || number > 8192) throw new Error('Vector artwork dimensions must be whole pixels from 1 to 8192.')
    return number
  }
  return {width:dimension('width', 2, 1200), height:dimension('height', 3, 800)}
}

function safeGeneratedSvg(svg) {
  if (typeof svg !== 'string' || svg.length < 120 || svg.length > 30_000) return false
  if (!/^\s*<svg\b[\s\S]*<\/svg>\s*$/i.test(svg)
    || /<!|<\?|<\s*\/?(?:script|foreignObject|image|iframe|object|embed|audio|video|use|a|style)\b|\bon[a-z]+\s*=|\b(?:href|src|style)\s*=|javascript:|data:/i.test(svg)) return false
  const allowed = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline',
    'text', 'tspan', 'defs', 'linearGradient', 'radialGradient', 'stop', 'title', 'desc'])
  for (const match of svg.matchAll(/<\s*\/?\s*([a-z][\w:-]*)\b/gi)) if (!allowed.has(match[1])) return false
  const ids = [...svg.matchAll(/\bid\s*=\s*"([A-Za-z][A-Za-z0-9_-]{0,63})"/g)].map(match => match[1])
  if (new Set(ids).size !== ids.length) return false
  const references = [...svg.matchAll(/\burl\s*\(\s*([^)]*?)\s*\)/gi)].map(match => match[1])
  if (references.some(reference => !/^#[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(reference)
    || !ids.includes(reference.slice(1)))) return false
  return /<(?:path|rect|circle|ellipse|line|polygon|polyline|text)\b/i.test(svg)
}

export function scopedWorkspacePath(value, root, appId, area) {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.includes('\0')) {
    throw new Error(`ArtCraft ${area} path must be a bounded local path.`)
  }
  const canonicalRoot = realpathSync(root)
  const normalized = value.replace(/\\/g, '/')
  const prefixes = [`app-sandboxes/${appId}/${area}/`, `${appId}/${area}/`, `${area}/`]
  let candidate = normalized
  if (!path.isAbsolute(value)) {
    const prefix = prefixes.find(item => normalized.toLowerCase().startsWith(item.toLowerCase()))
    if (prefix) candidate = normalized.slice(prefix.length)
    if (candidate.split('/').some(part => !part || part === '.' || part === '..' || part.includes(':'))) {
      throw new Error(`ArtCraft ${area} path contains an invalid path component.`)
    }
    candidate = path.resolve(canonicalRoot, ...candidate.split('/'))
  }
  const relative = path.relative(canonicalRoot, candidate)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`ArtCraft ${area} path is outside its Nori workspace.`)
  }
  let current = canonicalRoot
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    try {
      const stat = lstatSync(current)
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) {
        throw new Error(`ArtCraft ${area} path cannot follow links.`)
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return candidate
}

function scopeFileArguments(appId, sourceName, args, inputRoot, outputRoot) {
  const forwarded = { ...args }
  const pathFields = FILE_PATHS[appId]?.[sourceName] || {}
  for (const [key, area] of Object.entries(pathFields)) {
    if (args[key] === undefined) continue
    const root = area === 'inputs' ? inputRoot : outputRoot
    if (key === 'paths') {
      if (!Array.isArray(args[key]) || args[key].length < 1 || args[key].length > 128) throw new Error(`ArtCraft ${area} paths must be a bounded list.`)
      forwarded[key] = args[key].map(value => scopedWorkspacePath(value, root, appId, area))
    } else {
      forwarded[key] = scopedWorkspacePath(args[key], root, appId, area)
    }
  }
  for (const key of REQUIRED_OUTPUT_PATHS[appId]?.[sourceName] || []) {
    if (typeof forwarded[key] !== 'string' || !forwarded[key]) throw new Error(`ArtCraft ${sourceName} requires an explicit output path inside Nori's app workspace.`)
  }
  if (appId === 'filmcraft' && sourceName === 'command_run') {
    const allowed = FILM_COMMAND_PARAMS[args.id]
    if (!allowed) throw new Error('FilmCraft command is not in Nori’s restricted command set.')
    const params = args.params === undefined ? {} : args.params
    if (!params || typeof params !== 'object' || Array.isArray(params)
      || Object.keys(params).some(key => !allowed.includes(key))) {
      throw new Error('FilmCraft command parameters exceed Nori’s restricted command contract.')
    }
    if (args.id === 'edit.pasteMedia') {
      if (!Array.isArray(params.paths) || params.paths.length < 1 || params.paths.length > 128) throw new Error('FilmCraft media paths must be a bounded input list.')
      forwarded.params = { ...params, paths: params.paths.map(value => scopedWorkspacePath(value, inputRoot, appId, 'inputs')) }
    }
    if (args.id === 'file.saveAs' || args.id === 'file.saveCopy') {
      forwarded.params = { ...params, path: scopedWorkspacePath(params.path, outputRoot, appId, 'outputs') }
    }
  }
  if (appId === 'cadcraft' && sourceName === 'execute') validateNoriCadCraftCommand(args)
  return forwarded
}

export async function createNoriArtCraftMcpTools(appId, {
  noriRoot = installationPaths().noriRoot,
  workspaceRoot = noriRoot,
  spawnProcess = spawn,
  timeoutMs = 20_000,
  goal = '',
  onPreview = null,
  onArtifact = null,
  artifactWorkflows = false,
} = {}) {
  if (onPreview !== null && typeof onPreview !== 'function') throw new TypeError('ArtCraft preview sink must be host-owned')
  if (onArtifact !== null && typeof onArtifact !== 'function') throw new TypeError('ArtCraft artifact sink must be host-owned')
  if (!SCOPED_APPS.has(appId)) throw new Error(`Nori has not qualified a confined MCP session for ${String(appId)}.`)
  const effectCommands = /\b(?:keyframes?|animat\w*|moves?|moving)\b/i.test(goal)
    ? { ...EFFECT_SAFE_COMMAND_PARAMS, 'prop.addKey': ['layer', 'path', 'time', 'value'] }
    : EFFECT_SAFE_COMMAND_PARAMS
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) throw new RangeError('Invalid ArtCraft MCP timeout.')
  const root = realpathSync(noriRoot)
  const dataRoot = realpathSync(workspaceRoot)
  const integrationRoot = realpathSync(path.join(root, 'integrations', 'artcraft'))
  const manifest = JSON.parse(readFileSync(path.join(integrationRoot, 'artcraft-apps.json'), 'utf8'))
  if (manifest.schema !== 'nori.integration.artcraft-apps.v1' || !Array.isArray(manifest.applications)) {
    throw new Error('The local ArtCraft inventory is missing or has an unsupported schema.')
  }
  const app = manifest.applications.find(entry => entry?.id === appId && typeof entry.cli_exe === 'string')
  if (!app) throw new Error(`The installed ArtCraft inventory has no CLI for ${appId}.`)
  const cli = realpathSync(path.resolve(integrationRoot, app.cli_exe))
  const relativeCli = path.relative(integrationRoot, cli)
  if (!statSync(cli).isFile() || !relativeCli || relativeCli === '..' || relativeCli.startsWith(`..${path.sep}`) || path.isAbsolute(relativeCli)) {
    throw new Error('The ArtCraft CLI is not a regular file inside Nori’s integration folder.')
  }
  const workspaceCandidate = path.join(dataRoot, 'integrations', 'artcraft', 'workspaces')
  mkdirSync(workspaceCandidate, { recursive: true })
  const workspaces = realpathSync(workspaceCandidate)
  const dataRelative = path.relative(dataRoot, workspaces)
  if (dataRelative !== path.join('integrations', 'artcraft', 'workspaces')) {
    throw new Error('ArtCraft workspace root escaped Nori’s selected data folder.')
  }
  const appWorkspaceCandidate = path.join(workspaces, 'app-sandboxes', appId)
  const inputCandidate = path.join(appWorkspaceCandidate, 'inputs')
  const outputCandidate = path.join(appWorkspaceCandidate, 'outputs')
  mkdirSync(inputCandidate, { recursive: true })
  mkdirSync(outputCandidate, { recursive: true })
  const appWorkspace = realpathSync(appWorkspaceCandidate)
  const inputRoot = realpathSync(inputCandidate)
  const outputRoot = realpathSync(outputCandidate)
  const reportArtifact = async (file, tool) => {
    const relative = path.relative(outputRoot, file)
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('ArtCraft artifact escaped its app output folder.')
    }
    const info = lstatSync(file)
    if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > 256 * 1024 * 1024
      || realpathSync(file) !== file) throw new Error('ArtCraft artifact is not a bounded ordinary local file.')
    if (onArtifact) await onArtifact(Object.freeze({ appId, tool, path: file, name: path.basename(file) }))
  }
  const workspaceRelative = path.relative(workspaces, appWorkspace)
  const inputRelative = path.relative(appWorkspace, inputRoot)
  const outputRelative = path.relative(appWorkspace, outputRoot)
  if (!statSync(appWorkspace).isDirectory() || !statSync(inputRoot).isDirectory() || !statSync(outputRoot).isDirectory()
    || workspaceRelative !== path.join('app-sandboxes', appId)
    || inputRelative !== 'inputs' || outputRelative !== 'outputs') {
    throw new Error(`Nori's isolated app workspace for ${appId} escaped its expected boundary.`)
  }
  const { args, serverScope } = artcraftMcpLaunchConfig(appId, appWorkspace, outputRoot)
  const child = spawnProcess(cli, args, { cwd: appWorkspace, detached: false, windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'], shell: false })
  const transport = makeTransport(child, timeoutMs)
  try {
    await transport.request('initialize', { protocolVersion: PROTOCOL, capabilities: {},
      clientInfo: { name: 'nori-artcraft-local', version: '1.0' } })
    transport.notify('notifications/initialized')
    const listed = await transport.request('tools/list', {})
    if (!Array.isArray(listed?.tools) || listed.tools.length > MAX_TOOLS) throw new Error(`The ${appId} MCP catalog is missing or exceeds Nori's tool bound.`)
    const newVectorArtwork = appId === 'vectorcraft'
      && !/\b(?:open|read|edit|revise|update|existing|modify|list|show|which|what)\b/i.test(String(goal || ''))
    const specs = selectedToolSpecs(appId, goal)
    const newEffectProject = appId === 'effectcraft' && /\b(?:create|make|build|generate)\b/i.test(String(goal || ''))
      && !/\b(?:existing|open|read|edit|revise|update|modify|import)\b/i.test(String(goal || ''))
    const newMotion = artifactWorkflows === true && newEffectProject && /\b(?:animat\w*|moving)\b/i.test(goal)
    const newPresentation = artifactWorkflows === true && appId === 'deckcraft' && /\b(?:create|make|build|generate)\b/i.test(goal)
      && !/\b(?:existing|open|edit|modify|import|image|photo|picture|chart|graph|animation|video|audio|theme|template)\b/i.test(goal)
    const selected = listed.tools.filter(item => !newVectorArtwork && Object.hasOwn(specs, item?.name)
      && item.inputSchema?.type === 'object' && item.inputSchema.properties && typeof item.inputSchema.properties === 'object')
    const sourceNames = new Map()
    let definitions
    if (newPresentation) {
      for (const required of ['new_presentation','add_slide','save_presentation','open_presentation','inspect_slide']) {
        if(!listed.tools.some(item=>item.name===required)) throw new Error('DeckCraft text workflow is missing a required MCP operation')
      }
      const name=toolName(appId,'create_presentation')
      sourceNames.set(name,'__nori_create_presentation')
      definitions=[{type:'function',function:{name,strict:false,description:'Create a text presentation, save it as .deckcraft, reopen it and verify every slide title/body. Not an image/chart or PowerPoint export tool.',
        parameters:{type:'object',additionalProperties:false,properties:{slides:{type:'array',minItems:1,maxItems:10,items:{type:'object',additionalProperties:false,
          properties:{title:{type:'string',minLength:1,maxLength:200},body:{type:'string',maxLength:2000}},required:['title','body']}},path:{type:'string'}},required:['slides','path']}}}]
    } else if (newMotion) {
      for (const required of ['open_project','execute_command','save_project','render_preview']) {
        if (!listed.tools.some(item=>item.name===required)) throw new Error('EffectCraft motion workflow is missing a required MCP operation')
      }
      const name = toolName(appId, 'create_animation')
      sourceNames.set(name, '__nori_create_animation')
      const pair = {type:'array',items:{type:'number'},minItems:2,maxItems:2}
      definitions = [{type:'function',function:{name,description:'Create and save one shape with two position keys; render start/end previews. Host executes the complete EffectCraft workflow; no video export.',strict:false,
        parameters:{type:'object',additionalProperties:false,properties:{
          duration:{type:'number',minimum:0.1,maximum:30},
          kind:{type:'string',enum:['ellipse','rect','rounded','polygon','star']},size:pair,fill:{type:'string'},
          direction:{type:'string',enum:['left-to-right','right-to-left','top-to-bottom','bottom-to-top']},
          path:{type:'string',description:'Relative output project filename only, such as nori-acceptance.ecproj. Do not put canvas bounds, coordinates, or drawing data here.'},
          width:{type:'integer',minimum:64,maximum:1280,description:'Canvas width in pixels.'},
          height:{type:'integer',minimum:64,maximum:1280,description:'Canvas height in pixels.'},
          frameRate:{type:'integer',minimum:1,maximum:60,description:'Frames per second.'},
        },required:['duration','kind','size','fill','direction','path']}}}]
    } else if (newVectorArtwork) {
      const name = toolName(appId, 'create_artwork')
      sourceNames.set(name, '__nori_create_artwork')
      definitions = [{ type: 'function', function: { name,
        description: 'Create polished editable vector artwork from safe SVG, import it into VectorCraft, and save the verified document in Nori’s scoped output folder.',
        parameters: { type: 'object', additionalProperties: false,
          properties: { svg: { type: 'string' }, path: { type: 'string' } },
          required: ['svg', 'path'] }, strict: false } }]
    } else {
      if (!selected.length) throw new Error(`The ${appId} MCP server exposes no tools in Nori's qualified allowlist.`)
      definitions = selected.map(item => {
      const name = toolName(appId, item.name)
      if (sourceNames.has(name)) throw new Error(`The ${appId} MCP catalog contains a duplicate exposed tool name.`)
      sourceNames.set(name, item.name)
      const parameters = narrowInputSchema(item.inputSchema, specs[item.name])
      if (newEffectProject && item.name === 'open_project') {
        parameters.properties = { new: { type: 'boolean', enum: [true] } }
        parameters.required = ['new']
      }
      if (appId === 'filmcraft' && item.name === 'command_run') {
        parameters.properties.id = { type: 'string', enum: Object.keys(FILM_COMMAND_PARAMS) }
      }
      if (appId === 'cadcraft' && item.name === 'execute') {
        parameters.properties.command = { type: 'string', enum: CAD_SAFE_COMMANDS }
        // The shared execute tool also accepts the other registered commands.
        // Their per-command key sets are enforced by the same host preflight.
        parameters.properties.params = { type: 'object', properties: { p1: CAD_POINT_SCHEMA, p2: CAD_POINT_SCHEMA } }
        parameters.required = ['command', 'params']
      }
      if (appId === 'effectcraft' && item.name === 'execute_command') {
        parameters.properties.command = { type: 'string', enum: Object.keys(effectCommands) }
        parameters.properties.params = { type: 'object', additionalProperties: false,
          properties: Object.fromEntries([...new Set(Object.values(effectCommands).flat())]
            .map(key => [key, EFFECT_SAFE_PARAM_SCHEMA[key]])) }
      }
      if (appId === 'designcraft' && item.name === 'execute') {
        parameters.properties.command = { type: 'string', enum: Object.keys(DESIGN_SAFE_COMMAND_PARAMS) }
        parameters.properties.params = { type: 'object', additionalProperties: false,
          properties: {
            spread: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'object', additionalProperties: false,
              properties: { kind: { type: 'string', enum: ['doc', 'parent'] }, index: { type: 'integer', minimum: 0 } }, required: ['kind', 'index'] }] },
            rect: { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
            shape: { type: 'string', enum: ['rectangle', 'ellipse', 'polygon'] },
            content: { type: 'string', enum: ['graphic', 'text', 'unassigned'] },
            sides: { type: 'integer', minimum: 3, maximum: 64 }, text: { type: 'string', maxLength: 4000 },
            caret: { type: 'boolean' }, vertical: { type: 'boolean' },
          } }
      }
      return { type: 'function', function: { name,
        description: appId === 'cadcraft' ? CAD_TOOL_DESCRIPTIONS[item.name] || `CADCraft ${item.name}`
          : appId === 'effectcraft' ? EFFECT_TOOL_DESCRIPTIONS[item.name] || `EffectCraft ${item.name}` : appId === 'deckcraft'
          ? DECKCRAFT_TOOL_DESCRIPTIONS[item.name] || String(item.title || `DeckCraft ${item.name}`).slice(0, 64)
          : String(item.description || item.title || `${appId} ${item.name}`).slice(0, 96),
        parameters, strict: false } }
      })
    }
    const definitionsBytes = Buffer.byteLength(JSON.stringify(definitions), 'utf8')
    if (definitionsBytes > 2700) throw new Error(`The ${appId} MCP tool contract exceeds Nori's bounded GPT-OSS prompt budget (${definitionsBytes} bytes).`)
    return Object.freeze({
      appId,
      roots: Object.freeze({ read: appWorkspace, write: outputRoot,
        server: serverScope }),
      definitions: Object.freeze(definitions),
      async call(name, args, { maxBytes = MAX_RESULT_BYTES } = {}) {
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 256 || maxBytes > MAX_RESULT_BYTES) throw new RangeError('Invalid ArtCraft MCP result budget.')
        const sourceName = sourceNames.get(name)
        if (!sourceName || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('ArtCraft MCP call is outside the selected app contract.')
        if (newEffectProject && sourceName === 'open_project'
          && (args.new !== true || Object.keys(args).some(key => key !== 'new'))) {
          throw new Error('A new EffectCraft creation task must start a new project, not open an input file.')
        }
        if (sourceName === '__nori_create_presentation') {
          validateNoriPresentationSpec(args)
          const outputPath=scopedWorkspacePath(args.path,outputRoot,appId,'outputs')
          if(!outputPath.toLowerCase().endsWith('.deckcraft')||existsSync(outputPath)) throw new Error('New presentation needs an unused .deckcraft path; existing presentations are preserved.')
          const invoke=async(name,args)=>{
            const result=await transport.request('tools/call',{name,arguments:args})
            if(result?.isError) throw new Error(`DeckCraft ${name} failed; the presentation is incomplete. ${String(result.content?.find(item=>item.type==='text')?.text||'').slice(0,200)}`)
            return result
          }
          await invoke('new_presentation',{blank:true})
          for(const slide of args.slides) await invoke('add_slide',{...slide,layout:'title-and-content'})
          await invoke('save_presentation',{path:outputPath})
          if(!statSync(outputPath).isFile()||statSync(outputPath).size===0) throw new Error('DeckCraft did not save a nonempty presentation.')
          await invoke('open_presentation',{path:outputPath})
          for(let index=0;index<args.slides.length;index++) {
            const inspected=await invoke('inspect_slide',{index})
            const strings=[]
            const collect=value=>{if(typeof value==='string'){strings.push(value);try{collect(JSON.parse(value))}catch{}}else if(value&&typeof value==='object')for(const child of Object.values(value))collect(child)}
            collect(inspected)
            if(![args.slides[index].title,args.slides[index].body].every(text=>strings.some(value=>value.includes(text)))) {
              throw new Error(`DeckCraft saved file did not verify title/body for slide ${index+1}; task incomplete.`)
            }
          }
          await reportArtifact(outputPath, name)
          return compactMcpResult({isError:false,content:[{type:'text',text:`DeckCraft created ${args.slides.length} text slide(s), saved ${path.relative(workspaces,outputPath).replace(/\\/g,'/')}, reopened the file and verified every title/body. No PowerPoint export was performed.`}]},maxBytes)
        }
        if (sourceName === '__nori_create_animation') {
          const {width,height,frameRate,start,end}=validateNoriMotionSpec(args)
          const outputPath=scopedWorkspacePath(args.path,outputRoot,appId,'outputs')
          if (!outputPath.toLowerCase().endsWith('.ecproj')||existsSync(outputPath)) throw new Error('New animation needs an unused .ecproj output path; existing projects are preserved.')
          const invoke=async(name,args)=>{
            const result=await transport.request('tools/call',{name,arguments:args})
            if(result?.isError) throw new Error(`EffectCraft ${name} failed; the animation is incomplete. ${String(result.content?.find(item=>item.type==='text')?.text||'').slice(0,200)}`)
            return result
          }
          const edit=(command,params)=>invoke('execute_command',{command,params})
          await invoke('open_project',{new:true})
          await edit('comp.new',{name:'Nori motion',width,height,frameRate,duration:args.duration})
          const shape=await edit('shape.newShape',{kind:args.kind,size:args.size,position:start,fill:args.fill})
          const layer=effectCraftCreatedLayer(shape)
          await edit('prop.addKey',{layer,path:'transform/position',time:0,value:start})
          await edit('prop.addKey',{layer,path:'transform/position',time:args.duration,value:end})
          await invoke('save_project',{path:outputPath})
          const project=JSON.parse(readFileSync(outputPath,'utf8')),positions=[]
          const visit=value=>{if(!value||typeof value!=='object')return;if(value.match==='position'&&value.keys?.length===2)positions.push(value);for(const child of Object.values(value))visit(child)}
          visit(project)
          if(!positions.some(position=>JSON.stringify(position.keys.map(key=>key.value?.v?.slice(0,2)))===JSON.stringify([start,end]))) throw new Error('Saved animation did not contain the requested position keys.')
          const frames=[]
          for(const time of [0,args.duration*0.95]) {
            const result=await invoke('render_preview',{comp:'1',time,max_side:320})
            const item=result.content?.find(item=>item.type==='image'&&item.mimeType==='image/png')
            if(!item||typeof item.data!=='string'||item.data.length>MAX_FRAME_BYTES
              || !Buffer.from(item.data,'base64').subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('EffectCraft did not return a bounded PNG preview.')
            frames.push(item)
          }
          if(frames[0].data===frames[1].data) throw new Error('Animation previews did not show a frame change; motion is unverified.')
          if(onPreview) for(const item of frames) await onPreview(Object.freeze({appId,tool:name,mimeType:item.mimeType,data:item.data}))
          await reportArtifact(outputPath, name)
          return compactMcpResult({isError:false,content:[{type:'text',text:`EffectCraft saved ${path.relative(workspaces,outputPath).replace(/\\/g,'/')} with two verified position keys and two different rendered previews (${args.duration} seconds). Nori’s host executed the app workflow from the supplied visual specification. No video was exported.`}]},maxBytes)
        }
        if (appId === 'effectcraft' && sourceName === 'execute_command') {
          validateNoriEffectCraftCommand(args, { positionKeys: Object.hasOwn(effectCommands, 'prop.addKey') })
        }
        if (appId === 'designcraft' && sourceName === 'execute') {
          if (Object.keys(args).some(key => !['command', 'params'].includes(key))
            || !Object.hasOwn(DESIGN_SAFE_COMMAND_PARAMS, args.command)) {
            throw new Error('DesignCraft command is outside Nori’s bounded creation-safe command set.')
          }
          const params = args.params === undefined ? {} : args.params
          if (!params || typeof params !== 'object' || Array.isArray(params)
            || Object.keys(params).some(key => !DESIGN_SAFE_COMMAND_PARAMS[args.command].includes(key))) {
            throw new Error('DesignCraft command parameters exceed Nori’s bounded frame-creation contract.')
          }
        }
        if (sourceName === '__nori_create_artwork') {
          const outputPath = scopedWorkspacePath(args.path, outputRoot, appId, 'outputs')
          if (!safeGeneratedSvg(args.svg)) throw new Error('VectorCraft artwork must be a bounded SVG using only local, safe vector elements and no scripts, links, embedded media, or external resources.')
          const viewport = vectorArtworkViewport(args.svg)
          await transport.request('tools/call', { name: 'run_command', arguments: { command: 'file.new',
            params: { name: path.basename(outputPath, path.extname(outputPath)), ...viewport,
              units: 'Pixels', backgroundContents: 'white', colorMode: 'rgb' } } })
          const imported = await transport.request('tools/call', { name: 'run_command',
            arguments: { command: 'clipboard.importSvg', params: { svg: args.svg } } })
          if (imported?.isError) throw new Error(`VectorCraft rejected the generated SVG; the output was not saved. ${String(imported.content?.find(item => item?.type === 'text')?.text || 'No error details returned.').slice(0, 256)}`)
          const pasted = await transport.request('tools/call', { name: 'run_command',
            arguments: { command: 'edit.pasteInPlace', params: {} } })
          if (pasted?.isError) throw new Error('VectorCraft could not place the generated vector elements; the output was not saved.')
          const inspected = await transport.request('tools/call', { name: 'inspect_document', arguments: {} })
          const objectCount = vectorDocumentObjectCount(inspected)
          if (objectCount === null || objectCount < 1) throw new Error('VectorCraft did not confirm any visible objects; the output was not saved.')
          await transport.request('tools/call', { name: 'save_file', arguments: { path: outputPath } })
          const saved = readFileSync(outputPath, 'utf8')
          const savedObjects = [...saved.matchAll(/<(?:path|rect|circle|ellipse|line|polygon|polyline|text)\b/gi)].length
          if (savedObjects < 1 || saved.length > 2_000_000) throw new Error('VectorCraft save verification found no artwork or an out-of-bounds file; completion is not confirmed.')
          const savedViewport = vectorArtworkViewport(saved)
          if (savedViewport.width !== viewport.width || savedViewport.height !== viewport.height) throw new Error('VectorCraft did not preserve the requested canvas dimensions; completion is not confirmed.')
          await reportArtifact(outputPath, name)
          return compactMcpResult({ isError: false, content: [{ type: 'text', text:
            `VectorCraft imported ${objectCount} visible vector object(s) and saved a verified editable SVG (${savedObjects} drawable element(s)) at ${path.relative(workspaces, outputPath).replace(/\\/g, '/')}.` }] }, maxBytes)
        }
        const forwarded = scopeFileArguments(appId, sourceName, args, inputRoot, outputRoot)
        if (appId === 'vectorcraft' && sourceName === 'save_file') {
          const inspected = await transport.request('tools/call', { name: 'inspect_document', arguments: {} })
          const objectCount = vectorDocumentObjectCount(inspected)
          if (objectCount === null) throw new Error('VectorCraft could not verify document contents; save was not attempted.')
          if (objectCount < 1) {
            return compactMcpResult({ isError: true, content: [{ type: 'text',
              text: 'Save blocked: the VectorCraft document contains no visible artwork yet. Add shapes or text, inspect the result, then save.' }] }, maxBytes)
          }
        }
        const result = await transport.request('tools/call', { name: sourceName, arguments: forwarded })
        if (result?.isError !== true) {
          for (const key of REQUIRED_OUTPUT_PATHS[appId]?.[sourceName] || []) {
            await reportArtifact(forwarded[key], name)
          }
          if (appId === 'filmcraft' && sourceName === 'command_run' && ['file.saveAs', 'file.saveCopy'].includes(args.id)) {
            await reportArtifact(forwarded.params.path, name)
          }
        }
        if (onPreview && result?.isError !== true) {
          for (const item of result?.content || []) {
            if (item?.type !== 'image') continue
            if (item.mimeType !== 'image/png' || typeof item.data !== 'string' || item.data.length > MAX_FRAME_BYTES
              || !Buffer.from(item.data, 'base64').subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
              throw new Error('ArtCraft preview is not a bounded PNG image')
            }
            await onPreview(Object.freeze({ appId, tool: name, mimeType: item.mimeType, data: item.data }))
          }
        }
        return compactMcpResult(result, maxBytes)
      },
      close: transport.close,
    })
  } catch (error) {
    await transport.close().catch(() => {})
    throw error
  }
}
