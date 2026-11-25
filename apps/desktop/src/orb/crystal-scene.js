// Nori's face, owner vision 2026-11-14 (docs/NORI-FACE-AND-MEMORY-VISION.md): the crumpled blue membrane figure
// from his clip (figure.js) in a dim blue room, with twinkling flecks and shedding particles. Recall
// flies the camera through the core, whites out, and continues inside her memory space; leaving reverses it.
// Same interface as createOrbScene (orb-scene.js) plus setRecall/toggleRecall/setSettings.
// Real-time only: GPU points and additive meshes, no video. Nothing here talks to the network.
import * as THREE from 'three'
import { renderProfile } from './render-profile.mjs'
import { arrangeRound, layoutByCategory } from './city-categories.js'
import { createCityDetail } from './city-detail.js'
import { createCityExplore } from './city-explore.js'
import { appendExtras } from './inside-extras.js'
import { createCitySelf } from './city-self.js'
import { createStructure } from './city-structure.js'
import { createFigure } from './figure.js'

const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const SETTINGS_KEY = 'nori.face.settings'

// How hard the sphere "fires" in each HUD phase (0 calm .. 1 working flat out).
export const PHASE_FIRE = Object.freeze({
  offline: 0, boot: 0.5, dormant: 0, waking: 0.35, listening: 0.3, thinking: 1, tooling: 1, speaking: 0.6,
})
// Dials for the face. Each is clamped, so a bad saved value can never blank or stall her.
// hue is degrees turned away from her blue (0 = blue); saturation 0 is white light, 1 is normal, 2 is vivid.
export const FACE_DEFAULTS = Object.freeze({ bloom: 0.42, density: 1, fireRate: 1, diveSpeed: 0.28, brightness: 1, hue: 0, saturation: 1, autoDive: 1, labels: 1, resolution: 0 })   // resolution 0 is 2K
const FACE_LIMITS = Object.freeze({ bloom: [0, 1.2], density: [0.2, 2], fireRate: [0.2, 3], diveSpeed: [0.05, 0.8], brightness: [0.3, 1.6], hue: [-180, 180], saturation: [0, 2], autoDive: [0, 1], labels: [0, 1], resolution: [0, 2] })
export function faceSettings(input) {
  const out = { ...FACE_DEFAULTS }
  if (input && typeof input === 'object') {
    for (const key of Object.keys(FACE_DEFAULTS)) {
      const value = Number(input[key])
      if (Number.isFinite(value)) out[key] = Math.min(FACE_LIMITS[key][1], Math.max(FACE_LIMITS[key][0], value))
    }
  }
  out.resolution = Math.round(out.resolution)
  return out
}
// Internal render sizes the owner can pick (setting "resolution" is the index): 2K, 4K or 8K (owner, 2026-11-16).
export const RESOLUTIONS = Object.freeze([['2K', 2560, 1440], ['4K', 3840, 2160], ['8K', 7680, 4320]])
// That many pixels in the window's shape, kept inside what the GPU can allocate.
export function internalSize(resolution, nativeW, nativeH, maxDim = 16384) {
  const pick = RESOLUTIONS[Math.max(0, Math.min(RESOLUTIONS.length - 1, Math.round(Number(resolution)) || 0))]
  let w = Math.max(2, nativeW), h = Math.max(2, nativeH)
  // Never fewer pixels than the window itself has: on a 4K screen the 2K choice used to be stretched and looked
  // blurry in full screen (owner, 2026-11-16). A bigger choice than the screen is drawn large and scaled down.
  if (pick && pick[1]) { const pixels = Math.max(pick[1] * pick[2], w * h), aspect = w / h; w = Math.sqrt(pixels * aspect); h = Math.sqrt(pixels / aspect) }
  const fit = Math.min(1, maxDim / w, maxDim / h)
  return { w: Math.max(2, Math.round(w * fit)), h: Math.max(2, Math.round(h * fit)) }
}
// Settings saved before 2026-11-16 counted Native as choice 0; move those down one so 2K stays 2K.
export function migrateSettings(raw, version) {
  const out = raw && typeof raw === 'object' ? { ...raw } : {}
  if (!(Number(version) >= 2) && Number.isFinite(Number(out.resolution))) out.resolution = Math.max(0, Number(out.resolution) - 1)
  return faceSettings(out)
}
export function loadFaceSettings() {
  try {
    const out = migrateSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'), localStorage.getItem(SETTINGS_KEY + '.v'))
    if (localStorage.getItem(SETTINGS_KEY + '.v') !== '2') { localStorage.setItem(SETTINGS_KEY, JSON.stringify(out)); localStorage.setItem(SETTINGS_KEY + '.v', '2') }
    return out
  } catch { return faceSettings() }
}
export function saveFaceSettings(settings) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(faceSettings(settings))); localStorage.setItem(SETTINGS_KEY + '.v', '2') } catch {} }
const savedSettings = loadFaceSettings

const nrm = v => { const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / m, v[1] / m, v[2] / m] }
const rv = () => nrm([Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1])
function fbm(x, y, z) {
  let n = Math.sin(x * 1.7 + y * 0.9 + 2.1) * Math.sin(y * 1.3 - z * 1.1 + 0.6) * Math.sin(z * 1.9 + x * 0.7 + 4.2)
  n += 0.6 * Math.sin(x * 3.1 - z * 2.3 + 1.1) + 0.5 * Math.sin(y * 2.7 + x * 1.1 + 3.3) + 0.4 * Math.sin(z * 3.3 + y * 1.7)
  return n * 0.42
}
// The crumpled-crystal displacement shared by every layer, so shells, ribbons and facets agree.
const disp = (d, a) => 1 + a * (fbm(d[0] * 2.2, d[1] * 2.2, d[2] * 2.2) * 0.65 + fbm(d[0] * 4.6 + 5, d[1] * 4.6 + 5, d[2] * 4.6 + 5) * 0.35)
const surf = (d, R, a) => { const s = disp(d, a) * R; return [d[0] * s, d[1] * s, d[2] * s] }
const additive = extra => ({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...extra })

