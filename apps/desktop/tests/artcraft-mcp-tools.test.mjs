import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, statSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
const bridgeModule = process.env.NORI_ARTCRAFT_BRIDGE_MODULE
  ? pathToFileURL(process.env.NORI_ARTCRAFT_BRIDGE_MODULE).href
  : new URL('../bridge/artcraft-mcp-tools.mjs', import.meta.url).href
const { createNoriArtCraftMcpTools, isNoriArtCraftMcpScoped, validateNoriMotionSpec } = await import(bridgeModule)
import { artcraftMcpLaunchConfig } from '../bridge/artcraft-mcp-launch.mjs'
import { noriArtCraftMcpToolMatchesUserIntent } from '../bridge/artcraft-tools.mjs'
import { translateNeuraleseArtCraftActions, dispatchNeuraleseArtCraftPlan } from '../bridge/neuralese-artcraft-plan.mjs'

test('motion layout derives fully visible centers for all four registered directions',()=>{
  const base={duration:2,kind:'ellipse',size:[40,40],fill:'#0000ff',path:'motion.ecproj'}
  for(const [direction,expected] of Object.entries({
    'left-to-right':[[21,120],[299,120]],'right-to-left':[[299,120],[21,120]],
    'top-to-bottom':[[160,21],[160,219]],'bottom-to-top':[[160,219],[160,21]],
  })) {
    const {start,end}=validateNoriMotionSpec({...base,direction})
    assert.deepEqual([start,end],expected)
  }
})

test('one typed animation specification executes the whole real EffectCraft workflow through Neuralese', {timeout:45000}, async()=>{
  const workspaceRoot=mkdtempSync(path.join(os.tmpdir(),'nori-motion-workflow-')),previews=[]
  const goal='Use EffectCraft to create a two-second blue circle animation, save it and render previews.'
  const tools=await createNoriArtCraftMcpTools('effectcraft',{noriRoot:'C:/Nori',workspaceRoot,goal,artifactWorkflows:true,onPreview:preview=>previews.push(preview)})
  const spec={duration:2,kind:'ellipse',size:[40,40],fill:'#0000ff',direction:'left-to-right',path:'motion.ecproj'}
  const name='artcraft_effectcraft_create_animation'
  try {
    assert.deepEqual(tools.definitions.map(item=>item.function.name),[name])
    assert.ok(Buffer.byteLength(JSON.stringify(tools.definitions))<2700)
    await assert.rejects(()=>tools.call(name,{...spec,direction:'unknown'}),/registered motion direction/)
    await assert.rejects(()=>tools.call(name,{...spec,size:[4000,4000]}),/fit fully inside the canvas/)
    await assert.rejects(()=>tools.call(name,{...spec,path:'../escape.ecproj'}),/workspace|path|relative|scope/i)
    const plan=translateNeuraleseArtCraftActions({appId:'effectcraft',goal,definitions:tools.definitions,actions:[{name,args:spec}]})
    const receipts=await dispatchNeuraleseArtCraftPlan({plan,tools,goal})
    assert.equal(receipts.length,1)
    assert.equal(previews.length,2)
    assert.notEqual(previews[0].data,previews[1].data)
    assert.match(receipts[0].result.content[0].text,/two verified position keys/)
    assert.match(receipts[0].result.content[0].text,/No video was exported/)
    const output=path.join(workspaceRoot,'integrations/artcraft/workspaces/app-sandboxes/effectcraft/outputs/motion.ecproj')
    const before=readFileSync(output)
    await assert.rejects(()=>tools.call(name,spec),/existing projects are preserved/)
    assert.deepEqual(readFileSync(output),before)
  } finally {await tools.close();rmSync(workspaceRoot,{recursive:true,force:true})}
})

