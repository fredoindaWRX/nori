// The living detail of the city inside Nori (owner, 2026-11-15: "show labels, very detailed, exactly like the
// clip, you see them generating through everything inside of it"):
//   - her memory blocks are part of the structure: dark cubes with a thin lit frame and a few data lights
//   - a small sign over the nearest few (kind, day, first words; only the hash while she is streaming)
//   - a recalled memory becomes a blazing stack of orange slabs that lights the blocks around it; while one
//     burns, only its own sign shows
//   - light pulses run along the links between memories
//   - blocks assemble as the camera nears them, so the city builds itself as she flies in
// Everything is GPU work: assembly happens in the vertex shader and nothing is uploaded per frame.

import { blockMesh, HOT_LIGHTS, KIND } from './city-structure.js'
import { BLOCK_GAP } from './memory-city.js'
import { buildAtlas, cardFamily, drawFocus, FOCUS, GRID, SLOTS } from './city-cards.js'

// Neon city (owner, 2026-11-23: "maybe we can make it like a tron city"): every kind of block has its own cool light,
// so the city reads at a glance. Blues, whites and violets only: he had the orange taken out on 2026-11-17.
export const NEON = Object.freeze({
  talk: [0.25, 0.9, 1.0], page: [0.86, 0.95, 1.0], knight: [0.62, 0.55, 1.0], model: [0.3, 0.55, 1.0], system: [0.3, 1.0, 0.82],
  skill: [0.55, 1.0, 0.78], folder: [0.6, 0.8, 1.0], project: [0.78, 0.62, 1.0], score: [0.7, 1.0, 1.0], memory: [0.35, 0.75, 1.0],
})
export const neonOf = block => NEON[cardFamily(block)] ?? NEON.memory

function seeded(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296 } }

// What a block's sign says. l is { kind, day, title } when labels are allowed, otherwise absent.
export function labelLines(block) {
  const code = String(block.k || '').toUpperCase()
  if (!block.l) return { top: `MEMORY · ${code}`, title: '' }
  const top = [block.l.kind || 'Memory', block.l.day, code].filter(Boolean).join(' · ').toUpperCase()
  return { top, title: String(block.l.title || '') }
}

// Distance-driven assembly: 0 far away, 1 close. Keeps the far city faint and lets it build in as she flies.
// The cube shader repeats this with the same numbers.
export const assembly = (dist, near = 5.5, far = 15) => (dist <= near ? 1 : dist >= far ? 0 : 1 - (dist - near) / (far - near))

// Soft round glow drawn behind a recalled memory's slab stack.
function glowCanvas() {
  const size = 128, c = document.createElement('canvas'); c.width = c.height = size
  const g = c.getContext('2d'), fill = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  fill.addColorStop(0, 'rgba(255,225,150,1)'); fill.addColorStop(0.18, 'rgba(255,150,40,0.7)'); fill.addColorStop(0.5, 'rgba(255,80,0,0.2)'); fill.addColorStop(1, 'rgba(255,60,0,0)')
  g.fillStyle = fill; g.fillRect(0, 0, size, size)
  return c
}

// The district each group of memories stands in: a floor of small dark rooftops under the memories, walls behind
// and beside them, and a thin shelf under every memory block. A few blocks carry pinprick windows, very few glow.
// Pure maths: returns the same cell arrays as structureCells(). keep (0..1) thins it out on weak renderers.
export function districtCells(plan, blocks, keep = 1) {
  const rand = seeded(0xd157), P = [], S = [], K = [], G = [], seeds = []
  const put = (x, y, z, sx, sy, sz, k, g) => { P.push(x, y, z); S.push(sx, sy, sz); K.push(k); G.push(g); seeds.push(rand()) }
  const lit = (share, x, y, z, sx, sy, sz) => {
    const q = rand()
    if (q < share * 0.12) put(x, y, z, sx, sy, sz, KIND.cyan, 0.2 + rand() * rand() * 0.6)
    else if (q < share * 0.12 + 0.012) put(x, y, z, sx, sy, sz, KIND.warm, 0.5 + rand() * 0.5)
    else if (q < share * 0.12 + 0.34) { const c = rand(); put(x, y, z, sx, sy, sz, c < 0.5 ? KIND.cyan : c < 0.9 ? KIND.white : c < 0.95 ? KIND.green : KIND.red, 0) }
    else put(x, y, z, sx, sy, sz, KIND.dark, 0)
  }
  const p = 0.13
  for (const sector of plan.sectors) {
    const w = sector.cols * BLOCK_GAP, d = sector.depth * BLOCK_GAP, h = Math.max(sector.height, BLOCK_GAP)
    const cx = sector.center[0], y0 = sector.center[1] - 0.24, cz = sector.center[2] - (sector.depth - 1) * BLOCK_GAP / 2, out = cx >= 0 ? 1 : -1
    const U = Math.ceil((w / 2 + 1.2) / p), V = Math.ceil((d / 2 + 1.1) / p)
    for (let u = -U; u <= U; u++) for (let v = -V; v <= V; v++) {
      if (rand() > keep * 0.94) continue
      // Lower and darker towards the rim, so the district fades into the structure.
      const rim = Math.max(Math.abs(u) / U, Math.abs(v) / V), tall = 0.1 + rand() * rand() * 0.45, top = y0 - rim * rim * 0.6 - rand() * rand() * 0.2
      lit(0.5 - 0.3 * rim, cx + u * p, top - tall / 2, cz + v * p, p * 0.92, tall, p * 0.92)
    }
    const rows = Math.ceil((h + 1.1) / p)
    // Wall behind the memories.
    for (let u = -U; u <= U; u++) for (let r = 0; r < rows; r++) {
      if (rand() > keep * (0.8 - 0.3 * r / rows)) continue
      const wide = rand() < 0.25 ? 2 : 1
      lit(0.2, cx + (u + (wide - 1) / 2) * p, y0 + (r + 0.5) * p, cz - d / 2 - 0.6 - rand() * p, p * (wide - 0.1), p * (rand() < 0.3 ? 0.4 : 0.9), p * (0.5 + rand()))
    }
    // Wall on the side away from the avenue.
    for (let v = -V; v <= V; v++) for (let r = 0; r < rows; r++) {
      if (rand() > keep * (0.7 - 0.3 * r / rows)) continue
      const wide = rand() < 0.25 ? 2 : 1
      lit(0.2, cx + out * (w / 2 + 0.65 + rand() * p), y0 + (r + 0.5) * p, cz + (v + (wide - 1) / 2) * p, p * (0.5 + rand()), p * (rand() < 0.3 ? 0.4 : 0.9), p * (wide - 0.1))
    }
  }
  // Shelves: every memory block sits on a plate with a post down to the next one.
  for (const b of blocks) {
    put(b.pos[0], b.pos[1] - 0.155, b.pos[2], 0.34, 0.03, 0.34, KIND.dark, 0)
    put(b.pos[0] - 0.15, b.pos[1] - BLOCK_GAP / 2, b.pos[2] - 0.15, 0.03, BLOCK_GAP, 0.03, KIND.dark, 0)
  }
  return { count: K.length, position: new Float32Array(P), scale: new Float32Array(S), kind: new Float32Array(K), seed: new Float32Array(seeds), glow: new Float32Array(G) }
}