// transparent: draw her on a see-through canvas with no room behind her (the floating desktop window).
export function createCrystalScene(container, { width: fixedW, height: fixedH, maxFps = 0, transparent = false, minResolution = 0, onAsk, onTalk } = {}) {
  let W = fixedW || container.clientWidth || innerWidth, H = fixedH || container.clientHeight || innerHeight
  // Ask a throwaway context what kind of GPU this is first: with the glow pass the canvas only shows one
  // full-screen quad, so its own anti-aliasing and depth buffer would be wasted memory.
  let hardware = false
  try {
    const probe = document.createElement('canvas'); probe.width = probe.height = 1
    const gl = probe.getContext('webgl2') || probe.getContext('webgl')
    if (gl) { hardware = renderProfile(gl).postprocessing; gl.getExtension('WEBGL_lose_context')?.loseContext() }
  } catch {}
  const renderer = new THREE.WebGLRenderer({ antialias: !hardware, alpha: transparent, powerPreference: 'high-performance' })
  renderer.setClearColor(transparent ? 0x000000 : 0x02040b, transparent ? 0 : 1)
  const profile = renderProfile(renderer.getContext(), { maxFps, pixelRatio: devicePixelRatio || 1, reduced: REDUCED })
  maxFps = profile.fps
  renderer.setPixelRatio(profile.dpr); renderer.setSize(W, H)
  container.appendChild(renderer.domElement)
  renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); if (!disposed) console.warn('[nori-orb] WebGL context lost; awaiting restore') })
  const flash = document.createElement('div')
  flash.style.cssText = 'position:absolute;inset:0;background:#eef6ff;opacity:0;pointer-events:none'
  container.appendChild(flash)

  let settings = savedSettings(), disposed = false
  // Software renderers get a small budget (profile.density 0.08); hardware scales with the owner's density dial.
  const density = Math.max(0.05, (profile.density / 0.75) * settings.density)
  const count = n => Math.max(8, Math.round(n * density))

  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(transparent ? 57 : 48, W / H, 0.1, 100)
  camera.position.z = 5.2
  const orb = new THREE.Group(); scene.add(orb)

  // The room behind her (the clip is a blue-lit room, not black): dark glass panels with pale edges and a
  // little haze behind the figure. One quad, kept dim so the app window still reads as dark.
  const roomMat = new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false, uniforms: { uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: [
      'uniform float uT;varying vec2 vUv;',
      'float h(float n){return fract(sin(n*127.1)*43758.5453);}',
      'void main(){',
      '  vec2 p=(vUv-0.5)*vec2(2.0,1.25);',
      // Five straight seams cut the wall into panels; each panel has its own shade and a sheen across it.
      '  float k1=(p.y-0.62*p.x-0.3)/1.18,k2=(p.y+0.9*p.x-0.62)/1.35,k3=(p.x+0.3*p.y-0.47)/1.04,k4=(p.y+0.22*p.x+0.36)/1.02,k5=(p.x-0.5*p.y+0.52)/1.12;',
      '  float id=step(0.0,k1)+2.0*step(0.0,k2)+4.0*step(0.0,k3)+8.0*step(0.0,k4)+16.0*step(0.0,k5);',
      '  float tone=h(id+3.0),lean=h(id+11.0)-0.5;',
      '  vec3 col=mix(vec3(0.003,0.010,0.034),vec3(0.012,0.042,0.115),tone*tone);',
      '  col*=0.55+0.9*smoothstep(-0.7,0.8,p.y*(0.4+tone)+p.x*lean*1.6);',
      '  float seam=min(min(abs(k1),abs(k2)),min(min(abs(k3),abs(k4)),abs(k5)));float fw=fwidth(seam)+1e-5;',
      '  col+=vec3(0.16,0.3,0.5)*(1.0-smoothstep(fw*0.6,fw*2.0,seam))*(0.25+0.5*tone)+vec3(0.02,0.05,0.12)*exp(-seam*26.0)*0.5;',
      '  col+=vec3(0.015,0.07,0.22)*exp(-dot(p,p)*1.7)*(0.9+0.1*sin(uT*0.7));',
      '  col*=0.6*smoothstep(1.55,0.35,length(p*vec2(0.85,1.0)));',
      '  gl_FragColor=vec4(col,1.0);}',
    ].join('\n'),
  })
  const room = new THREE.Mesh(new THREE.PlaneGeometry(34, 21), roomMat)
  room.position.z = -9; room.renderOrder = -20; room.frustumCulled = false; room.visible = !transparent; scene.add(room)

  // The crumpled membrane, cracks, swirl and circuit traces from the owner's clip (figure.js).
  const figure = createFigure(THREE, { additive, density })
  orb.add(figure.group)
  scene.add(figure.companion)   // the Ultron figure stands beside her and does not turn with her
  orb.scale.setScalar(1.5)   // she fills the view, as in the clip
  // Fine flecks twinkling across the surface.
  // 2026-11-17: four times as many and smaller, a third of them inside her so the volume is not empty.
  const FLECKS = count(14000), flp = new Float32Array(FLECKS * 3), fls = new Float32Array(FLECKS)
  for (let i = 0; i < FLECKS; i++) { flp.set(surf(rv(), i % 3 === 0 ? 0.25 + Math.random() * 0.8 : 1.0 + (Math.random() - 0.5) * 0.22, 0.22), i * 3); fls[i] = Math.random() }
  const fleckGeo = new THREE.BufferGeometry()
  fleckGeo.setAttribute('position', new THREE.BufferAttribute(flp, 3)); fleckGeo.setAttribute('aSeed', new THREE.BufferAttribute(fls, 1))
  const fleckMat = new THREE.ShaderMaterial(additive({
    uniforms: { uT: { value: 0 } },
    vertexShader: 'uniform float uT;attribute float aSeed;varying float vB;varying float vW;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);float tw=max(0.0,sin(uT*3.0+aSeed*55.0));vB=0.25+0.75*tw;vW=step(0.86,fract(aSeed*17.3));gl_PointSize=(0.9+tw*1.9)*(1.0/ -mv.z)*3.0;gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'varying float vB;varying float vW;void main(){float r=length(gl_PointCoord-vec2(0.5));gl_FragColor=vec4(mix(vec3(0.7,0.88,1.0),vec3(0.82,0.97,0.55),vW),smoothstep(0.5,0.3,r)*vB*0.6);}',
  }))
  orb.add(new THREE.Points(fleckGeo, fleckMat))

  // Particles shedding off the surface.
  const SHED = count(280), shp = new Float32Array(SHED * 3), sha = new Float32Array(SHED), shv = []
  const reseed = i => { const d = rv(); shp.set(surf(d, 1.05, 0.2), i * 3); shv[i] = d; sha[i] = 0.0001 + Math.random() * 0.6 }
  for (let i = 0; i < SHED; i++) reseed(i)
  const shedGeo = new THREE.BufferGeometry()
  shedGeo.setAttribute('position', new THREE.BufferAttribute(shp, 3)); shedGeo.setAttribute('aA', new THREE.BufferAttribute(sha, 1))
  const shedMat = new THREE.ShaderMaterial(additive({
    vertexShader: 'attribute float aA;varying float vA;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vA=aA;gl_PointSize=(2.0+aA*7.0)*(1.0/ -mv.z)*3.0;gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'varying float vA;void main(){float r=length(gl_PointCoord-vec2(0.5));gl_FragColor=vec4(vec3(0.62,0.85,1.0),smoothstep(0.5,0.3,r)*vA*0.7);}',
  }))
  orb.add(new THREE.Points(shedGeo, shedMat))

  // Her real memories: one node per saved memory vector, placed by the app (desktop/memory-map.cjs) so that
  // memories close in meaning sit close together. The page only ever sees directions and hash prefixes.
  const memMat = new THREE.ShaderMaterial(additive({
    uniforms: { uT: { value: 0 } },
    vertexShader: 'uniform float uT;attribute float aSeed;attribute float aLit;varying float vL;varying float vB;varying float vF;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vL=aLit;vB=0.6+0.4*sin(uT*1.4+aSeed*40.0);vF=clamp((6.7+mv.z)/2.9,0.25,1.0);gl_PointSize=(18.0+aLit*90.0)*(0.8+0.2*vB)*(1.0/ -mv.z)*3.0;gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'varying float vL;varying float vB;varying float vF;void main(){float r=length(gl_PointCoord-vec2(0.5));float core=smoothstep(0.22,0.0,r);float halo=smoothstep(0.5,0.0,r);vec3 c=mix(vec3(0.72,0.9,1.0),vec3(1.0,0.46,0.04),vL);gl_FragColor=vec4(c*(0.75+vB*0.3-vL*0.2),clamp(core*(0.75+vL*0.25)+halo*(0.2+vL*0.75),0.0,1.0)*mix(vF,1.0,vL));}',
  }))
  // Recalled nodes must stay gold, so this layer covers what is behind it instead of adding light to it.
  memMat.blending = THREE.NormalBlending
  let memPoints = null, memKeys = [], memDirs = [], memLit = null, autoReturn = 0
  function setMemory(nodes) {
    if (memPoints) { orb.remove(memPoints); memPoints.geometry.dispose(); memPoints = null }
    const list = Array.isArray(nodes) ? nodes.filter(n => typeof n?.k === 'string' && Array.isArray(n.p) && n.p.length === 3 && n.p.every(Number.isFinite)).slice(-3000) : []
    memKeys = list.map(n => n.k); memDirs = list.map(n => nrm(n.p))
    if (!list.length) { memLit = null; clearCity(); return 0 }
    const mp = new Float32Array(list.length * 3), ms = new Float32Array(list.length)
    memLit = new Float32Array(list.length)
    list.forEach((n, i) => { mp.set(surf(memDirs[i], 1.07, 0.22), i * 3); ms[i] = (parseInt(n.k.slice(0, 6), 16) % 1000) / 1000 })
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(mp, 3)); geo.setAttribute('aSeed', new THREE.BufferAttribute(ms, 1)); geo.setAttribute('aLit', new THREE.BufferAttribute(memLit, 1))
    memPoints = new THREE.Points(geo, memMat); memPoints.renderOrder = 10; orb.add(memPoints)
    cityList = list
    // While the view is inside, the rebuild waits for the next time it is outside: rebuilding there is a visible
    // hitch and takes the block the owner is holding out of his hands.
    if (city && phase !== 'out') insidePending = true
    else { buildCity(list); scalePoints() }
    return list.length
  }

  // The city inside her, built from the same real memories: one block each, districts by meaning
  // (memory-city.js). Until her memory map arrives, the generated space below stands in for it.
  let city = null, structure = null, streak = 0, streakTarget = 0
  // Besides memories: her Knights, brains, connected systems, skills, folders and projects (inside-extras.js).
  let cityList = null, insideGroups = null, insideStamp = '', insidePending = false
  function setInside(groups) {
    const stamp = JSON.stringify(groups ?? null)
    if (stamp === insideStamp) return false
    insideStamp = stamp; insideGroups = Array.isArray(groups) ? groups : null
    // The city is rebuilt by the frame loop the next time the view is outside, so a block is never pulled out from
    // under the owner while he is in there.
    insidePending = true
    return true
  }
  const lastCam = new THREE.Vector3()
  function clearCity() {
    if (!city) return
    inner.remove(city.group)
    // The structure does not depend on her memories: it is kept for the next city.
    if (structure) city.group.remove(structure.mesh)
    city.detail.dispose()
    city.group.traverse(obj => { obj.geometry?.dispose(); obj.material?.dispose() })
    city = null; innerGroup.visible = true; inner.background = null; stars.visible = true
  }
  function buildCity(list) {
    clearCity()
    // One area per category of what she holds, standing round her brain (city-categories.js).
    const plan = layoutByCategory(list)
    if (insideGroups) appendExtras(plan, insideGroups)
    arrangeRound(plan)
    if (!plan.blocks.length) return
    const group = new THREE.Group()
    // Labels travel with the memory map (kind, day, first words) unless the app withheld them while streaming.
    const labelOf = new Map(list.map(n => [n.k, n.l]))
    const blocks = plan.blocks.map(b => ({ ...b, l: labelOf.get(b.k) ?? b.l }))
    // The explore window reads labels from the plan itself.
    plan.blocks.forEach((block, i) => { block.l = blocks[i].l })
    const detail = createCityDetail(THREE, { plan, blocks, additive, count })
    const cubes = detail.cubes
    const index = new Map()
    plan.blocks.forEach((block, i) => {
      index.set(block.k, i)
    })
    // Only what stands for something is in here (owner, 2026-11-23: "I see a lot of blocks that do nothing"): the
    // megastructure of filler blocks that used to surround the flight path is no longer built or drawn.
    group.add(detail.group)
    // The backdrop stars stood for nothing: hidden while her city is shown.
    inner.add(group); innerGroup.visible = false; inner.background = HAZE; stars.visible = false
    city = { group, cubes, detail, plan, index, focus: new THREE.Vector3(), look: new THREE.Vector3(0, 0, -10), pinned: false, stop: 0, since: 0, lit: new Float32Array(plan.blocks.length) }
    visitDistrict(0)
  }
  function visitDistrict(n) {
    const sector = city.plan.sectors[((n % city.plan.sectors.length) + city.plan.sectors.length) % city.plan.sectors.length]
    city.stop = sector.id; city.pinned = false; city.since = performance.now()
    city.focus.set(sector.center[0], sector.center[1] + sector.height / 2, sector.center[2])
  }
  // Fly to whatever the city is focused on: a recalled block, or the next district on the tour.
  function flyCity(dt, now) {
    const speed = REDUCED ? 0.6 : settings.diveSpeed * 5
    // While the owner is moving himself around in here (city-explore.js) the tour and the centre turn stand aside.
    if (explore.active()) explore.fly(dt)
    else {
    if (centerStay) {
      // Parked in the middle of her whole city (owner, 2026-11-17: "when i double click it should go into her and
      // leave me like in the center of her whole thing"): no tour; a slow turn shows the districts all around, and
      // a memory she recalls or pulls draws the eye to it.
      const c = cityCenter()
      tmp.set(c[0], c[1], c[2])
      if (!REDUCED) centerYaw += dt * 0.11
      const f = city.pinned ? city.focus : centerLook.set(c[0] + Math.sin(centerYaw) * 12, c[1] - 0.4, c[2] - Math.cos(centerYaw) * 12)
      camPos.lerp(tmp, Math.min(1, dt * speed)); city.look.lerp(f, Math.min(1, dt * speed * 0.8))
    } else {
    if (!city.pinned && !REDUCED && now - city.since > 5200) visitDistrict(city.stop + 1)
    // Stand between the area and her brain, looking out at the area.
    const f = city.focus, c = city.plan.centre || [0, 0, -18], away = Math.hypot(f.x - c[0], f.y - c[1], f.z - c[2]) || 1, back = Math.min(3.6, away * 0.6)
    tmp.set(f.x - (f.x - c[0]) / away * back, f.y - (f.y - c[1]) / away * back, f.z - (f.z - c[2]) / away * back)
    camPos.lerp(tmp, Math.min(1, dt * speed)); city.look.lerp(f, Math.min(1, dt * speed * 1.4))
    }
    camera.position.copy(camPos); camera.up.set(0, 1, 0)
    camera.lookAt(city.look.x + lookX * 3, city.look.y - lookY * 3, city.look.z)
    }
    stars.position.copy(camPos)
    city.detail.update(now / 1000 * settings.fireRate, camera, city.lit, settings.labels >= 0.5, dt)
    structure?.update(now / 1000 * settings.fireRate)
    // Motion streaks scale with how fast she is flying, like the rush in the clip.
    const moved = camPos.distanceTo(lastCam); lastCam.copy(camPos)
    streakTarget = Math.min(1, moved / Math.max(dt, 0.001) / 14)
  }

  // Inside her: the memory space entered through the core. Blocks of nodes, a few warm ones, streaming past.
  // The layout here is generated; tying each node to a real memory vector is a later step (vision doc, part 4).
  const inner = new THREE.Scene(), innerGroup = new THREE.Group(); inner.add(innerGroup)
  const HAZE = new THREE.Color().setRGB(0.03, 0.052, 0.054, THREE.LinearSRGBColorSpace)   // the city fades to this, not to black
  const CLUSTERS = count(120), DEPTH = 100, clusters = []
  const nodeMat = new THREE.ShaderMaterial(additive({
    uniforms: { uT: { value: 0 } },
    vertexShader: 'uniform float uT;attribute float aSeed;attribute float aHot;varying float vB;varying float vH;varying float vS;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);float fl=step(0.55,fract(aSeed*13.0+floor(uT*1.3+aSeed*7.0)*0.41));float tw=aHot>0.5?(0.55+0.45*sin(uT*3.0+aSeed*40.0)):(0.22+0.78*fl);vB=tw;vH=aHot;vS=aSeed;gl_PointSize=min(26.0,(aHot>0.5?9.0:5.0)*(0.5+tw*0.8)*(1.0/ -mv.z)*14.0);gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'varying float vB;varying float vH;varying float vS;void main(){vec2 q=abs(gl_PointCoord-0.5);float a=1.0-smoothstep(0.36,0.5,max(q.x,q.y));vec3 base=vS<0.09?vec3(1.0,0.6,0.22):vec3(0.26,0.6,1.0);vec3 c=mix(base,vec3(0.92,0.97,1.0),vH*0.7);gl_FragColor=vec4(c*(0.45+vB*0.55),a*(0.22+vB*0.38));}',
  }))
  const linkMat = new THREE.LineBasicMaterial(additive({ color: 0x3f8ad0, opacity: 0.09 }))
  for (let c = 0; c < CLUSTERS; c++) {
    const cols = 2 + (Math.random() * 5 | 0), rows = 6 + (Math.random() * 20 | 0), deep = 1 + (Math.random() * 3 | 0), gap = 0.23
    const n = cols * rows * deep, cp = new Float32Array(n * 3), cseed = new Float32Array(n), hot = new Float32Array(n), links = []
    let i = 0
    for (let z = 0; z < deep; z++) for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const px = (x - (cols - 1) / 2) * gap, py = (y - (rows - 1) / 2) * gap, pz = (z - (deep - 1) / 2) * gap
      cp.set([px, py, pz], i * 3); cseed[i] = Math.random(); hot[i] = Math.random() < 0.14 ? 1 : 0; i++
      // Grid neighbours give the same lattice links as a nearest-neighbour search, without the n-squared cost.
      if (x + 1 < cols) links.push(px, py, pz, px + gap, py, pz)
      if (y + 1 < rows) links.push(px, py, pz, px, py + gap, pz)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(cp, 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(cseed, 1)); geo.setAttribute('aHot', new THREE.BufferAttribute(hot, 1))
    const linkGeo = new THREE.BufferGeometry(); linkGeo.setAttribute('position', new THREE.Float32BufferAttribute(links, 3))
    const group = new THREE.Group()
    group.position.set((Math.random() < 0.5 ? -1 : 1) * (3.2 + Math.random() * 13), (Math.random() - 0.5) * 17, -4 - Math.random() * DEPTH)
    group.add(new THREE.Points(geo, nodeMat)); group.add(new THREE.LineSegments(linkGeo, linkMat))
    innerGroup.add(group); clusters.push(group)
  }
  const STARS = count(1800), sp = new Float32Array(STARS * 3)
  for (let i = 0; i < STARS; i++) sp.set([(Math.random() - 0.5) * 11, (Math.random() - 0.5) * 7.5, -Math.random() * DEPTH], i * 3)
  const starGeo = new THREE.BufferGeometry(); starGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3))
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial(additive({ color: 0x6ec6ff, size: 0.035, opacity: 0.5 })))
  inner.add(stars)

  // Glow and film look. The scene is drawn into "full" at the chosen internal resolution (with mipmaps, so
  // showing it at window size is a clean downsample), blurred at half window size, then composited.
  let post = null, checkTarget = 0, fitStep = RESOLUTIONS.length - 1, resizeTimer = 0
  const pxScale = { value: 1 }   // internal pixels per window pixel; keeps point sprites the same size on screen
  const native = new THREE.Vector2()
  const glc = renderer.getContext()
  let maxDim = 4096
  try { const vp = glc.getParameter(glc.MAX_VIEWPORT_DIMS) || [4096, 4096]; maxDim = Math.max(64, Math.min(glc.getParameter(glc.MAX_TEXTURE_SIZE), glc.getParameter(glc.MAX_RENDERBUFFER_SIZE), vp[0], vp[1])) } catch {}
  // Point shaders set sizes in pixels; scale them so a bigger internal picture does not shrink every point.
  function scalePoints() {
    if (!post) { if (pxScale.value === 1) return; pxScale.value = 1 }
    for (const root of [scene, inner]) root.traverse(obj => {
      const mat = obj.isPoints && obj.material
      if (!mat) return
      if (mat.isPointsMaterial) { mat.userData.noriSize ??= mat.size; mat.size = mat.userData.noriSize * pxScale.value }
      else if (mat.isShaderMaterial && !mat.userData.noriPx && !mat.uniforms.uPx && mat.vertexShader.includes('gl_PointSize')) {
        mat.userData.noriPx = true; mat.uniforms.uPxScale = pxScale
        mat.vertexShader = mat.vertexShader.replace(/void\s+main\s*\(\s*\)/, 'void noriMain()') + '\nuniform float uPxScale;void main(){noriMain();gl_PointSize*=uPxScale;}'
        mat.needsUpdate = true
      }
    })
  }
  // (Re)allocate the targets for the window size and the owner's resolution choice. Safe to call any time.
  // minResolution: the desktop form fills a whole monitor, so it draws at 8K inside and scales down (crisp edges,
  // fine detail kept) unless the owner picked higher; the frame-rate guard below still steps it down when busy.
  function sizeTargets(step = Math.min(Math.max(settings.resolution, minResolution), fitStep)) {
    if (!post || disposed) return
    renderer.getDrawingBufferSize(native)
    const { w, h } = internalSize(step, native.x, native.y, maxDim)
    post.step = step
    if (!post.full || post.full.width !== w || post.full.height !== h) {
      post.full?.dispose()
      post.full = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: true })
      // Depth is kept so the city can have real depth of field.
      post.full.depthTexture = new THREE.DepthTexture(w, h)
      checkTarget = 2
    }
    post.hw = Math.max(2, native.x >> 1); post.hh = Math.max(2, native.y >> 1)
    post.a.setSize(post.hw, post.hh); post.b.setSize(post.hw, post.hh)
    post.mix.uniforms.uRes.value.set(native.x, native.y)
    pxScale.value = h / native.y
    linkMat.opacity = Math.min(1, 0.09 * pxScale.value)   // one-pixel lines get thinner on screen as the picture grows
    scalePoints()
  }
  // If the GPU could not allocate the big target, drop one step instead of showing a black face.
  function verifyTarget() {
    let failed = false
    for (let i = 0, err; i < 8 && (err = glc.getError()) !== glc.NO_ERROR; i++) failed ||= err === glc.OUT_OF_MEMORY || err === glc.INVALID_FRAMEBUFFER_OPERATION
    if (failed && post.step > 0) {
      console.warn('[nori-orb] resolution ' + RESOLUTIONS[post.step][0] + ' did not fit on the GPU; using ' + RESOLUTIONS[post.step - 1][0])
      fitStep = post.step - 1; sizeTargets()
    }
  }
  const MIX_FRAGMENT = [
    'uniform float uClear;uniform sampler2D tScene;uniform sampler2D tBloom;uniform float uStr;uniform float uT;uniform float uGain;uniform float uRage;',
    'uniform float uStreak;uniform float uHue;uniform float uSat;uniform float uSoft;uniform vec2 uRes;varying vec2 vUv;uniform sampler2D tDepth;uniform float uDof;uniform float uPx;uniform float uCa;uniform float uGrainOn;uniform float uCrisp;',
    'vec3 hueTurn(vec3 c,float a){const vec3 k=vec3(0.57735);float ca=cos(a);return c*ca+cross(k,c)*sin(a)+k*dot(k,c)*(1.0-ca);}',
    'float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
    'float n1(float x){float i=floor(x),f=fract(x);f=f*f*(3.0-2.0*f);return mix(h(vec2(i,7.3)),h(vec2(i+1.0,7.3)),f);}',
    'vec3 film(vec3 x){return (x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14);}',
    'void main(){',
    '  float asp=uRes.x/uRes.y;vec2 c=vUv-0.5;',
    // Soft focus. Outside: a little toward the frame edges. In the city: still shots stay sharp with a mild far
    // falloff (camera near 0.1, far 100); the heavy lens blur only comes in while she is moving.
    '  float soft=smoothstep(0.34,1.08,length(c*vec2(2.0,1.7)))*uSoft;',
    '  float zn=texture2D(tDepth,vUv).r*2.0-1.0;float lin=20.0/(100.1-zn*99.9);',
    '  soft=mix(soft,max(smoothstep(16.0,50.0,lin)*0.3,smoothstep(1.4,0.5,lin)*0.35)+uStreak*(0.5+smoothstep(10.0,36.0,lin)),uDof);',
    '  vec2 rad=soft*0.006*vec2(1.0/asp,1.0);vec2 ca=c*uCa*(1.0+soft);',
    // Rush: the vanishing point sits off-centre and the near side (left, upper) smears much harder.
    '  vec2 sc=vec2(0.62,0.68);vec2 d=vUv-sc;',
    '  float near=smoothstep(0.0,0.5,-d.x)*(0.55+0.45*smoothstep(-0.5,0.25,d.y));',
    '  float w=0.22+1.8*near;vec2 pull=-d*uStreak*0.4*w;',
    // Each tap reads the mip that covers the gap to the next tap, so streaks are smooth bands with no grain.
    // Still and in focus (Wil 2026-11-21: "needs to be more defined"): the old +0.5 bias blurred every still frame;
    // a small negative bias reads the 8K picture from a sharper level when it is scaled down to the monitor.
    '  float gap=length(pull*uRes)/24.0*uPx;float lod=(soft>0.002||gap>1.0)?max(log2(1.0+soft*1.4*uPx),log2(max(1.0,gap))+0.5):-0.6*uCrisp;',
    '  float jit=h(vUv*uRes)*0.35;vec3 s=vec3(0.0);',
    '  for(int i=0;i<24;i++){float f=float(i);float a=f*2.4+jit*18.0;',
    '    vec2 o=pull*(f+jit)/24.0+rad*sqrt((f+0.5)/24.0)*vec2(cos(a),sin(a));',
    '    s+=vec3(texture2D(tScene,vUv+o+ca,lod).r,texture2D(tScene,vUv+o,lod).g,texture2D(tScene,vUv+o-ca,lod).b);}',
    '  s/=24.0;',
    // Defined edges on still frames (2026-11-21, his crop showed soft halos on every bar): unsharp mask against the
    // four neighbours one screen pixel away. Off while she moves or the lens blur is on.
    '  if(uCrisp>0.5&&lod<0.0){vec2 px=1.0/uRes;vec3 nb=(texture2D(tScene,vUv+vec2(px.x,0.0),lod).rgb+texture2D(tScene,vUv-vec2(px.x,0.0),lod).rgb+texture2D(tScene,vUv+vec2(0.0,px.y),lod).rgb+texture2D(tScene,vUv-vec2(0.0,px.y),lod).rgb)*0.25;s=max(vec3(0.0),s+(s-nb)*0.85);}',
    // The clip's rush: the near side falls to near black with a few long thin lines, and three hard-edged,
    // nearly level bands (mint-white, red-orange, deep blue) blaze past in the top left.
    '  float rush=smoothstep(0.08,0.5,uStreak);float dark=rush*near;',
    '  vec2 p=d*vec2(asp,1.0);float ang=atan(p.y,p.x);',
    '  float lines=smoothstep(0.93,1.0,n1(ang*170.0+1.3))*smoothstep(0.1,0.45,length(p));',
    '  s=s*(1.0+rush*1.5*(1.0-near)-0.5*dark)+s*lines*dark*2.0+vec3(0.08,0.3,0.34)*lines*dark*0.3;',
    '  float yy=vUv.y+(vUv.x-0.3)*0.045+0.003*sin(uT*11.0);float row=0.65+0.35*n1(yy*150.0+uT*3.0);float beat=0.85+0.15*n1(uT*9.0);',
    '  float teal=smoothstep(0.36,0.2,vUv.x)*smoothstep(0.852,0.858,yy);',
    '  vec3 tealC=mix(vec3(0.03,0.36,0.34),vec3(0.8,1.0,0.94),smoothstep(0.88,0.93,yy)*smoothstep(1.03,0.96,yy)*(0.4+0.6*row))*(0.75+0.25*n1(yy*40.0-uT*5.0));',
    '  float red=smoothstep(0.27,0.3,vUv.x)*smoothstep(0.58,0.44,vUv.x)*smoothstep(0.836,0.84,yy)*smoothstep(0.886,0.881,yy)*(1.0-teal);',
    '  float blue=smoothstep(0.1,0.15,vUv.x)*smoothstep(0.46,0.3,vUv.x)*smoothstep(0.806,0.81,yy)*smoothstep(0.846,0.84,yy)*(1.0-red)*(1.0-teal);',
    '  s+=(tealC*teal*1.5+vec3(1.0,0.2,0.06)*red*(0.9+0.5*row)+vec3(0.03,0.26,0.8)*blue*0.9*row)*rush*beat;',
    '  vec3 b=vec3(texture2D(tBloom,vUv+ca).r,texture2D(tBloom,vUv).g,texture2D(tBloom,vUv-ca).b);',
    // Glow falls off faster: faint haze is dropped, hot light still spills.
    '  b*=smoothstep(0.1,0.45,max(b.r,max(b.g,b.b)))*1.4;',
    '  vec3 col=(s+b*uStr*(1.0-0.6*dark))*uGain;col=mix(col,col.bgr*vec3(1.15,0.55,0.5),uRage);',
    // Film curve that keeps colour: only really hot light burns to white. Then a toe for deeper blacks.
    '  vec3 x=col*0.8;float L=max(x.r,max(x.g,x.b))+0.0001;',
    '  col=mix(x/L*film(vec3(L)).r,film(x),smoothstep(1.0,3.0,L));',
    '  col=mix(col,col*col*(3.0-2.0*col),0.5);',
    '  col=max(vec3(0.0),mix(vec3(dot(col,vec3(0.2126,0.7152,0.0722))),hueTurn(col,uHue),uSat));',
    '  float vg=smoothstep(1.15,0.35,length(c));col*=0.42+0.58*vg;',
    // See-through windows (uClear 1): fade out softly before the window's edges, so particles never stop at a
    // straight line and no box shows round her (owner, 2026-11-22: "only her and her particles ... no outline").
    '  float edge=mix(1.0,smoothstep(0.0,0.14,vUv.x)*smoothstep(1.0,0.86,vUv.x)*smoothstep(0.0,0.14,vUv.y)*smoothstep(1.0,0.86,vUv.y),uClear);col*=edge;',
    // The window composites premultiplied colour: the old output kept faint haze at full colour with near-zero alpha,
    // which Windows added over the desktop as a grey box. Now faint haze is fully clear and colour is multiplied by alpha.
    // Blended like light (2026-11-22, "not blended well"): no hard cut. The faint haze floor is taken off smoothly,
    // then she adds onto the desktop as a hologram would; alpha follows her brightness so glow fades out gradually.
    '  col+=(h(vUv*uRes+fract(uT))-0.5)*0.02*(1.0-uClear)*uGrainOn;',
    '  vec3 lit=max(col-vec3(0.045),vec3(0.0))/0.955;float A=mix(1.0,clamp(max(lit.r,max(lit.g,lit.b))*1.3,0.0,1.0),uClear);',
    '  gl_FragColor=vec4(mix(col,lit,uClear),A);}',
  ].join('\n')
  if (profile.postprocessing) {
    try {
      const opts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }
      const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2)), quadScene = new THREE.Scene(); quadScene.add(quad)
      const quadVertex = 'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}'
      post = {
        full: null, a: new THREE.WebGLRenderTarget(2, 2, opts), b: new THREE.WebGLRenderTarget(2, 2, opts),
        hw: 2, hh: 2, step: 0, quad, quadScene, quadCamera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
        blur: new THREE.ShaderMaterial({ uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2() } }, vertexShader: quadVertex,
          fragmentShader: 'uniform sampler2D tDiffuse;uniform vec2 dir;varying vec2 vUv;void main(){vec4 s=texture2D(tDiffuse,vUv)*0.227;s+=texture2D(tDiffuse,vUv+dir*1.3846)*0.316;s+=texture2D(tDiffuse,vUv-dir*1.3846)*0.316;s+=texture2D(tDiffuse,vUv+dir*3.2307)*0.070;s+=texture2D(tDiffuse,vUv-dir*3.2307)*0.070;gl_FragColor=s;}' }),
        mix: new THREE.ShaderMaterial({ uniforms: { tScene: { value: null }, tBloom: { value: null }, uStr: { value: settings.bloom }, uT: { value: 0 }, uGain: { value: 1 }, uRage: { value: 0 }, uStreak: { value: 0 }, uGrainOn: { value: 1 }, uCrisp: { value: 1 }, uCa: { value: 0.00012 }, uClear: { value: transparent ? 1 : 0 }, uHue: { value: 0 }, uSat: { value: 1 }, uSoft: { value: 1 }, tDepth: { value: null }, uDof: { value: 0 }, uPx: { value: 1 }, uRes: { value: new THREE.Vector2(2, 2) } }, vertexShader: quadVertex, fragmentShader: MIX_FRAGMENT }),
      }
      sizeTargets()
    } catch (error) { console.warn('[nori-orb] glow unavailable', error); post = null }
  }

  // State driven by her phase.
  let fire = 0, fireTarget = 0, recallGlow = 0, rage = 0, rageTarget = 0, gain = 0.55, gainTarget = 0.55
  let toolTarget = 0
  function setPhase(name) { fireTarget = PHASE_FIRE[name] ?? 0; gainTarget = name === 'offline' ? 0.35 : 1; toolTarget = name === 'tooling' ? 1 : 0; thinkAbout(name === 'thinking' || name === 'tooling') }
  function setMood() {} // her face stays blue by the owner's design; mood colour is not applied here
  function setActive(next) { if (next) fireTarget = Math.max(fireTarget, 0.6) }
  function setRage(next) { rageTarget = Math.max(0, Math.min(1, Number(next) || 0)) }

  // Recall: 'out' (orb) -> 'inDive' -> 'in' (inside her) -> 'outDive' -> 'out'.
  let phase = 'out', phaseAt = 0, wantIn = false, autoDiving = false, autoLeft = false
  let centerStay = false, centerYaw = 0
  const centerLook = new THREE.Vector3()
  // The middle of her whole city: on the central avenue, halfway between the entrance and the deepest district.
  function cityCenter() {
    const blocks = city?.plan.blocks || []
    if (!blocks.length) return [0, 0.6, -12]
    // Her brain stands at the centre of the city; the parked view sits just in front of it, facing it.
    const c = city.plan.centre || [0, 0, -18]
    return [c[0], c[1], c[2] + 4.4]
  }
  const DIVE_MS = REDUCED ? 500 : 1500
  const camPos = new THREE.Vector3(0, 0, 2), heading = new THREE.Vector3(0, 0, -1), tmp = new THREE.Vector3()
  let bank = 0, lookX = 0, lookY = 0
  // Reduced motion gets a gentle fade, never a full white flash.
  const setFlash = v => { flash.style.opacity = String(Math.max(0, REDUCED ? Math.min(0.35, v) : v)) }
  // byTimer: the automatic dive's own calls. Anything else (owner, app) takes over and cancels the automatic exit.
  function setRecall(on, byTimer = false) {
    if (!byTimer) { clearTimeout(autoReturn); autoDiving = false; autoLeft = false }
    // Any way out (the Dive button, Ctrl+Shift+M, the app) also ends the parked centre view.
    if (!on) centerStay = false
    wantIn = false
    if (on && phase === 'out') { phase = 'inDive'; phaseAt = performance.now() }
    else if (on && phase === 'outDive') wantIn = true   // turn round when the way out ends
    else if (!on && phase === 'in') { phase = 'outDive'; phaseAt = performance.now() }
    else if (!on && phase === 'inDive') { phase = 'out'; camera.position.set(0, 0, 5.2); setFlash(0); if (city) city.pinned = false }
  }
  const recalling = () => phase === 'in' || phase === 'inDive' || (phase === 'outDive' && wantIn)
  // While she thinks she goes inside herself and pulls memories, then comes back out to answer (owner, 2026-11-17:
  // "when she thinking it should be zooming into her inside and making it to where she pulling the information").
  // It follows the same switch as the recall dive ("dive when she recalls") and is off with reduced motion.
  // thinkOwn: this dive was started by thinking, so thinking may end it; a dive the owner or a recall started is
  // never closed from here.
  let thinkDive = false, thinkOwn = false, thinkAt = 0, thinkTimer = 0, lastPull = 0
  const pulls = []
  function dropPulls() {
    if (!city || !pulls.length) { pulls.length = 0; return }
    for (const i of pulls) if (i < city.lit.length) city.lit[i] = 0
    pulls.length = 0; city.detail.setLit(city.lit); city.pinned = false
  }
  function thinkAbout(on) {
    if (settings.autoDive < 0.5 || REDUCED) on = false
    if (on === thinkDive) return
    thinkDive = on; clearTimeout(thinkTimer)
    if (on) {
      thinkAt = performance.now()
      // A thought shorter than this is not worth a flight.
      thinkTimer = setTimeout(() => { if (thinkDive && !disposed && !recalling()) { thinkOwn = true; thinkAt = performance.now(); setRecall(true, true) } }, 650)
    } else {
      // Stay long enough to arrive and be seen pulling something, then come out to answer.
      const stay = thinkOwn ? Math.max(400, DIVE_MS + 1400 - (performance.now() - thinkAt)) : 0
      thinkTimer = setTimeout(() => {
        if (thinkDive || disposed) return
        dropPulls()
        if (thinkOwn && !autoDiving && !exploring()) setRecall(false, true)
        thinkOwn = false
      }, stay)
    }
  }
  // Inside, while thinking: every few seconds she reaches for another memory block, lights it and flies to it.
  function thinkPull(now) {
    lastPull = now
    const n = city.plan.blocks.length
    if (!n) return
    let i = (Math.random() * n) | 0
    for (let tries = 0; tries < 6 && city.lit[i] >= 1; tries++) i = (Math.random() * n) | 0
    if (city.lit[i] >= 1) return   // a memory she really recalled keeps its light and its place
    city.lit[i] = 1; pulls.push(i)
    if (pulls.length > 3) { const old = pulls.shift(); if (old < city.lit.length) city.lit[old] = 0 }
    const p = city.plan.blocks[i].pos
    city.focus.set(p[0], p[1], p[2]); city.pinned = true; city.stop = city.plan.blocks[i].sector
    city.detail.setLit(city.lit); recallGlow = 1
    self.goTo(i, now)
  }
  const toggleRecall = () => { setRecall(!recalling()); return recalling() }
  // Double-click dive: in to the centre of her city and stay there until the next double-click. It is the owner's
  // own dive, so neither thinking nor a recall closes it.
  function diveToCenter() {
    if (centerStay && recalling()) { centerStay = false; setRecall(false); return false }
    thinkOwn = false
    setRecall(true)
    centerStay = true; centerYaw = 0
    if (city) city.pinned = false
    return true
  }
  const atCenter = () => centerStay && recalling()
  // She just recalled these memories: light their nodes, turn the first one toward the viewer, and (if the
  // owner left "dive when she recalls" on) fly in and come back out on her own.
  function recall(keys) {
    const wanted = new Set(Array.isArray(keys) ? keys : [])
    let first = -1, lit = 0
    memKeys.forEach((k, i) => { if (wanted.has(k)) { memLit[i] = 1; lit++; if (first < 0) first = i } })
    if (!lit) return 0
    memPoints.geometry.attributes.aLit.needsUpdate = true
    recallGlow = 1
    if (city) {
      // Earlier recalls go back to blue; the new ones turn amber and the flight heads for the first.
      city.lit.fill(0)
      let target = -1
      for (const k of wanted) { const i = city.index.get(k); if (i !== undefined) { city.lit[i] = 1; if (target < 0 || k === memKeys[first]) target = i } }
      if (target >= 0) { const p = city.plan.blocks[target].pos; city.focus.set(p[0], p[1], p[2]); city.pinned = true; city.stop = city.plan.blocks[target].sector; self.goTo(target) }
      city.detail.setLit(city.lit)
    }
    const d = memDirs[first]
    targetY = -Math.atan2(d[0], d[2]); targetX = Math.atan2(d[1], Math.hypot(d[0], d[2])); turnIn = 6; focus = 1
    if (settings.autoDive >= 0.5 && !REDUCED) {
      // A recall dive does not leave while she is still thinking.
      const leave = () => { if (thinkDive || exploring()) { autoReturn = setTimeout(leave, 1200); return } autoDiving = false; autoLeft = true; setRecall(false, true) }
      if (phase === 'out') {
        clearTimeout(autoReturn); autoDiving = true
        autoReturn = setTimeout(() => { setRecall(true, true); autoReturn = setTimeout(leave, 7000) }, 900)
      } else if (autoDiving) {
        // Already on an automatic dive: stay long enough to reach the new memory.
        clearTimeout(autoReturn); autoReturn = setTimeout(leave, 7000)
      } else if (phase === 'outDive' && autoLeft) {
        // On the way out of an automatic dive: go back in for this one.
        wantIn = true; autoDiving = true; clearTimeout(autoReturn); autoReturn = setTimeout(leave, 7000 + DIVE_MS)
      }
    }
    return lit
  }

  // Drag to turn her (or to look around while inside).
  let ry = 0, rx = 0.18, targetY = 0, targetX = 0.18, spin = 0, down = false, lastX = 0, lastY = 0, turnIn = 3, focus = 0
  const canvas = renderer.domElement
  canvas.style.touchAction = 'none'
  const onDown = e => { down = true; lastX = e.clientX; lastY = e.clientY }
  const onUp = () => { if (!down) return; down = false; targetY = ry; targetX = rx; turnIn = 2.5 + Math.random() * 3 }
  const onMove = e => {
    if (!down) return
    const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY
    if (phase === 'in') { if (!explore.active()) { lookX += dx * 0.004; lookY = Math.max(-0.5, Math.min(0.5, lookY + dy * 0.004)) } }
    else { spin = dx * 0.008; ry += spin; rx = Math.max(-1.3, Math.min(1.3, rx + dy * 0.008)) }
  }
  canvas.addEventListener('pointerdown', onDown); addEventListener('pointerup', onUp); addEventListener('pointermove', onMove)
  // Moving around inside her, summoning a block and its window (city-explore.js).
  // A small Nori who works among her own blocks and comes when called (city-self.js).
  const self = createCitySelf({ THREE, additive, scene: inner, container, canvas, camera, getCity: () => city, onTalk })
  const explore = createCityExplore({ THREE, container, canvas, camera, camPos, getCity: () => city, isInside: () => phase === 'in', onAsk,
    onCall: () => self.toggle(), pickFirst: event => (self.hit(event.clientX, event.clientY) ? self.call() : false) })
  // The owner is busy in here: he has the camera or is holding a block. Nothing automatic takes him out.
  const exploring = () => explore.active() || explore.summoned() >= 0

  let rafId = 0, paused = false, lastNow = performance.now(), lastFrame = 0, t = 0, slowMs = 0
  // 4K and 8K must never cost her frame rate: if she stays under about 30 fps for a couple of seconds (the card
  // is full or busy), drop one size. It stays there until the owner picks a resolution again.
  function watchLoad(gap) {
    if (!post || post.step < 1 || gap > 1000) { slowMs = 0; return }
    const limit = Math.max(34, maxFps ? 1700 / maxFps : 0)
    slowMs = gap > limit ? slowMs + gap : Math.max(0, slowMs - gap * 2)
    if (slowMs > 2500) {
      slowMs = 0; fitStep = post.step - 1
      console.info('[nori-orb] ' + RESOLUTIONS[post.step][0] + ' was too slow right now; using ' + RESOLUTIONS[fitStep][0])
      sizeTargets()
    }
  }
  // Eases are per second, not per frame, so she moves the same at 144 Hz and on the 15 fps software path.
  const ease = (dt, rate) => 1 - Math.exp(-dt * rate)
  function frame() {
    if (disposed) return
    rafId = requestAnimationFrame(frame)
    if (paused) return
    const now = performance.now()
    if (maxFps && !explore.active() && now - lastFrame < 1000 / maxFps) return
    lastFrame = now
    const gap = now - lastNow, dt = Math.min(0.05, gap / 1000); lastNow = now
    watchLoad(gap)
    t += dt * settings.fireRate
    fire += (fireTarget - fire) * ease(dt, 7); recallGlow *= Math.exp(-dt * 5.9); rage += (rageTarget - rage) * Math.min(1, dt * 3); gain += (gainTarget - gain) * ease(dt, 7)
    const fx = Math.max(fire, recallGlow)
    fleckMat.uniforms.uT.value = t; roomMat.uniforms.uT.value = t
    figure.update(t, fx, Math.max(toolTarget, rage), dt)
    memMat.uniforms.uT.value = t
    if (memLit) {
      let any = false
      const fade = Math.exp(-dt * 0.43)
      for (let i = 0; i < memLit.length; i++) { if (memLit[i] > 0.002) { memLit[i] *= fade; any = true } else if (memLit[i]) { memLit[i] = 0; any = true } }
      if (any) memPoints.geometry.attributes.aLit.needsUpdate = true
    }
    const drift = (0.58 + fx * 1.73) * dt, shedFade = Math.exp(-dt * 2.18)
    for (let i = 0; i < SHED; i++) {
      const d = Math.hypot(shp[i * 3], shp[i * 3 + 1], shp[i * 3 + 2])
      if (d > 1.95 || sha[i] <= 0.004) reseed(i)
      else { const v = shv[i]; shp[i * 3] += v[0] * drift; shp[i * 3 + 1] += v[1] * drift; shp[i * 3 + 2] += v[2] * drift; sha[i] *= shedFade }
    }
    shedGeo.attributes.position.needsUpdate = true; shedGeo.attributes.aA.needsUpdate = true

    const coast = Math.exp(-dt * 12)
    if (!down) {
      turnIn -= dt
      if (turnIn <= 0) {
        targetY = ry + (Math.random() - 0.5) * (0.7 + fx * 1.3)
        targetX = Math.max(-0.5, Math.min(0.6, 0.12 + (Math.random() - 0.5) * 0.5))
        turnIn = REDUCED ? 999 : (3.5 + Math.random() * 5) / (1 + fx * 1.2)
      }
      // A slow turntable (owner, 2026-11-21: "should be 3D image"): she keeps turning, about once every 45 s, so her
      // body and the particles round her slide past each other and read as depth, not a flat picture.
      if (!REDUCED && !down) targetY += dt * 0.14
      const turn = ease(dt, 1.74 + focus * 10.4); focus *= Math.exp(-dt * 4.4)
      ry += (targetY - ry) * turn + spin * dt * 150; rx += (targetX - rx) * turn; spin *= coast
    } else spin *= coast
    orb.rotation.y = ry + 0.05 * Math.sin(t * 0.5) + 0.02 * Math.sin(t * 1.27)
    orb.rotation.x = rx + 0.035 * Math.sin(t * 0.37 + 1)

    if (phase === 'inDive') {
      const p = Math.min(1, (now - phaseAt) / DIVE_MS); recallGlow = 1
      camera.position.set(0, 0, 5.2 - 5.08 * p * p); camera.rotation.set(0, 0, 0)
      setFlash((p - 0.55) / 0.45)
      if (p >= 1) { phase = 'in'; camPos.set(0, 0, 2.5); heading.set(0, 0, -1); bank = 0; lookX = 0; lookY = 0
        if (city) { city.look.set(0, 0, -10); if (!city.pinned) visitDistrict(city.stop) } }
    } else if (phase === 'outDive') {
      const p = Math.min(1, (now - phaseAt) / DIVE_MS)
      setFlash(p < 0.5 ? p / 0.5 : 1 - (p - 0.5) / 0.5)
      if (p >= 0.5) { camera.up.set(0, 1, 0); camera.rotation.set(0, 0, 0); camera.position.set(0, 0, 0.12 + 5.08 * ((p - 0.5) / 0.5)) }
      if (p >= 1) {
        phase = 'out'; camera.position.set(0, 0, 5.2); setFlash(0)
        if (wantIn) { wantIn = false; phase = 'inDive'; phaseAt = now } else if (city) city.pinned = false
      }
    } else {
      if (phase === 'out') camera.position.z += (5.2 - camera.position.z) * ease(dt, 15)
      const f = parseFloat(flash.style.opacity) || 0
      if (f > 0) setFlash(f - dt * 7)
    }
    const inside = phase === 'in' || (phase === 'outDive' && now - phaseAt < DIVE_MS * 0.5)
    // 2.6 s between pulls: long enough to arrive at a block and see it sharp before she reaches for the next.
    if (thinkDive && phase === 'in' && city && now - lastPull > 2600) thinkPull(now)
    explore.update(now, phase === 'in')
    self.update(now, dt, t, phase === 'in', fx, thinkDive)
    if (insidePending && phase === 'out' && cityList?.length) { insidePending = false; buildCity(cityList); scalePoints() }
    if (inside && city) flyCity(dt, now)
    else if (inside) {
      nodeMat.uniforms.uT.value = t
      let wx = Math.sin(t * 0.12) * 0.14, wy = Math.sin(t * 0.08 + 1) * 0.08, wz = -1
      const wl = Math.hypot(wx, wy, wz); wx /= wl; wy /= wl; wz /= wl
      const steer = ease(dt, 2.9)
      heading.x += (wx - heading.x) * steer; heading.y += (wy - heading.y) * steer; heading.z += (wz - heading.z) * steer; heading.normalize()
      // Parked by a double-click with no memory city yet: hold still in the middle of the space.
      if (!centerStay) camPos.addScaledVector(heading, (REDUCED ? 0.03 : settings.diveSpeed) * dt * 144)
      // Blocks that fall behind are recycled ahead, so the space never ends.
      for (const cluster of clusters) {
        tmp.copy(cluster.position).sub(camPos)
        if (tmp.dot(heading) < -8) cluster.position.set(camPos.x + heading.x * 74 + (Math.random() - 0.5) * 28, camPos.y + heading.y * 74 + (Math.random() - 0.5) * 17, camPos.z + heading.z * 74 + (Math.random() - 0.5) * 28)
      }
      stars.position.copy(camPos)
      bank += (Math.max(-0.22, Math.min(0.22, -wx * 1.4)) - bank) * ease(dt, 4.4)
      camera.position.copy(camPos); camera.up.set(0, 1, 0)
      camera.lookAt(camPos.x + heading.x + lookX, camPos.y + heading.y + lookY, camPos.z + heading.z); camera.rotateZ(bank)
    }
    const target = inside ? inner : scene
    if (post) {
      try {
        renderer.setRenderTarget(post.full); renderer.clear(); renderer.render(target, camera)
        if (checkTarget && !--checkTarget) verifyTarget()
        post.quad.material = post.blur
        post.blur.uniforms.tDiffuse.value = post.full.texture; post.blur.uniforms.dir.value.set(1 / post.hw, 0)
        renderer.setRenderTarget(post.a); renderer.clear(); renderer.render(post.quadScene, post.quadCamera)
        post.blur.uniforms.tDiffuse.value = post.a.texture; post.blur.uniforms.dir.value.set(0, 1 / post.hh)
        renderer.setRenderTarget(post.b); renderer.clear(); renderer.render(post.quadScene, post.quadCamera)
        post.quad.material = post.mix
        post.mix.uniforms.tScene.value = post.full.texture; post.mix.uniforms.tBloom.value = post.b.texture
        post.mix.uniforms.uT.value = t; post.mix.uniforms.uStr.value = settings.bloom * (inside ? 1 : 0.12)
        post.mix.uniforms.uGain.value = gain * settings.brightness; post.mix.uniforms.uRage.value = rage
        // Outside the dive she is drawn sharp: no softening toward the frame edges and almost no colour split.
        // At 4K the old split (0.002 of the frame) pulled red and blue up to eight pixels apart near the edges and the
        // dashes and glyphs there read as blurry (owner's screenshots, 2026-11-17). The lens look stays for the dive.
        post.mix.uniforms.uSoft.value = 0
        post.mix.uniforms.uCa.value = 0.00012; post.mix.uniforms.uGrainOn.value = 0
        // Inside her city the picture is filtered normally (2026-11-23): the extra sharpening that suits her form outside
        // made thousands of small far blocks shimmer and look pixelated.
        post.mix.uniforms.uCrisp.value = inside ? 0 : 1
        // See-through only outside her (2026-11-23, his screenshot): inside, the see-through blend dropped the city's
        // dim light and left it nearly black, so the window is a solid view while he is in there.
        post.mix.uniforms.uClear.value = transparent && !inside ? 1 : 0
        post.mix.uniforms.tDepth.value = post.full.depthTexture; post.mix.uniforms.uDof.value = 0
        post.mix.uniforms.uHue.value = settings.hue * Math.PI / 180; post.mix.uniforms.uSat.value = settings.saturation
        streakTarget = phase === 'inDive' && !(inside && city) ? 0.5 : 0
        streak += (streakTarget - streak) * ease(dt, streakTarget > streak ? 32 : 9); post.mix.uniforms.uStreak.value = REDUCED ? 0 : streak
        post.mix.uniforms.uPx.value = pxScale.value
        renderer.setRenderTarget(null); renderer.render(post.quadScene, post.quadCamera)
      } catch (error) { console.warn('[nori-orb] glow failed; continuing without it', error); post = null; renderer.setRenderTarget(null); applyColour(); scalePoints() }
    } else renderer.render(target, camera)
  }
  // With the glow pass her colour is turned in the shader. Without it (software renderers) the page does it.
  function applyColour() {
    const plain = settings.hue === 0 && settings.saturation === 1
    canvas.style.filter = post || plain ? '' : `hue-rotate(${settings.hue}deg) saturate(${settings.saturation})`
  }
  applyColour()
  rafId = requestAnimationFrame(frame)

  function onResize() {
    if (disposed) return
    W = fixedW || container.clientWidth || innerWidth; H = fixedH || container.clientHeight || innerHeight
    if (!profile.software) renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
    renderer.setSize(W, H); camera.aspect = W / H; camera.updateProjectionMatrix()
    // The big target is only reallocated once the window stops changing; until then the old one is stretched.
    clearTimeout(resizeTimer); resizeTimer = setTimeout(sizeTargets, 150)
  }
  addEventListener('resize', onResize)
  requestAnimationFrame(() => requestAnimationFrame(() => { onResize(); clearTimeout(resizeTimer); sizeTargets() }))
  const onVisibility = () => { paused = document.hidden; lastNow = performance.now() }
  document.addEventListener('visibilitychange', onVisibility)

  function dispose() {
    clearCity(); structure?.dispose(); structure = null
    disposed = true; explore.dispose(); self.dispose(); cancelAnimationFrame(rafId); clearTimeout(autoReturn); clearTimeout(thinkTimer); clearTimeout(resizeTimer); memMat.dispose(); figure.dispose()
    removeEventListener('resize', onResize); removeEventListener('pointerup', onUp); removeEventListener('pointermove', onMove)
    document.removeEventListener('visibilitychange', onVisibility)
    for (const root of [scene, inner]) root.traverse(obj => {
      obj.geometry?.dispose()
      for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) mat?.dispose()
    })
    if (post) { post.full.dispose(); post.a.dispose(); post.b.dispose(); post.blur.dispose(); post.mix.dispose(); post.quad.geometry.dispose() }
    // Hand the GPU memory back now; the Detail dial restarts her face and old contexts would pile up.
    try { renderer.forceContextLoss() } catch {}
    renderer.dispose(); canvas.remove(); flash.remove()
  }
  return {
    setPhase, setMood, setActive, setRage, setRecall, toggleRecall, recalling, setMemory, recall, diveToCenter, atCenter,
    // Inside her city: summon(index) brings a block to the camera; insideCity() is true while the view is in there.
    callSelf: () => self.toggle(), selfState: () => self.state(), setInside, summon: index => explore.summon(index), blockAt: (x, y) => explore.pickAt(x, y), exploring, insideCity: () => phase === 'in' && Boolean(city),
    city: () => (city ? { districts: city.plan.sectors.length, blocks: city.plan.blocks.length, lit: city.lit.reduce((n, v) => n + (v ? 1 : 0), 0), stop: city.stop, pinned: city.pinned, signs: city.detail.sprites.filter(x => x.visible).length, nearestBlock: Math.min(...city.plan.blocks.map(b => camera.position.distanceTo(tmp.set(b.pos[0], b.pos[1], b.pos[2])))).toFixed(2), labelsSetting: settings.labels } : null), memoryCount: () => memKeys.length, litCount: () => (memLit ? memLit.reduce((n, v) => n + (v > 0.05 ? 1 : 0), 0) : 0), dispose,
    // Bloom, fire rate, dive speed, brightness and resolution apply at once; density applies the next time her face starts.
    setSettings(next) { const was = settings.resolution; settings = faceSettings({ ...settings, ...next }); if (settings.resolution !== was) { fitStep = RESOLUTIONS.length - 1; sizeTargets() } applyColour(); saveFaceSettings(settings); return { ...settings } },
    // The resolution really in use (lower than the setting when the GPU could not hold it).
    resolutionInUse: () => (post ? post.step : -1),
    settings: () => ({ ...settings }),
    pause: () => { paused = true }, resume: () => { paused = false; lastNow = performance.now() },
    resetView: () => { ry = 0; rx = 0.18; targetY = 0; targetX = 0.18; spin = 0; lookX = 0; lookY = 0 },
  }
}