test('one typed DeckCraft request saves and reopens real slide content, preserving existing outputs', {timeout:45000},async()=>{
  const workspaceRoot=mkdtempSync(path.join(os.tmpdir(),'nori-deck-workflow-'))
  const goal='Create a new text presentation in DeckCraft and save it.'
  const tools=await createNoriArtCraftMcpTools('deckcraft',{noriRoot:'C:/Nori',workspaceRoot,goal,artifactWorkflows:true})
  const name='artcraft_deckcraft_create_presentation',args={slides:[{title:'NORI_DECK_PROOF',body:'LOCAL_TOOL_WORKFLOW'}],path:'proof.deckcraft'}
  try {
    assert.deepEqual(tools.definitions.map(item=>item.function.name),[name])
    await assert.rejects(()=>tools.call(name,{...args,slides:[]}),/1–10 slides/)
    const plan=translateNeuraleseArtCraftActions({appId:'deckcraft',goal,definitions:tools.definitions,actions:[{name,args}]})
    const receipts=await dispatchNeuraleseArtCraftPlan({plan,tools,goal})
    assert.match(receipts[0].result.content[0].text,/reopened the file and verified every title\/body/)
    const output=path.join(workspaceRoot,'integrations/artcraft/workspaces/app-sandboxes/deckcraft/outputs/proof.deckcraft')
    const before=readFileSync(output)
    await assert.rejects(()=>tools.call(name,args),/existing presentations are preserved/)
    assert.deepEqual(readFileSync(output),before)
  }finally{await tools.close();rmSync(workspaceRoot,{recursive:true,force:true})}
})

const TASKS = Object.freeze([
  ['photocraft', 'Retouch a photo'],
  ['vectorcraft', 'Create a Subaru WRX illustration'],
  ['filmcraft', 'Create a video project and save it'],
  ['lightcraft', 'Edit a RAW photo and export it'],
  ['pdfcraft', 'Read and summarize a PDF'],
  ['effectcraft', 'Create a motion graphic'],
  ['designcraft', 'Create a brochure'],
  ['figcraft', 'Create a UI wireframe'],
  ['wordcraft', 'Write a Word report'],
  ['soundcraft', 'Mix audio'],
  ['deckcraft', 'Create a slide presentation'],
  ['cadcraft', 'Draw and render a CAD blueprint'],
  ['gridcraft', 'Create a spreadsheet'],
])

test('ArtCraft MCP adapter and qualification probe share each CLI’s supported confinement flags', () => {
  for (const appId of ['photocraft', 'vectorcraft', 'effectcraft', 'wordcraft', 'soundcraft']) {
    assert.deepEqual(artcraftMcpLaunchConfig(appId, 'APP', 'OUT'), {
      args: ['mcp', '--automation-read-root', 'APP', '--automation-write-root', 'OUT'],
      serverScope: 'two-root-scoped',
    })
  }
  assert.deepEqual(artcraftMcpLaunchConfig('pdfcraft', 'APP', 'OUT'), {
    args: ['mcp', '--root', 'APP', '--compact'], serverScope: 'single-root-scoped',
  })
  for (const appId of ['filmcraft', 'lightcraft', 'designcraft', 'figcraft', 'deckcraft', 'cadcraft', 'gridcraft']) {
    assert.deepEqual(artcraftMcpLaunchConfig(appId, 'APP', 'OUT'), {
      args: ['mcp'], serverScope: 'nori-path-scoped',
    })
  }
  assert.throws(() => artcraftMcpLaunchConfig('othercraft', 'APP', 'OUT'), /Unknown ArtCraft MCP app/)
})

test('all installed ArtCraft MCP apps expose task-matched tools within Nori prompt bounds', { timeout: 120_000 }, async () => {
  for (const [appId, goal] of TASKS) {
    const session = await createNoriArtCraftMcpTools(appId, { noriRoot: 'C:/Nori', goal })
    try {
      assert.equal(isNoriArtCraftMcpScoped(appId), true, appId)
      assert.ok(session.definitions.length > 0, appId)
      assert.ok(Buffer.byteLength(JSON.stringify(session.definitions), 'utf8') <= 2700, appId)
      assert.ok(session.definitions.some(({ function: item }) => noriArtCraftMcpToolMatchesUserIntent(item.name, goal)), appId)
    } finally {
      await session.close()
    }
  }
})