// Signs: a small fixed pool, each with its own canvas, drawn when a block takes the slot. No text is kept
// for blocks that are not on screen.
const MAX_SIGNS = 3, HOT_SIGNS = 2, CELL_W = 512, CELL_H = 104

function drawLabel(g, block) {
  const { top, title } = labelLines(block)
  g.clearRect(0, 0, CELL_W, CELL_H)
  g.fillStyle = 'rgba(3,10,16,0.72)'; g.fillRect(2, 2, CELL_W - 4, CELL_H - 4)
  g.strokeStyle = 'rgba(110,170,190,0.6)'; g.lineWidth = 2; g.strokeRect(3, 3, CELL_W - 6, CELL_H - 6)
  g.fillStyle = 'rgba(120,190,210,0.85)'; g.fillRect(3, 3, 5, CELL_H - 6)
  g.textBaseline = 'top'
  g.font = 'bold 19px Consolas, "Cascadia Mono", monospace'; g.fillStyle = 'rgba(130,195,215,1)'
  g.fillText(top.slice(0, 40), 20, 12)
  g.font = '600 24px "Segoe UI", system-ui, sans-serif'; g.fillStyle = 'rgba(215,232,238,1)'
  // Up to two lines of her words.
  const words = title.split(' '), lines = ['']
  for (const w of words) { const next = (lines[lines.length - 1] + ' ' + w).trim(); if (g.measureText(next).width > CELL_W - 36 && lines[lines.length - 1]) { if (lines.length === 2) { lines[1] += '…'; break } lines.push(w) } else lines[lines.length - 1] = next }
  lines.forEach((line, i) => g.fillText(line, 20, 40 + i * 28))
}