test('DeckCraft uses compact Nori-owned descriptions to stay within the model contract budget', { timeout: 30_000 }, async () => {
  const session = await createNoriArtCraftMcpTools('deckcraft', {
    noriRoot: 'C:/Nori', goal: 'Create a slide presentation',
  })
  try {
    const descriptions = Object.fromEntries(session.definitions.map(({ function: item }) => [item.name, item.description]))
    assert.equal(descriptions.artcraft_deckcraft_new_presentation, 'Start a blank presentation with an optional theme.')
    assert.equal(descriptions.artcraft_deckcraft_add_slide, 'Add a slide with an optional layout, title, and body.')
    assert.ok(Buffer.byteLength(JSON.stringify(session.definitions), 'utf8') <= 2700)
  } finally {
    await session.close()
  }
})

test('EffectCraft exposes bounded creation commands and saves a verified new project', { timeout: 45_000 }, async () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'nori-effectcraft-smoke-'))
  const outputPath = path.join(workspaceRoot, 'integrations', 'artcraft', 'workspaces', 'app-sandboxes',
    'effectcraft', 'outputs', 'nori-effectcraft-smoke.project')
  const session = await createNoriArtCraftMcpTools('effectcraft', {
    noriRoot: 'C:/Nori', workspaceRoot, goal: 'Create a simple motion graphic and save it',
  })
  try {
    const createTool = session.definitions.find(({ function: item }) => item.name === 'artcraft_effectcraft_execute_command')
    assert.ok(createTool)
    assert.deepEqual(createTool.function.parameters.properties.command.enum, ['comp.new', 'layer.newText', 'shape.newShape'])
    await assert.rejects(session.call('artcraft_effectcraft_execute_command', {
      command: 'file.open', params: { path: 'C:/outside.project' },
    }), /creation-safe command set/)
    assert.equal(JSON.parse(await session.call('artcraft_effectcraft_open_project', { new: true })).isError, false)
    assert.equal(JSON.parse(await session.call('artcraft_effectcraft_execute_command', {
      command: 'comp.new', params: { name: 'Nori local smoke', width: 320, height: 240, duration: 1 },
    })).isError, false)
    assert.equal(JSON.parse(await session.call('artcraft_effectcraft_execute_command', {
      command: 'shape.newShape', params: { kind: 'ellipse', size: [120, 80], position: [160, 120], fill: '#7c3aed' },
    })).isError, false)
    assert.equal(JSON.parse(await session.call('artcraft_effectcraft_save_project', {
      path: 'app-sandboxes/effectcraft/outputs/nori-effectcraft-smoke.project',
    })).isError, false)
    assert.ok(existsSync(outputPath))
    assert.ok(statSync(outputPath).size > 0)
  } finally {
    await session.close()
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('EffectCraft position animation saves two keys and renders different frames within the existing prompt budget', { timeout: 45_000 }, async () => {
  const workspaceRoot=mkdtempSync(path.join(os.tmpdir(),'nori-effectcraft-animation-'))
  const previews=[]
  const session=await createNoriArtCraftMcpTools('effectcraft',{
    noriRoot:'C:/Nori',workspaceRoot,goal:'Create a two-second animation with position keyframes and render previews',
    onPreview:preview=>previews.push(preview),
  })
  assert.deepEqual(session.definitions.find(item=>item.function.name.endsWith('_open_project')).function.parameters,
    {type:'object',additionalProperties:false,properties:{new:{type:'boolean',enum:[true]}},required:['new']})
  await assert.rejects(()=>session.call('artcraft_effectcraft_open_project',{path:'missing.ecproj'}), /must start a new project/)
  const action=(suffix,args)=>({name:`artcraft_effectcraft_${suffix}`,args})
  const base=[action('open_project',{new:true}),
    action('execute_command',{command:'comp.new',params:{width:320,height:240,duration:2}}),
    action('execute_command',{command:'shape.newShape',params:{kind:'ellipse'}}),
    ...[[0,40],[2,280]].map(([time,x])=>action('execute_command',{command:'prop.addKey',params:{path:'transform/position',time,value:[x,120]}}))]
  const goal='Create an animation in EffectCraft, save the project, and render previews.'
  const translate=actions=>translateNeuraleseArtCraftActions({appId:'effectcraft',goal,definitions:session.definitions,actions})
  assert.throws(()=>translate(base.slice(0,1)),/Complete the animation graph/)
  assert.throws(()=>translate([base[0],action('execute_command',{command:'comp.new',params:{kind:'ellipse'}})]),/comp.new accepts only parameters/)
  assert.throws(()=>translate(base),/omitted the requested save_project/)
  const saved=[...base,action('save_project',{path:'nori-animation.ecproj'})]
  assert.throws(()=>translate(saved),/omitted the requested render_preview/)
  assert.equal(translate([...saved,action('render_preview',{comp:1,time:0}),action('render_preview',{comp:1,time:1.9})]).nodes.length,8)
  const call=async(name,args)=>{
    const value=JSON.parse(await session.call(`artcraft_effectcraft_${name}`,args))
    assert.equal(value.isError,false,JSON.stringify(value))
    return value
  }
  try {
    assert.ok(Buffer.byteLength(JSON.stringify(session.definitions))<=2700)
    await call('open_project',{new:true})
    await call('execute_command',{command:'comp.new',params:{name:'Nori animation',width:320,height:240,duration:2,frameRate:24}})
    await call('execute_command',{command:'shape.newShape',params:{kind:'ellipse',size:[40,40],position:[40,120],fill:'#30aaff'}})
    for(const [time,x] of [[0,40],[2,280]])
      await call('execute_command',{command:'prop.addKey',params:{path:'transform/position',time,value:[x,120]}})
    await assert.rejects(session.call('artcraft_effectcraft_execute_command',{
      command:'prop.addKey',params:{path:'expression',time:0,value:[1,2]},
    }),/position keyframes/)
    await call('save_project',{path:'nori-animation.ecproj'})
    const project=JSON.parse(readFileSync(path.join(workspaceRoot,'integrations/artcraft/workspaces/app-sandboxes/effectcraft/outputs/nori-animation.ecproj'),'utf8'))
    const keyed=[]
    const visit=value=>{if(!value||typeof value!=='object')return;if(value.match==='position'&&value.keys?.length===2)keyed.push(value);for(const child of Object.values(value))visit(child)}
    visit(project)
    assert.equal(keyed.length,1)
    assert.deepEqual(keyed[0].keys.map(key=>key.value.v.slice(0,2)),[[40,120],[280,120]])
    const start=await call('render_preview',{comp:'1',time:0,max_side:160})
    const end=await call('render_preview',{comp:'1',time:1.9,max_side:160})
    assert.equal(previews.length,2,'both rendered previews reach the host-owned sink')
    assert.notEqual(previews[0].data,previews[1].data,'the rendered frames must change over time')
    for(const result of [start,end])assert.equal(result.content.find(item=>item.type==='image').data,undefined,'image bytes stay out of text-only model context')
  } finally {await session.close();rmSync(workspaceRoot,{recursive:true,force:true})}
})

test('DesignCraft creates and verifies a text frame before saving in the app sandbox', { timeout: 45_000 }, async () => {
  const workspaceRoot = mkdtempSync(path.join(os.tmpdir(), 'nori-designcraft-smoke-'))
  const outputPath = path.join(workspaceRoot, 'integrations', 'artcraft', 'workspaces', 'app-sandboxes',
    'designcraft', 'outputs', 'nori-designcraft-smoke.designcraft')
  const session = await createNoriArtCraftMcpTools('designcraft', {
    noriRoot: 'C:/Nori', workspaceRoot, goal: 'Create a brochure',
  })
  try {
    const execute = session.definitions.find(({ function: item }) => item.name === 'artcraft_designcraft_execute')
    assert.ok(execute)
    assert.deepEqual(execute.function.parameters.properties.command.enum, ['frame.create'])
    await assert.rejects(session.call('artcraft_designcraft_execute', { command: 'file.open', params: {} }), /creation-safe command set/)
    assert.equal(JSON.parse(await session.call('artcraft_designcraft_new_document', {
      title: 'Nori local smoke', preset: 'A4',
    })).isError, false)
    const createdFrame = JSON.parse(await session.call('artcraft_designcraft_execute', {
      command: 'frame.create', params: { rect: [36, 36, 420, 180], content: 'text', text: 'Nori DesignCraft smoke test' },
    }))
    assert.equal(createdFrame.isError, false)
    const frameData = JSON.parse(createdFrame.content[0].text)
    const story = JSON.parse(await session.call('artcraft_designcraft_get_story', { story: frameData.story }))
    assert.equal(story.isError, false)
    assert.match(story.content[0].text, /Nori DesignCraft smoke test/)
    assert.equal(JSON.parse(await session.call('artcraft_designcraft_save_document', {
      path: 'app-sandboxes/designcraft/outputs/nori-designcraft-smoke.designcraft',
    })).isError, false)
    assert.ok(existsSync(outputPath))
    assert.ok(statSync(outputPath).size > 0)
  } finally {
    await session.close()
    rmSync(workspaceRoot, { recursive: true, force: true })
  }
})

test('portable ArtCraft binaries and writable user workspaces use separate roots', { timeout: 20_000 }, async () => {
  const workspaceRoot=mkdtempSync(path.join(os.tmpdir(),'nori-artcraft-user-data-'))
  const session=await createNoriArtCraftMcpTools('vectorcraft', {
    noriRoot:'C:/Nori',workspaceRoot,goal:'Create a Subaru WRX illustration',
  })
  try {
    assert.equal(session.roots.read,path.join(workspaceRoot,'integrations','artcraft','workspaces','app-sandboxes','vectorcraft'))
    assert.equal(session.roots.write,path.join(workspaceRoot,'integrations','artcraft','workspaces','app-sandboxes','vectorcraft','outputs'))
    assert.match(session.roots.server,/two-root-scoped/)
  }finally{
    await session.close()
    rmSync(workspaceRoot,{recursive:true,force:true})
  }
})

test('export paths and FilmCraft Save As stay inside their app output folders', { timeout: 45_000 }, async () => {
  const deniedCalls = [
    ['lightcraft', 'Export images', 'artcraft_lightcraft_export', { path: '../outside.jpg' }, /invalid path component/],
    ['lightcraft', 'Export images', 'artcraft_lightcraft_export', { format: 'jpeg' }, /explicit output path/],
    ['cadcraft', 'Draw and render a CAD blueprint', 'artcraft_cadcraft_render', { path: '../outside.png' }, /invalid path component/],
    ['filmcraft', 'Create a video project and save it', 'artcraft_filmcraft_command_run',
      { id: 'file.saveAs', params: { path: '../outside.project' } }, /invalid path component/],
  ]

  for (const [appId, goal, toolName, args, expectedError] of deniedCalls) {
    const session = await createNoriArtCraftMcpTools(appId, { noriRoot: 'C:/Nori', goal })
    try {
      await assert.rejects(session.call(toolName, args), expectedError, `${appId} ${toolName}`)
    } finally {
      await session.close()
    }
  }
})