export function createCityDetail(THREE, { plan, blocks, additive, count }) {
  const group = new THREE.Group(), disposables = []
  const keep = x => { disposables.push(x); return x }
  const N = blocks.length

  // The district the memories stand in, drawn with the structure's own block shader.
  // 2026-11-23 (owner: "everything inside it should be meaningful, nothing else"): the filler that used to stand
  // round the memories (rooftops, walls, shelves, posts) is not built. Only blocks that are something are drawn.

  // Memory blocks: the same dark cubes as the structure, with a thin lit frame and a few scrolling data lights.
  // aState is (recalled 0..1, tint). Size, rise and brightness come from the distance to the camera, in the shader.
  const size = 0.26, state = new Float32Array(N * 2)
  blocks.forEach((b, i) => { state[i * 2 + 1] = (parseInt(b.k.slice(4, 8), 16) % 100) / 100 })
  const cubeGeo = keep(new THREE.BoxGeometry(size, size, size))
  const stateAttr = new THREE.InstancedBufferAttribute(state, 2); cubeGeo.setAttribute('aState', stateAttr)
  const tint = new Float32Array(N * 3); blocks.forEach((b, i) => tint.set(neonOf(b), i * 3))
  cubeGeo.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3))
  const cubeMat = keep(new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uAtlas: { value: null }, uFocus: { value: null }, uGrid: { value: GRID }, uCards: { value: 1 }, uSlots: { value: SLOTS }, uFocusId: { value: -1 } },
    transparent: true,
    vertexShader: [
      'attribute vec2 aState;attribute vec3 aTint;uniform float uT;uniform float uFocusId;varying vec2 vUv;varying vec3 vN;varying vec3 vC;varying float vId;varying float vDepth;varying float vLit;varying vec3 vV;',
      'void main(){vUv=uv;vN=normal;vId=float(gl_InstanceID);vLit=aState.x;',
      '  vec3 c=instanceMatrix[3].xyz;float build=clamp(1.0-(distance(c,cameraPosition)-5.5)/9.5,0.0,1.0);',
      // A recalled block stands a little larger and lights up; a far one is small and sits low. (Until 2026-11-17 it
      // shrank to a red core inside an orange slab stack; the owner had the stack taken out.)
      // The block the owner has pulled out stands full size and larger, whatever its distance.
      '  float held=1.0-step(0.5,abs(float(gl_InstanceID)-uFocusId));build=max(build,held);',
      // Neon city: far blocks keep more of their size and light, so the far districts read as lit outlines.
      '  float s=(0.5+0.5*build)*(1.0+0.14*aState.x)*(1.0+1.1*held);vec3 wp=c+position*s;wp.y-=(1.0-build)*0.25;vV=cameraPosition-wp;',
      '  float pulse=0.75+0.25*sin(uT*6.0);',
      '  vC=mix(aTint*(0.85+0.3*aState.y),vec3(0.85,0.98,1.0),aState.x*0.7)*(0.7+0.5*build)*(1.0+aState.x*pulse*0.9);',
      '  vec4 mv=modelViewMatrix*vec4(wp,1.0);vDepth=-mv.z;gl_Position=projectionMatrix*mv;}',
    ].join('\n'),
    fragmentShader: [
      'uniform float uT;varying vec2 vUv;varying vec3 vN;varying vec3 vC;varying float vId;varying float vDepth;varying float vLit;varying vec3 vV;',
      'uniform sampler2D uAtlas;uniform sampler2D uFocus;uniform float uGrid;uniform float uCards;uniform float uSlots;uniform float uFocusId;',
      'float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
      // One card of this block from the atlas (city-cards.js). n: which of its cards.
      'vec4 card(float n,vec2 uv){float t=mod(vId*uCards+n,uSlots);vec2 cell=vec2(mod(t,uGrid),floor(t/uGrid));uv=uv*0.98+0.01;return texture2D(uAtlas,vec2((cell.x+uv.x)/uGrid,1.0-(cell.y+1.0-uv.y)/uGrid));}',
      'void main(){',
      '  vec2 e=min(vUv,1.0-vUv);float d=min(e.x,e.y);float px=fwidth(vUv.x)+fwidth(vUv.y);',
      // The neon outline: never thinner than about a pixel and a half, however far the block is.
      '  float fw=max(0.03,px*1.5);float frame=1.0-smoothstep(fw,fw+px,d);',
      '  float panel=smoothstep(0.1,0.1+px,d);',
      '  float shade=0.4+0.6*max(vN.y,0.0)+0.3*max(vN.z,0.0)+0.12*abs(vN.x);',
      // Data: a few short lit dashes in rows, scrolling slowly, different on every block.
      '  vec2 g=vec2(vUv.x*9.0,vUv.y*13.0+uT*0.5+vId*0.37);vec2 id=floor(g);vec2 q=fract(g);',
      '  float a=h2(id+vId*3.1),b=h2(id.yx*1.3+vId);',
      '  float dash=step(0.74,a)*smoothstep(0.1,0.2,q.x)*smoothstep(0.95,0.85,q.x)*smoothstep(0.25,0.35,q.y)*smoothstep(0.75,0.65,q.y)*(0.3+0.7*b);',
      // Far away the dashes become a flat tone sooner (2026-11-23): hard-edged cells smaller than a pixel flickered.
      '  float data=mix(dash,0.07,smoothstep(0.12,0.5,fwidth(g.y)));',
      // Near-black body, bright outline in the block's own light.
      '  vec3 col=vec3(0.012,0.02,0.026)*shade+vC*0.025*shade;',
      '  col+=vC*panel*data*(0.9+0.6*vLit)*shade;',
      '  col+=(vC*(1.25+0.9*vLit)+vec3(0.25)*dot(vC,vec3(0.34)))*frame*(0.65+0.35*shade);',
      // Glass: close up each face is a see-through pane showing the block's cards, one after another; each face runs
      // on its own clock. Far away, where a card would be a smudge, the block stays the dark data cube it was.
      '  float focus=1.0-step(0.5,abs(vId-uFocusId));',
      '  float nearCard=max(focus,1.0-smoothstep(0.035,0.08,px));float glassy=max(focus,1.0-smoothstep(0.05,0.13,px));',
      '  vec2 cu=(vUv-0.035)/0.93;float inCard=step(0.0,cu.x)*step(cu.x,1.0)*step(0.0,cu.y)*step(cu.y,1.0);',
      '  float side=step(0.5,abs(vN.x))+2.0*step(0.5,abs(vN.y));',
      '  float ph=uT*0.16+vId*0.37+side*0.41;float k=floor(ph);float f=smoothstep(0.86,1.0,fract(ph));',
      '  vec4 ca=card(mod(k+side,uCards),cu);vec4 cb=card(mod(k+side+1.0,uCards),cu);',
      '  if(focus>0.5){ca=texture2D(uFocus,vec2((mod(k+side,2.0)+cu.x)*0.5,cu.y));cb=texture2D(uFocus,vec2((mod(k+side+1.0,2.0)+cu.x)*0.5,cu.y));}',
      '  vec4 cc=mix(ca,cb,f);',
      // The change from one card to the next runs down the face as a bright line.
      '  float sweep=smoothstep(0.03,0.0,abs(cu.y-(1.0-f)))*step(0.001,f)*step(f,0.999);',
      '  float fres=pow(1.0-abs(dot(normalize(vV),vN)),3.0);',
      '  float show=cc.a*nearCard*inCard;',
      '  col=mix(col,vec3(0.03,0.085,0.115)*shade+vC*0.13,glassy*(1.0-frame));',
      '  col=mix(col,cc.rgb*(1.7+0.5*vLit+0.4*focus)*(0.75+0.25*shade),show*0.96*(1.0-frame));',
      '  col+=vC*(fres*0.55+sweep*inCard*nearCard*0.9)*glassy;',
      '  float alpha=mix(1.0,clamp(max(max(frame,show),0.3+0.5*fres+0.25*vLit),0.0,1.0),glassy);',
      '  float fog=clamp((vDepth-9.0)/40.0,0.0,1.0);',
      // Very close blocks fade away so the view passes through them. Until 2026-11-23 the colour was faded instead and
      // the alpha kept, so a block within about 2 units became a black pane (owner: "when you get close ... they turn black").
      '  float nearFade=mix(smoothstep(0.25,0.8,vDepth),1.0,focus);if(alpha*nearFade<0.02)discard;',
      // Distance dims the body, but the outline keeps most of its light.
      '  gl_FragColor=vec4(mix(col,vec3(0.02,0.035,0.045),fog*0.85*(1.0-0.65*frame)),alpha*nearFade);',
      '}',
    ].join('\n'),
  }))
  const cubes = new THREE.InstancedMesh(cubeGeo, cubeMat, N)
  const matrix = new THREE.Matrix4()
  blocks.forEach((b, i) => cubes.setMatrixAt(i, matrix.makeTranslation(b.pos[0], b.pos[1], b.pos[2])))
  cubes.instanceMatrix.needsUpdate = true; cubes.frustumCulled = false; cubes.renderOrder = 5
  group.add(cubes)
  // What shows on the glass: every block's cards in one atlas, and a larger pair for the block pulled out.
  const atlas = buildAtlas(blocks)
  // Mipmaps and anisotropy (2026-11-23): without them a card seen small or at an angle broke into shimmering pixels.
  const atlasTex = keep(new THREE.CanvasTexture(atlas.canvas)); atlasTex.colorSpace = THREE.SRGBColorSpace; atlasTex.generateMipmaps = true; atlasTex.minFilter = THREE.LinearMipmapLinearFilter; atlasTex.anisotropy = 8
  cubeMat.uniforms.uAtlas.value = atlasTex; cubeMat.uniforms.uCards.value = atlas.cards
  const focusCanvas = document.createElement('canvas'); focusCanvas.width = FOCUS * 2; focusCanvas.height = FOCUS
  const focusTex = keep(new THREE.CanvasTexture(focusCanvas)); focusTex.colorSpace = THREE.SRGBColorSpace; focusTex.generateMipmaps = false; focusTex.minFilter = THREE.LinearFilter
  cubeMat.uniforms.uFocus.value = focusTex
  /** The block the owner has pulled out (or -1): it grows and shows its cards large and sharp. */
  function setFocus(index) {
    const i = index >= 0 && index < N ? index : -1
    if (i >= 0) { drawFocus(focusCanvas.getContext('2d'), blocks[i]); focusTex.needsUpdate = true }
    cubeMat.uniforms.uFocusId.value = i
  }

  // The sign pool.
  const POOL = MAX_SIGNS + HOT_SIGNS, sprites = [], slots = []
  for (let s = 0; s < POOL; s++) {
    const canvas = document.createElement('canvas'); canvas.width = CELL_W; canvas.height = CELL_H
    const tex = keep(new THREE.CanvasTexture(canvas)); tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter
    const sprite = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: true, depthFunc: THREE.AlwaysDepth, alphaTest: 0.06, opacity: 0 })))
    sprite.scale.set(0.95, 0.95 * CELL_H / CELL_W, 1)
    // Signs draw over the blocks so they can always be read, and write depth so the soft focus keeps them sharp.
    sprite.visible = false; sprite.renderOrder = 20
    group.add(sprite); sprites.push(sprite); slots.push({ sprite, tex, g: canvas.getContext('2d'), block: -1, hot: false })
  }

  // Links: within a district each memory to the next, and a trunk line from district to district.
  const linkPos = [], linkT = [], linkSeed = []
  const link = (a, b, seed, t0 = 0, t1 = 1) => { linkPos.push(...a, ...b); linkT.push(t0, t1); linkSeed.push(seed, seed) }
  // No block-to-block or area-to-area lines: the order of blocks in an area means nothing, so a line between
  // neighbours would say something that is not true. Each area has one strand, to her brain.
  // Her lines to the outside: each district has one running up and out of the city (owner, 2026-11-17: "if it's
  // inside her brain and it's connected to the internet it should be alive").
  // 2026-11-23 (owner: "what are these lines", then "make it like you was the maker of the ultron movie"): the
  // uplinks no longer run off into empty space. They rise to one bright core hanging over the city, so the city
  // reads as a mind: a living centre with a strand of light down to every district.
  const uplinkFrom = linkPos.length / 6
  const corePos = plan.centre ? [plan.centre[0], plan.centre[1], plan.centre[2]] : [0, 0, -18], cityMid = corePos
  let cityReach = 1
  plan.sectors.forEach(sector => { const m = sector.middle || sector.center; cityReach = Math.max(cityReach, Math.hypot(m[0] - corePos[0], m[1] - corePos[1], m[2] - corePos[2])) })
  plan.sectors.forEach((sector, i) => { link(sector.middle || sector.center, corePos, (i * 0.173) % 1) })
  // Traffic: small bright packets riding the links. Each one's place is worked out in the vertex shader.
  const pkA = [], pkB = [], pkSeed = []
  for (let s = 0; s < linkPos.length / 6; s++) {
    const up = s >= uplinkFrom, many = up ? 9 : 1
    for (let n = 0; n < many; n++) { pkA.push(linkPos[s * 6], linkPos[s * 6 + 1], linkPos[s * 6 + 2]); pkB.push(linkPos[s * 6 + 3], linkPos[s * 6 + 4], linkPos[s * 6 + 5]); pkSeed.push(((s * 0.6180339 + n / many) % 1), up ? (n % 2 ? -1 : 1) * (1.2 + (s % 4) * 0.25) : (s % 3 === 0 ? -0.5 : 0.5)) }
  }
  const pkGeo = keep(new THREE.BufferGeometry())
  pkGeo.setAttribute('position', new THREE.Float32BufferAttribute(pkA, 3)); pkGeo.setAttribute('aTo', new THREE.Float32BufferAttribute(pkB, 3)); pkGeo.setAttribute('aSeed', new THREE.Float32BufferAttribute(pkSeed, 2))
  const pkMat = keep(new THREE.ShaderMaterial(additive({
    uniforms: { uT: { value: 0 }, uPx: { value: 1 } },
    vertexShader: 'attribute vec3 aTo;attribute vec2 aSeed;uniform float uT;uniform float uPx;varying float vA;varying float vUp;void main(){float f=fract(aSeed.x+uT*0.22*aSeed.y);vec3 p=mix(position,aTo,f);vec4 mv=modelViewMatrix*vec4(p,1.0);vUp=step(1.0,abs(aSeed.y));vA=smoothstep(0.0,0.08,f)*smoothstep(1.0,0.9,f)*clamp(1.0-(-mv.z-6.0)/55.0,0.12,1.0);gl_PointSize=clamp((vUp>0.5?46.0:30.0)/-mv.z,1.5,9.0)*uPx;gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'varying float vA;varying float vUp;void main(){float r=length(gl_PointCoord-vec2(0.5));float core=smoothstep(0.5,0.08,r);gl_FragColor=vec4(mix(vec3(0.6,0.95,1.0),vec3(1.0,1.0,1.0),core)*core,core*vA);}',
  })))
  const packets = new THREE.Points(pkGeo, pkMat); packets.frustumCulled = false; packets.renderOrder = 12
  packets.onBeforeRender = renderer => { const rt = renderer.getRenderTarget(); pkMat.uniforms.uPx.value = rt ? Math.max(1, rt.height / Math.max(1, renderer.domElement.height)) : 1 }
  group.add(packets)
  // Filaments: every link is a small bundle of fine threads that waver round a brighter core thread, instead of
  // one bare line. The strands meet at both ends, bow out in between and shimmer; the strands to the core are
  // thicker bundles with more sway. Built once; the motion is in the vertex shader.
  const filPos = [], filJit = [], filInfo = [], filRand = seeded(0xf11a)
  for (let s = 0; s < linkPos.length / 6; s++) {
    const a = [linkPos[s * 6], linkPos[s * 6 + 1], linkPos[s * 6 + 2]], b = [linkPos[s * 6 + 3], linkPos[s * 6 + 4], linkPos[s * 6 + 5]]
    const up = s >= uplinkFrom, length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    const strands = up ? 7 : 3, pieces = up ? Math.max(10, Math.min(28, Math.round(length / 1.4))) : Math.max(2, Math.min(5, Math.round(length / 0.25)))
    const sway = up ? Math.min(1.1, 0.25 + length * 0.018) : Math.min(0.05, length * 0.12)
    const t0 = linkT[s * 2], t1 = linkT[s * 2 + 1], seed = linkSeed[s * 2]
    for (let k = 0; k < strands; k++) {
      const core = k === 0 ? 1 : 0, nodes = []
      for (let j = 0; j <= pieces; j++) {
        // No sway at the ends, most in the middle; the core thread barely moves.
        const f = j / pieces, bow = Math.sin(Math.PI * f) * sway * (core ? 0.18 : 1)
        nodes.push({ p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f], j: [(filRand() - 0.5) * 2 * bow, (filRand() - 0.5) * 2 * bow, (filRand() - 0.5) * 2 * bow], t: t0 + (t1 - t0) * f, ph: filRand() * 6.283 })
      }
      for (let j = 0; j < pieces; j++) for (const n of [nodes[j], nodes[j + 1]]) { filPos.push(...n.p); filJit.push(...n.j); filInfo.push(n.t, seed + k * 0.071, core + (up ? 2 : 0), n.ph) }
    }
  }
  const linkGeo = keep(new THREE.BufferGeometry())
  linkGeo.setAttribute('position', new THREE.Float32BufferAttribute(filPos, 3)); linkGeo.setAttribute('aJit', new THREE.Float32BufferAttribute(filJit, 3))
  linkGeo.setAttribute('aInfo', new THREE.Float32BufferAttribute(filInfo, 4))
  // uPx: internal pixels per window pixel. Lines are one internal pixel wide, so they are made brighter to match.
  // aInfo: place along the route, seed, kind (1 core thread, +2 a strand to the core), phase of its sway.
  const linkMat = keep(new THREE.ShaderMaterial(additive({
    uniforms: { uT: { value: 0 }, uPx: { value: 1 } },
    vertexShader: 'attribute vec3 aJit;attribute vec4 aInfo;uniform float uT;varying float vT;varying float vS;varying float vF;varying float vK;void main(){vT=aInfo.x;vS=aInfo.y;vK=aInfo.z;float sway=0.55+0.45*sin(uT*(0.9+fract(aInfo.y*7.3)*1.6)+aInfo.w);vec3 p=position+aJit*sway;vec4 mv=modelViewMatrix*vec4(p,1.0);vF=clamp(1.0-(-mv.z-4.0)/(vK>1.5?140.0:30.0),0.15,1.0);gl_Position=projectionMatrix*mv;}',
    fragmentShader: [
      'uniform float uT;uniform float uPx;varying float vT;varying float vS;varying float vF;varying float vK;',
      'void main(){',
      '  float up=step(1.5,vK);float core=step(0.5,mod(vK,2.0));',
      // A run of light along the route (down from the core on the big strands), and a fast crackle per thread.
      '  float p=fract(vT*mix(1.5,3.0,up)-uT*mix(0.4,0.3,up)+vS);float pulse=smoothstep(1.0,0.97,p)*smoothstep(0.45,0.97,p);',
      '  float crackle=0.72+0.28*sin(uT*19.0+vS*91.0+vT*37.0);',
      '  vec3 col=mix(vec3(0.08,0.6,0.95),vec3(0.82,0.98,1.0),max(pulse*pulse,core*0.75));',
      '  float a=(0.16+pulse*0.8+core*0.3+up*0.12)*crackle*vF*uPx;',
      '  gl_FragColor=vec4(col,min(1.0,a));',
      '}',
    ].join('\n'),
  })))
  // The core: a soft white-blue light over the city that breathes, where every district's strand ends.
  const coreCanvas = document.createElement('canvas'); coreCanvas.width = coreCanvas.height = 256
  { const g = coreCanvas.getContext('2d'), fill = g.createRadialGradient(128, 128, 0, 128, 128, 128)
    fill.addColorStop(0, 'rgba(255,255,255,1)'); fill.addColorStop(0.06, 'rgba(215,245,255,0.95)'); fill.addColorStop(0.2, 'rgba(70,190,255,0.5)'); fill.addColorStop(0.5, 'rgba(20,110,230,0.14)'); fill.addColorStop(1, 'rgba(0,60,200,0)')
    g.fillStyle = fill; g.fillRect(0, 0, 256, 256) }
  const coreTex = keep(new THREE.CanvasTexture(coreCanvas)); coreTex.colorSpace = THREE.SRGBColorSpace
  const coreSize = 3.4
  const coreLight = new THREE.Sprite(keep(new THREE.SpriteMaterial(additive({ map: coreTex, depthTest: true, fog: false }))))
  coreLight.position.set(corePos[0], corePos[1], corePos[2]); coreLight.scale.setScalar(coreSize); coreLight.renderOrder = 11
  group.add(coreLight)
  // The brain itself: a tesseract (a cube within a cube, joined corner to corner) turning through its fourth
  // dimension, so the inner and outer cubes keep trading places, round the core light. Drawn as light only.
  const TESS4 = 'vec3 tess(vec4 p,float t){float c=cos(t*0.35),s=sin(t*0.35);p=vec4(c*p.x-s*p.w,p.y,p.z,s*p.x+c*p.w);c=cos(t*0.23);s=sin(t*0.23);p=vec4(p.x,c*p.y-s*p.z,s*p.y+c*p.z,p.w);c=cos(t*0.17);s=sin(t*0.17);p=vec4(p.x,p.y,c*p.z-s*p.w,s*p.z+c*p.w);return p.xyz*(2.6/(2.6-p.w));}'
  const tessP = [], tessS = [], tessV = []
  for (let v = 0; v < 16; v++) tessV.push([v & 1 ? 1 : -1, v & 2 ? 1 : -1, v & 4 ? 1 : -1, v & 8 ? 1 : -1])
  for (const scale of [1, 1.012, 0.988, 1.03, 0.6]) for (let v = 0; v < 16; v++) for (let bit = 0; bit < 4; bit++) if (!(v & (1 << bit))) { tessP.push(...tessV[v], ...tessV[v | (1 << bit)]); tessS.push(scale, scale) }
  const tessGeo = keep(new THREE.BufferGeometry())
  tessGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(tessS.length * 3), 3))
  tessGeo.setAttribute('aP', new THREE.Float32BufferAttribute(tessP, 4)); tessGeo.setAttribute('aS', new THREE.Float32BufferAttribute(tessS, 1))
  const tessUniforms = { uT: { value: 0 }, uPx: { value: 1 }, uCenter: { value: new THREE.Vector3(corePos[0], corePos[1], corePos[2]) }, uSize: { value: 0.62 + Math.min(0.9, Math.log2(1 + N / 60) * 0.16) } }   // the brain grows as she holds more
  const tessMat = keep(new THREE.ShaderMaterial(additive({
    uniforms: tessUniforms,
    vertexShader: 'attribute vec4 aP;attribute float aS;uniform float uT;uniform vec3 uCenter;uniform float uSize;varying float vK;varying float vS;' + TESS4 + 'void main(){vec3 q=tess(aP,uT)*uSize*aS;vK=length(q)/(uSize*1.7);vS=aS;gl_Position=projectionMatrix*modelViewMatrix*vec4(uCenter+q,1.0);}',
    fragmentShader: 'uniform float uT;uniform float uPx;varying float vK;varying float vS;void main(){float inner=step(vS,0.8);vec3 col=mix(vec3(0.75,0.95,1.0),vec3(0.15,0.7,1.0),clamp(vK,0.0,1.0));float a=(0.55+0.3*sin(uT*2.3+vK*9.0))*(inner>0.5?0.55:1.0)*uPx;gl_FragColor=vec4(col,min(1.0,a));}',
  })))
  const tesseract = new THREE.LineSegments(tessGeo, tessMat); tesseract.frustumCulled = false; tesseract.renderOrder = 13
  tesseract.onBeforeRender = renderer => { const rt = renderer.getRenderTarget(); tessUniforms.uPx.value = rt ? Math.max(1, rt.height / Math.max(1, renderer.domElement.height)) : 1 }
  group.add(tesseract)
  // Its sixteen corners, as points of light.
  const cornerGeo = keep(new THREE.BufferGeometry())
  cornerGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(16 * 3), 3)); cornerGeo.setAttribute('aP', new THREE.Float32BufferAttribute(tessV.flat(), 4))
  const cornerMat = keep(new THREE.ShaderMaterial(additive({
    uniforms: tessUniforms,
    vertexShader: 'attribute vec4 aP;uniform float uT;uniform float uPx;uniform vec3 uCenter;uniform float uSize;' + TESS4 + 'void main(){vec4 mv=modelViewMatrix*vec4(uCenter+tess(aP,uT)*uSize,1.0);gl_PointSize=clamp(70.0/-mv.z,3.0,16.0)*uPx;gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'void main(){float r=length(gl_PointCoord-vec2(0.5));float c=smoothstep(0.5,0.0,r);gl_FragColor=vec4(mix(vec3(0.2,0.75,1.0),vec3(1.0),c*c)*c,c);}',
  })))
  const corners = new THREE.Points(cornerGeo, cornerMat); corners.frustumCulled = false; corners.renderOrder = 14
  group.add(corners)
  // (The drifting motes of the first version stood for nothing and were taken out, 2026-11-23.)
  // The lit grid under every area: its own footprint, one cell per block. Lines are drawn in the shader, so they
  // stay thin at any distance.
  const gridPos = [], gridUv = [], gridIdx = []
  plan.sectors.forEach((sector, i) => {
    const w = sector.cols * BLOCK_GAP / 2 + 0.45, d = sector.depth * BLOCK_GAP / 2 + 0.45
    const cx = sector.center[0], y = sector.center[1] - 0.17, cz = sector.center[2] - (sector.depth - 1) * BLOCK_GAP / 2
    gridPos.push(cx - w, y, cz - d, cx + w, y, cz - d, cx + w, y, cz + d, cx - w, y, cz + d)
    gridUv.push(-1, -1, 1, -1, 1, 1, -1, 1); gridIdx.push(i * 4, i * 4 + 2, i * 4 + 1, i * 4, i * 4 + 3, i * 4 + 2)
  })
  const gridGeo = keep(new THREE.BufferGeometry())
  gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPos, 3)); gridGeo.setAttribute('uv', new THREE.Float32BufferAttribute(gridUv, 2)); gridGeo.setIndex(gridIdx)
  const gridMat = keep(new THREE.ShaderMaterial(additive({
    uniforms: { uT: { value: 0 }, uCell: { value: BLOCK_GAP } }, side: THREE.DoubleSide,
    vertexShader: 'varying vec3 vW;varying vec2 vUv;varying float vD;void main(){vUv=uv;vW=position;vec4 mv=modelViewMatrix*vec4(position,1.0);vD=-mv.z;gl_Position=projectionMatrix*mv;}',
    fragmentShader: [
      'uniform float uT;uniform float uCell;varying vec3 vW;varying vec2 vUv;varying float vD;',
      'void main(){',
      '  vec2 g=vW.xz/uCell;vec2 w=fwidth(g);vec2 a=abs(fract(g-0.5)-0.5)/max(w,vec2(1e-4));',
      '  float line=1.0-min(min(a.x,a.y)/1.8,1.0);',
      '  float fine=1.0-smoothstep(0.35,0.9,max(w.x,w.y));',
      '  float edge=smoothstep(1.0,0.82,max(abs(vUv.x),abs(vUv.y)));',
      '  float wave=0.6+0.4*sin(length(vUv)*7.0-uT*1.1);',
      '  float far=clamp(1.0-(vD-6.0)/60.0,0.2,1.0);',
      '  float light=min(1.0,(line*fine*wave+0.05*(1.0-fine))*edge*far*2.2);',
      '  gl_FragColor=vec4(vec3(0.12,0.75,1.0)*light,light);',
      '}',
    ].join('\n'),
  })))
  const grid = new THREE.Mesh(gridGeo, gridMat); grid.frustumCulled = false; grid.renderOrder = 3
  group.add(grid)
  // Names: every area carries its category and how many things are in it, and her brain carries the totals. The
  // numbers are the real counts, so the signs change as she learns.
  const nameSign = (lines, width, colour) => {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256
    const g = canvas.getContext('2d'); g.textAlign = 'center'; g.textBaseline = 'middle'
    g.shadowColor = 'rgba(40,190,255,0.9)'; g.shadowBlur = 18
    g.font = '700 92px "Segoe UI", system-ui, sans-serif'; g.fillStyle = colour; g.fillText(lines[0].slice(0, 22), 512, 96, 990)
    g.shadowBlur = 8; g.font = '600 50px Consolas, "Cascadia Mono", monospace'; g.fillStyle = 'rgba(170,230,250,0.95)'; g.fillText(lines[1].slice(0, 36), 512, 196, 990)
    const tex = keep(new THREE.CanvasTexture(canvas)); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8
    const sprite = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false })))
    sprite.scale.set(width, width / 4, 1); sprite.renderOrder = 21
    group.add(sprite)
    return sprite
  }
  const many = (n, one, more) => `${n} ${n === 1 ? one : more}`
  plan.sectors.forEach(sector => {
    const title = String(sector.title || 'Memories').toUpperCase(), top = sector.center[1] + (sector.height || 0) + 0.55
    const tintOf = blocks.find(b => b.sector === sector.id), c = tintOf ? neonOf(tintOf) : NEON.memory
    const sign = nameSign([title, many(sector.count, 'block', 'blocks')], Math.max(2.4, Math.min(5, sector.cols * BLOCK_GAP + 1.4)), `rgb(${c.map(v => Math.round(120 + v * 135)).join(',')})`)
    sign.position.set(sector.center[0], top, sector.center[2] - (sector.depth - 1) * BLOCK_GAP / 2)
  })
  const brainSign = nameSign(['NORI', `${many(N, 'thing', 'things')} held · ${many(plan.sectors.length, 'area', 'areas')}`], 3.6, 'rgb(235,250,255)')
  brainSign.position.set(corePos[0], corePos[1] + 1.9 + Math.log2(1 + N / 60) * 0.12, corePos[2])
  const links = new THREE.LineSegments(linkGeo, linkMat)
  links.onBeforeRender = renderer => { const rt = renderer.getRenderTarget(); linkMat.uniforms.uPx.value = rt ? Math.max(1, rt.height / Math.max(1, renderer.domElement.height)) : 1 }
  group.add(links)

  // A recalled memory: a big stack of blazing orange slabs with ragged ends, white-yellow in the middle, with a
  // wide glow behind it. Slabs breathe in the shader, so their matrices only change when the recalled set does.
  const SLABS = 15, MAX_HOT = 12, STACK_W = 1.0, STACK_H = 0.78
  const slabGeo = keep(new THREE.BoxGeometry(1, 1, 1)), slabInfo = new Float32Array(SLABS * MAX_HOT * 2), slabRand = seeded(0x51ab)
  for (let i = 0; i < SLABS * MAX_HOT; i++) { slabInfo[i * 2] = ((i % SLABS) / (SLABS - 1)) * 2 - 1; slabInfo[i * 2 + 1] = slabRand() }
  slabGeo.setAttribute('aSlab', new THREE.InstancedBufferAttribute(slabInfo, 2))
  const slabMat = keep(new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 } },
    vertexShader: 'attribute vec2 aSlab;uniform float uT;varying vec3 vL;varying vec3 vN;varying vec2 vS;void main(){vN=normal;vS=aSlab;vL=position*2.0;vec3 p=position;p.x*=1.0+0.05*sin(uT*(1.5+aSlab.y*3.0)+aSlab.y*30.0);gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(p,1.0);}',
    fragmentShader: [
      'uniform float uT;varying vec3 vL;varying vec3 vN;varying vec2 vS;',
      'float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
      'void main(){',
      // Heat falls off from the middle of the stack towards its ends, top and bottom.
      '  float across=abs(vN.z)>0.5?vL.x:abs(vN.x)>0.5?vL.z:max(abs(vL.x),abs(vL.z));',
      '  float r=length(vec2(across*0.62,vS.x*0.55));',
      '  float streak=h2(vec2(floor(across*11.0+vS.y*31.0),vS.y*7.0));',
      '  float flick=0.84+0.16*sin(uT*(2.5+vS.y*5.0)+vS.y*40.0);',
      '  float heat=clamp((1.08-r)*1.15+(streak-0.5)*0.35+(vS.y-0.5)*0.3,0.0,1.0)*flick;',
      '  vec3 col=mix(vec3(0.55,0.06,0.0),vec3(1.0,0.36,0.02),smoothstep(0.0,0.35,heat));',
      '  col=mix(col,vec3(1.0,0.78,0.22),smoothstep(0.35,0.7,heat));',
      '  col=mix(col,vec3(1.0,0.97,0.8),smoothstep(0.72,0.98,heat));',
      '  col*=(0.75+0.9*heat)*(vN.y<-0.5?0.6:1.0);',
      '  gl_FragColor=vec4(col,1.0);',
      '}',
    ].join('\n'),
  }))
  const slabs = new THREE.InstancedMesh(slabGeo, slabMat, SLABS * MAX_HOT)
  slabs.frustumCulled = false; slabs.renderOrder = 15; slabs.visible = false; slabs.count = 0; group.add(slabs)
  const glowTex = keep(new THREE.CanvasTexture(glowCanvas())), glows = []
  for (let h = 0; h < MAX_HOT; h++) {
    const glow = new THREE.Sprite(keep(new THREE.SpriteMaterial(additive({ map: glowTex, color: 0xff9a40, opacity: 0, depthWrite: false }))))
    glow.visible = false; glow.renderOrder = 14; glow.scale.set(4.2, 3.2, 1); group.add(glow); glows.push(glow)
  }

  // The orange slab stack, its halo and its light on nearby blocks. Off by the owner's word (2026-11-17).
  const HEAT = false
  // Which blocks are recalled (lit: one number per block, above 0 is recalled). Called when a recall arrives.
  const hot = []
  function setLit(lit) {
    hot.length = 0
    for (let i = 0; i < N; i++) { const v = Math.min(1, lit?.[i] || 0); state[i * 2] = v; if (v > 0 && hot.length < MAX_HOT) hot.push(i) }
    stateAttr.needsUpdate = true
    hot.forEach((i, h) => {
      const b = blocks[i]
      for (let j = 0; j < SLABS; j++) {
        // Each slab has its own length and offset, so the stack's ends are ragged.
        const n = h * SLABS + j, y = slabInfo[n * 2], seed = slabInfo[n * 2 + 1]
        const w = STACK_W * (1 - 0.05 * y * y) * (0.62 + 0.38 * seed), dz = STACK_W * (0.74 + 0.24 * ((seed * 7) % 1))
        matrix.makeScale(w, STACK_H / SLABS * 0.72, dz).setPosition(b.pos[0] + (((seed * 13) % 1) - 0.5) * 0.2, b.pos[1] + y * STACK_H / 2, b.pos[2])
        slabs.setMatrixAt(n, matrix)
      }
      glows[h].position.set(b.pos[0], b.pos[1], b.pos[2])
    })
    slabs.count = HEAT ? hot.length * SLABS : 0; slabs.visible = HEAT && hot.length > 0; slabs.instanceMatrix.needsUpdate = true
    glows.forEach((glow, h) => { glow.visible = HEAT && h < hot.length })
    // The first four also light the blocks around them.
    for (let h = 0; h < 4; h++) { const b = h < hot.length ? blocks[hot[h]] : null; HOT_LIGHTS.value[h * 4] = b ? b.pos[0] : 0; HOT_LIGHTS.value[h * 4 + 1] = b ? b.pos[1] : 0; HOT_LIGHTS.value[h * 4 + 2] = b ? b.pos[2] : 0; HOT_LIGHTS.value[h * 4 + 3] = 0 }
    pickAt = 0
  }

  // Choosing signs: the nearest few blocks in front of the camera and near the middle of the view, none sitting on
  // top of another. Fixed small arrays, checked a few times a second.
  const near = new Int32Array(MAX_SIGNS), nearD = new Float32Array(MAX_SIGNS), forward = new THREE.Vector3()
  let nearCount = 0, pickAt = 0
  function pickNear(camera) {
    nearCount = 0
    camera.getWorldDirection(forward)
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z
    for (let i = 0; i < N; i++) {
      const p = blocks[i].pos, dx = p[0] - cx, dy = p[1] - cy, dz = p[2] - cz, d = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (d > 7.5 || d < 0.4 || (dx * forward.x + dy * forward.y + dz * forward.z) / d <= 0.88) continue
      if (nearCount === MAX_SIGNS && d >= nearD[MAX_SIGNS - 1]) continue
      // Keep the list sorted by distance, dropping the farthest.
      let at = Math.min(nearCount, MAX_SIGNS - 1)
      while (at > 0 && nearD[at - 1] > d) { near[at] = near[at - 1]; nearD[at] = nearD[at - 1]; at-- }
      near[at] = i; nearD[at] = d; if (nearCount < MAX_SIGNS) nearCount++
    }
    // Drop a sign that would sit on top of a nearer one.
    for (let a = 1; a < nearCount; a++) for (let b = 0; b < a; b++) {
      if (near[b] < 0 || near[a] < 0) continue
      const p = blocks[near[a]].pos, q = blocks[near[b]].pos
      if (Math.abs(p[1] - q[1]) < 0.3 && Math.hypot(p[0] - q[0], p[2] - q[2]) < 1.1) near[a] = -1
    }
  }
  const wanted = (i, isHot) => { for (const s of slots) if (s.block === i && s.hot === isHot) return s; return null }
  function assign(i, isHot) {
    const have = wanted(i, isHot)
    if (have) { have.keep = true; return }
    const slot = slots.find(s => s.block < 0) || slots.find(s => !s.keep && s.sprite.material.opacity < 0.03)
    if (!slot) return
    slot.block = i; slot.hot = isHot; slot.keep = true
    drawLabel(slot.g, blocks[i]); slot.tex.needsUpdate = true
    const p = blocks[i].pos; slot.sprite.position.set(p[0], p[1] + (isHot ? STACK_H / 2 + 0.22 : 0.26), p[2]); slot.sprite.material.opacity = 0
  }

  // Every frame: shader time, the recalled glow, and the few signs. Nothing per block.
  function update(t, camera, lit, showLabels, dt = 1 / 60) {
    cubeMat.uniforms.uT.value = t; pkMat.uniforms.uT.value = t; slabMat.uniforms.uT.value = t; linkMat.uniforms.uT.value = t; gridMat.uniforms.uT.value = t; tessUniforms.uT.value = t
    coreLight.scale.setScalar(coreSize * (0.92 + 0.08 * Math.sin(t * 1.3) + 0.03 * Math.sin(t * 4.1)))
    const pulse = 0.75 + 0.25 * Math.sin(t * 6)
    for (let h = 0; h < hot.length; h++) glows[h].material.opacity = 0.8 + 0.2 * pulse
    for (let h = 0; h < Math.min(4, hot.length); h++) HOT_LIGHTS.value[h * 4 + 3] = HEAT ? 1.5 + 0.4 * pulse : 0
    if ((pickAt -= dt) <= 0) {
      pickAt = 0.15
      for (const s of slots) s.keep = false
      if (showLabels) {
        // While a memory burns, only its own sign shows.
        if (hot.length) for (let h = 0; h < Math.min(HOT_SIGNS, hot.length); h++) assign(hot[h], true)
        else { pickNear(camera); for (let n = 0; n < nearCount; n++) if (near[n] >= 0) assign(near[n], false) }
      }
    }
    const step = Math.min(1, dt * 4)
    for (const s of slots) {
      if (s.block < 0) continue
      const p = blocks[s.block].pos, d = Math.hypot(p[0] - camera.position.x, p[1] - camera.position.y, p[2] - camera.position.z)
      const target = s.keep ? (s.hot ? 0.9 : 0.8 * Math.max(0, Math.min(1, (7.5 - d) / 2))) : 0
      const m = s.sprite.material; m.opacity += Math.sign(target - m.opacity) * Math.min(Math.abs(target - m.opacity), step)
      s.sprite.visible = m.opacity > 0.02
      if (!s.keep && !s.sprite.visible) s.block = -1
    }
  }
  function dispose() { HOT_LIGHTS.value.fill(0); for (const x of disposables) x.dispose?.() }
  return { group, update, dispose, cubes, sprites, setLit, setFocus }
}
