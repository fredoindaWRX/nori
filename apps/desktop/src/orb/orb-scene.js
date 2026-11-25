// Nori's presence: the Ultron orb (ported from sagar-builds' ultron-orb-ui, MIT) as a standalone
// module for the built renderer. It mounts a full-window canvas under the HUD, follows Nori's
// phase by watching the HUD status label, and hides the neural-core scene while it is shown.
// Owner toggle: Ctrl+Shift+O (remembered in localStorage 'nori.presence' = 'orb' | 'brain').
// Nothing here talks to the network; no camera, no gestures.
import * as THREE from 'three'
import { renderProfile, scheduleSceneStart } from './render-profile.mjs'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { PIECES } from './pieces.js'

const STORAGE_KEY = 'nori.presence'
const HOME_POSITION = new THREE.Vector3(0, 0.5, 5.5)
const MIN_DISTANCE = 0.6
const MAX_DISTANCE = 40
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches

// HUD status label -> phase. UY in the renderer bundle: OFFLINE INITIALISING STANDBY ONLINE
// LISTENING PROCESSING "ACCESSING SYSTEMS" RESPONDING.
const LABEL_PHASE = {
  OFFLINE: 'offline', INITIALISING: 'boot', STANDBY: 'dormant', ONLINE: 'waking',
  LISTENING: 'listening', PROCESSING: 'thinking', 'ACCESSING SYSTEMS': 'tooling', RESPONDING: 'speaking',
}
// Per phase: overall brightness, rotation speed multiplier, core beat (speech rhythm), tint.
const PHASES = {
  offline:   { glow: 0.25, speed: 0.15, beat: 0,   tint: 0x7a4a1a },
  boot:      { glow: 0.6,  speed: 1.6,  beat: 0,   tint: 0xffaa30 },
  dormant:   { glow: 0.55, speed: 0.5,  beat: 0,   tint: 0xff9a2a },
  waking:    { glow: 0.9,  speed: 1.4,  beat: 0.3, tint: 0xffc060 },
  listening: { glow: 0.95, speed: 0.9,  beat: 0.2, tint: 0xffd27a },
  thinking:  { glow: 0.85, speed: 2.2,  beat: 0.1, tint: 0xffb040 },
  tooling:   { glow: 0.9,  speed: 2.6,  beat: 0.1, tint: 0xd890ff },
  speaking:  { glow: 1.0,  speed: 1.1,  beat: 1.0, tint: 0xffcc66 },
}

const FORM_GLSL = String.raw`
uniform vec4 uForm;
uniform float uRage;
float lobes(vec3 n, float t) {
  return 1.5 + 0.30 * sin(2.1 * n.x + t * 0.5 + 1.7 * sin(1.9 * n.y - t * 0.37))
             + 0.22 * sin(3.3 * n.y - t * 0.41 + 2.0 * n.z)
             + 0.14 * sin(5.1 * n.z + t * 0.63 + 2.3 * n.x)
             + uRage * 0.24 * abs(sin(7.0 * n.x + 2.3 * t) * sin(9.0 * n.y - 1.9 * t) * sin(6.0 * n.z + t));
}
vec2 turn(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
float lattice(vec4 q) { return sin(q.x) * cos(q.y) + sin(q.y) * cos(q.z) + sin(q.z) * cos(q.w) + sin(q.w) * cos(q.x); }
float field(vec3 p, float t, float charge) {
  vec3 w = p + 0.24 * sin(p.yzx * 1.7 + t * 0.3);
  float r = length(w) + 0.0001;
  float blob = r - lobes(w / r, t) * (1.0 + charge * 0.08);
  // The 4D part: a lattice in four dimensions turning through three planes, seen as its moving 3D slice.
  vec4 q = vec4(w * (2.5 + 0.35 * sin(t * 0.21)), sin(t * 0.17) * 2.0);
  q.xw = turn(q.xw, t * 0.23); q.yw = turn(q.yw, t * 0.17 + 1.1); q.zw = turn(q.zw, t * 0.11 + 2.3);
  float web = (abs(lattice(q)) - (0.07 + 0.05 * charge)) / 3.4;
  return max(blob, web);
}
vec3 sky(vec3 d, float t) {
  // A soft moving studio: her mood fills the room, one warm key light stays white.
  vec3 k = normalize(vec3(sin(t * 0.13) * 0.8, 0.75, 0.55));
  vec3 f = normalize(vec3(-0.7, -0.25 + 0.3 * sin(t * 0.09), 0.6));
  vec3 u = normalize(vec3(0.1, -0.9, -0.4));
  float key = pow(max(dot(d, k), 0.0), 26.0), fill = pow(max(dot(d, f), 0.0), 7.0), under = pow(max(dot(d, u), 0.0), 3.0);
  vec3 room = mix(uMood * 0.035, uMood * 0.15 + vec3(0.025), 0.5 + 0.5 * d.y);
  return room + vec3(1.0, 0.97, 0.92) * key * 7.0 + uMood * fill * 1.5 + uMood * under * 0.4;
}
vec3 surfaceNormal(vec3 p, float t, float charge) {
  vec2 e = vec2(0.0022, -0.0022);
  vec3 n = normalize(e.xyy * field(p + e.xyy, t, charge) + e.yyx * field(p + e.yyx, t, charge)
                   + e.yxy * field(p + e.yxy, t, charge) + e.xxx * field(p + e.xxx, t, charge));
  // Very fine surface ripple, like liquid under tension.
  vec3 ripple = sin(p * 31.0 + t * 0.7) * 0.5 + sin(p.yzx * 67.0 - t * 0.5) * 0.25;
  return normalize(n + ripple * 0.012);
}
vec4 livingForm(vec2 uv) {
  float t = uForm.x, charge = uForm.y, beat = uForm.z;
  vec3 ro = vec3(0.0, 0.0, 5.5);
  vec3 rd = normalize(vec3((uv - 0.5) * 2.0 * 0.5206, -1.0));
  float b = dot(ro, rd), h = b * b - dot(ro, ro) + 7.6;
  if (h <= 0.0) return vec4(0.0);
  h = sqrt(h);
  float travel = -b - h, far = -b + h, previous = travel, d = 1.0;
  float aura = 0.0;
  bool hit = false;
  for (int i = 0; i < 110; i++) {
    d = field(ro + rd * travel, t, charge);
    if (d < 0.0009) { hit = true; break; }
    aura += exp(-d * 34.0) * clamp(d * 0.7, 0.004, 0.2);
    previous = travel;
    travel += clamp(d * 0.72, 0.003, 0.2);
    if (travel > far) break;
  }
  vec3 halo = uMood * aura * (0.55 + 0.7 * charge);
  if (!hit) return vec4(halo, clamp(aura * 0.5, 0.0, 0.5));
  // Tighten the hit point so her edges stay razor sharp.
  float lo = previous, hi = travel;
  for (int i = 0; i < 6; i++) {
    float mid = 0.5 * (lo + hi);
    if (field(ro + rd * mid, t, charge) > 0.0) lo = mid; else hi = mid;
  }
  vec3 p = ro + rd * hi;
  vec3 n = surfaceNormal(p, t, charge);
  float facing = max(dot(n, -rd), 0.0);
  float fresnel = 0.04 + 0.96 * pow(1.0 - facing, 5.0);
  vec3 reflected = sky(reflect(rd, n), t);
  // Light entering her body bends, and each colour bends by a slightly different amount.
  vec3 inward = refract(rd, n, 1.0 / 1.46);
  if (dot(inward, inward) < 0.01) inward = rd;
  float optical = 0.0, along = 0.02;
  vec3 inner = vec3(0.0);
  for (int i = 0; i < 58; i++) {
    vec3 q = p + inward * along;
    if (dot(q, q) > 7.6) break;
    float di = field(q, t, charge);
    float stride = clamp(abs(di) * 0.7, 0.006, 0.13);
    if (di < 0.0) optical += stride;
    float depth = clamp(along / 3.2, 0.0, 1.0);
    float membrane = exp(-abs(di) * 120.0);
    float heart = exp(-dot(q, q) * 5.5) * (0.5 + 1.2 * beat + 0.4 * charge);
    vec3 tint = mix(uMood * 1.2 + vec3(0.16), uMood * 0.18, pow(depth, 0.75));
    inner += tint * (membrane * 6.5 + heart * 1.5) * stride * exp(-optical * 0.9);
    along += stride;
  }
  vec3 split = vec3(sky(normalize(refract(rd, n, 1.0 / 1.43) + rd * 0.2), t).r,
                    sky(normalize(inward + rd * 0.2), t).g,
                    sky(normalize(refract(rd, n, 1.0 / 1.50) + rd * 0.2), t).b);
  vec3 absorbed = exp(-optical * (vec3(1.0) - uMood) * 2.6);
  vec3 colour = fresnel * reflected + (1.0 - fresnel) * (split * absorbed * 0.85 + inner * (0.7 + 0.5 * charge));
  colour += uMood * pow(1.0 - facing, 3.0) * 0.32 + halo;
  // Clear glass: the real desktop shows through her body, and only her edges and lights turn solid.
  float alpha = clamp(0.3 + 0.7 * fresnel + optical * 0.06, 0.0, 1.0);
  return vec4(colour, alpha);
}
vec3 filmic(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
float grain(vec2 v) { return fract(sin(dot(v, vec2(12.9898, 78.233))) * 43758.5453); }
`
const FORM_MAIN = String.raw`
          // Her body first, then her pieces and sparks over it; black becomes real transparency.
          float L = max(gl_FragColor.r, max(gl_FragColor.g, gl_FragColor.b));
          vec3 sparks = uMood * L * 1.2 + vec3(1.0) * smoothstep(0.9, 2.0, L) * 0.6;
          vec4 form = livingForm(vUv);
          vec3 rgb = filmic(form.rgb * 1.15) + sparks * 0.8 + (grain(vUv + fract(uTime)) - 0.5) / 255.0;
          float peak = max(rgb.r, max(rgb.g, rgb.b));
          rgb /= max(1.0, peak);
          float edge = 1.0 - smoothstep(0.42, 0.5, d);
          float a = max(form.a * 0.93, clamp(max(rgb.r, max(rgb.g, rgb.b)) * 1.12, 0.0, 1.0)) * edge;
          gl_FragColor = vec4(min(rgb * edge, vec3(a)), a);
`

export function createOrbScene(container, { floating = false, width: fixedW, height: fixedH, scale = 2, maxFps = 0 } = {}) {
  const width = fixedW || container.clientWidth || innerWidth
  const height = fixedH || container.clientHeight || innerHeight
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 500)
  camera.position.copy(HOME_POSITION)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: floating, powerPreference: 'high-performance' })
  if (floating) renderer.setClearColor(0x000000, 0)
  renderer.setSize(width, height)
  // Floating orb: supersample three times over its small window; the full-window scene stays at 1.5.
  const profile = renderProfile(renderer.getContext(), {floating,scale,maxFps,pixelRatio:devicePixelRatio||1,reduced:REDUCED})
  maxFps = profile.fps
  let renderScale = profile.dpr
  renderer.setPixelRatio(profile.dpr)
  const detail = 1
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.8
  container.appendChild(renderer.domElement)
  renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); console.warn('[nori-orb] WebGL context lost; awaiting restore') })
  renderer.domElement.addEventListener('webglcontextrestored', () => console.info('[nori-orb] WebGL context restored'))

  const composer = profile.postprocessing ? new EffectComposer(renderer) : null
  composer?.addPass(new RenderPass(scene, camera))
  const bloom = profile.postprocessing ? new UnrealBloomPass(new THREE.Vector2(width, height), 1.8, 0.4, 0.2) : {strength:0}
  composer?.addPass(bloom)
  const chromaticPass = profile.postprocessing ? new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uIntensity: { value: 0.003 }, uTint: { value: new THREE.Color(0xffaa30) }, uFloat: { value: floating ? 1 : 0 }, uForm: { value: new THREE.Vector4() }, uRage: { value: 0 }, uMood: { value: new THREE.Vector3(1, 0.667, 0.188) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uTime; uniform float uIntensity; uniform vec3 uTint; uniform float uFloat; uniform vec3 uMood; varying vec2 vUv;
      ${floating ? FORM_GLSL : ''}
      void main(){
        vec2 dir = vUv - vec2(0.5); float d = length(dir); float offset = uIntensity * d;
        float flicker = 1.0 + 0.02 * sin(uTime * 30.0) * sin(uTime * 7.3);
        vec4 cr = texture2D(tDiffuse, vUv + dir * offset); vec4 cg = texture2D(tDiffuse, vUv); vec4 cb = texture2D(tDiffuse, vUv - dir * offset * 0.5);
        gl_FragColor = vec4(cr.r, cg.g * 1.05, cb.b * 0.6, 1.0) * flicker;
        // Grade towards the phase tint (amber by default, violet while she works tools).
        vec3 graded = gl_FragColor.rgb * (uTint / max(max(uTint.r, uTint.g), uTint.b)) * vec3(1.15, 0.95, 0.75);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, graded, 0.35);
        ${floating ? FORM_MAIN : ''}
      }`,
  }) : {uniforms:{uTint:{value:new THREE.Color()},uMood:{value:new THREE.Vector3()},uRage:{value:0},uTime:{value:0},uForm:{value:new THREE.Vector4()}}}
  composer?.addPass(chromaticPass)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true; controls.dampingFactor = 0.04
  controls.minDistance = MIN_DISTANCE; controls.maxDistance = MAX_DISTANCE
  controls.zoomSpeed = 1.4; controls.enablePan = false
  controls.enabled = !floating

  const C_BRIGHT = 0xffaa30, C_MID = 0xdd7700, C_DIM = 0x884400, C_FAINT = 0x553300, C_HOT = 0xffcc66
  const orbGroup = new THREE.Group(); scene.add(orbGroup)
  const lineMats = []
  function lineMat(color, opacity = 1) {
    const m = new THREE.LineBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })
    m.userData.base = opacity; lineMats.push(m); return m
  }
  const pt = (r, lat, lon) => new THREE.Vector3(r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon))
  function latRing(radius, lat, segs = 120) {
    const r = radius * Math.cos(lat), y = radius * Math.sin(lat), pts = []
    for (let i = 0; i <= segs; i++) { const a = (i / segs) * Math.PI * 2; pts.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a))) }
    return new THREE.BufferGeometry().setFromPoints(pts)
  }
  function meridian(radius, lon, segs = 120) {
    const pts = []
    for (let i = 0; i <= segs; i++) pts.push(pt(radius, (i / segs) * Math.PI - Math.PI / 2, lon))
    return new THREE.BufferGeometry().setFromPoints(pts)
  }

  // Layer 1: outer shell
  const outerShell = new THREE.Group(), R1 = 2.0
  const latCount = 15 * detail
  for (let i = -latCount; i <= latCount; i++) {
    const lat = (i / latCount) * (Math.PI / 2) * 0.95
    const major = i % (3 * detail) === 0
    outerShell.add(new THREE.Line(latRing(R1, lat), lineMat(major ? C_MID : C_FAINT, major ? 0.5 : 0.12)))
  }
  for (let i = 0; i < 24 * detail; i++) {
    const major = i % (6 * detail) === 0
    outerShell.add(new THREE.Line(meridian(R1, (i / (24 * detail)) * Math.PI * 2), lineMat(major ? C_MID : C_FAINT, major ? 0.6 : 0.1)))
  }
  for (let i = 0; i < 4; i++) {
    const lon = (i / 4) * Math.PI * 2
    for (let j = 0; j < 18; j++) {
      const t = (j / 17) * 2 - 1, offset = (t * 0.25) / 2, falloff = 1 - Math.abs(t) * 0.7
      outerShell.add(new THREE.Line(meridian(R1, lon + offset, 200), lineMat(Math.abs(t) < 0.3 ? C_BRIGHT : C_MID, 0.85 * falloff)))
    }
  }
  for (let j = 0; j < 20; j++) {
    const t = (j / 19) * 2 - 1, offset = (t * 0.35) / 2, falloff = 1 - Math.abs(t) * 0.65
    outerShell.add(new THREE.Line(latRing(R1, offset, 200), lineMat(Math.abs(t) < 0.3 ? C_BRIGHT : C_MID, 0.8 * falloff)))
  }
  orbGroup.add(outerShell)

  // Layer 2: grid panels
  const panelGroup = new THREE.Group()
  function spherePanel(latC, lonC, latSpan, lonSpan, radius, divisions = 4) {
    const group = new THREE.Group(), mat = lineMat(C_DIM, 0.25)
    for (let i = 0; i <= divisions; i++) {
      const lat = latC - latSpan / 2 + (i / divisions) * latSpan, pts = []
      for (let j = 0; j <= divisions * 4; j++) pts.push(pt(radius, lat, lonC - lonSpan / 2 + (j / (divisions * 4)) * lonSpan))
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat))
    }
    for (let j = 0; j <= divisions; j++) {
      const lon = lonC - lonSpan / 2 + (j / divisions) * lonSpan, pts = []
      for (let i = 0; i <= divisions * 4; i++) pts.push(pt(radius, latC - latSpan / 2 + (i / (divisions * 4)) * latSpan, lon))
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat))
    }
    return group
  }
  for (let i = 0; i < 30 * detail; i++) {
    const size = 0.15 + Math.random() * 0.25
    panelGroup.add(spherePanel((Math.random() - 0.5) * Math.PI * 0.8, Math.random() * Math.PI * 2, size, size, R1 + 0.01, 3 + Math.floor(Math.random() * 3)))
  }
  orbGroup.add(panelGroup)

  // Layer 3: secondary shell arcs
  const shell2 = new THREE.Group(), R2 = 2.12
  for (let i = 0; i < 16 * detail; i++) {
    const lat = (Math.random() - 0.5) * Math.PI * 0.85, start = Math.random() * Math.PI * 2, len = 0.3 + Math.random() * 1.2, pts = []
    const r = R2 * Math.cos(lat), y = R2 * Math.sin(lat)
    for (let j = 0; j <= 60; j++) { const a = start + (j / 60) * len; pts.push(new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a))) }
    shell2.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(C_MID, 0.2 + Math.random() * 0.3)))
  }
  for (let i = 0; i < 12 * detail; i++) {
    const lon = Math.random() * Math.PI * 2, start = (Math.random() - 0.5) * Math.PI * 0.8, len = 0.3 + Math.random() * 0.8, pts = []
    for (let j = 0; j <= 40; j++) pts.push(pt(R2, start + (j / 40) * len, lon))
    shell2.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(C_DIM, 0.15 + Math.random() * 0.2)))
  }
  orbGroup.add(shell2)

  // Layer 4: inner core spirals
  const innerCore = new THREE.Group(), R3 = 0.9
  for (let s = 0; s < 8 * detail; s++) {
    const pts = [], turns = 3 + Math.random() * 2, phase = (s / (8 * detail)) * Math.PI * 2
    for (let i = 0; i <= 300; i++) { const t = i / 300; pts.push(pt(R3, t * Math.PI - Math.PI / 2, t * turns * Math.PI * 2 + phase)) }
    innerCore.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(C_BRIGHT, 0.3 + Math.random() * 0.2)))
  }
  for (let i = -6 * detail; i <= 6 * detail; i++) innerCore.add(new THREE.Line(latRing(R3, (i / (6 * detail)) * (Math.PI / 2) * 0.9, 80), lineMat(C_DIM, 0.2)))
  for (let i = 0; i < 12 * detail; i++) innerCore.add(new THREE.Line(meridian(R3, (i / (12 * detail)) * Math.PI * 2, 80), lineMat(C_DIM, 0.15)))
  orbGroup.add(innerCore)

  // Layer 5: hot centre
  const icoWireMat = lineMat(C_HOT, 0.9)
  const icoWire = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.25, 1)), icoWireMat)
  orbGroup.add(icoWire)
  const coreSphereMat = new THREE.MeshBasicMaterial({ color: C_HOT, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending })
  const coreSphere = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), coreSphereMat); orbGroup.add(coreSphere)
  const glowSphereMat = new THREE.MeshBasicMaterial({ color: C_MID, transparent: true, opacity: 0.04, blending: THREE.AdditiveBlending })
  const glowSphere = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), glowSphereMat); orbGroup.add(glowSphere)

  // Code text sprites
  const codeSnippets = PIECES
  const textTextures = new Map()
  function textTexture(text) {
    let tex = textTextures.get(text)
    if (tex) return tex
    const c = document.createElement('canvas'); c.width = 512; c.height = 64
    const ctx = c.getContext('2d'); ctx.font = 'bold 28px Courier New'
    ctx.fillStyle = 'rgb(255, 170, 40)'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, 256, 32)
    tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false
    textTextures.set(text, tex)
    return tex
  }
  function textSprite(text, size) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: textTexture(text), transparent: true, opacity: 0.35 + Math.random() * 0.55, blending: THREE.AdditiveBlending, depthWrite: false }))
    s.scale.set(size * 5, size * 0.7, 1); return s
  }
  function scatterText(count, sizeFn, rFn, speed) {
    const group = new THREE.Group()
    if (floating) return group // Owner's choice: her living form carries no floating text.
    for (let i = 0; i < count; i++) {
      const sp = textSprite(codeSnippets[Math.floor(Math.random() * codeSnippets.length)], sizeFn())
      const phi = Math.acos(2 * Math.random() - 1), theta = Math.random() * Math.PI * 2, r = rFn()
      sp.position.set(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta))
      sp.userData = { phi, theta, r, speed: (speed[0] + Math.random() * speed[1]) * (Math.random() > 0.5 ? 1 : -1) }
      group.add(sp)
    }
    return group
  }
  const density = profile.density
  const textOuter = scatterText(Math.round(1200 * density), () => 0.04 + Math.random() * 0.04, () => R1 + 0.03 + Math.random() * 0.08, [0.0002, 0.0008])
  const textInner = scatterText(Math.round(100 * density), () => 0.03 + Math.random() * 0.03, () => R3 + 0.02, [0.0005, 0.001])
  const textAmbient = scatterText(Math.round(400 * density), () => 0.03, () => R3 + 0.2 + Math.random() * (R1 - R3 - 0.3), [0.0003, 0.0006])
  orbGroup.add(textOuter, textInner, textAmbient)

  // Orbiting debris
  const debrisGeos = [new THREE.IcosahedronGeometry(0.012, 0), new THREE.IcosahedronGeometry(0.02, 0), new THREE.IcosahedronGeometry(0.03, 1),
    new THREE.IcosahedronGeometry(0.008, 0), new THREE.TetrahedronGeometry(0.015, 0), new THREE.OctahedronGeometry(0.018, 0)]
  const debris = []
  for (let i = 0; i < Math.round(250 * density); i++) {
    const mesh = new THREE.Mesh(debrisGeos[Math.floor(Math.random() * debrisGeos.length)],
      new THREE.MeshBasicMaterial({ color: Math.random() > 0.7 ? C_BRIGHT : C_MID, transparent: true, opacity: 0.3 + Math.random() * 0.6, blending: THREE.AdditiveBlending }))
    const orbitR = 1.2 + Math.random() * 4.0, phase = Math.random() * Math.PI * 2
    mesh.userData = { orbitR, speed: (0.08 + Math.random() * 0.6) * (Math.random() > 0.5 ? 1 : -1), tiltX: (Math.random() - 0.5) * Math.PI * 0.9, tiltZ: (Math.random() - 0.5) * Math.PI * 0.5, phase }
    debris.push(mesh); orbGroup.add(mesh)
    if (Math.random() > 0.85) {
      const pts = []
      for (let j = 0; j <= 15; j++) { const a = -(j / 15) * 0.3; pts.push(new THREE.Vector3(orbitR * Math.cos(a + phase), orbitR * 0.08 * Math.sin(a * 3), orbitR * Math.sin(a + phase))) }
      mesh.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(C_FAINT, 0.08)))
    }
  }

  // Dust
  const dustCount = Math.round(2000 * density), dustPos = new Float32Array(dustCount * 3)
  for (let i = 0; i < dustCount; i++) {
    const rr = 0.5 + Math.pow(Math.random(), 0.6) * 7, theta = Math.random() * Math.PI * 2, phi = Math.acos(2 * Math.random() - 1)
    dustPos[i * 3] = rr * Math.sin(phi) * Math.cos(theta); dustPos[i * 3 + 1] = rr * Math.cos(phi); dustPos[i * 3 + 2] = rr * Math.sin(phi) * Math.sin(theta)
  }
  const dustGeo = new THREE.BufferGeometry(); dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(dustPos, 3))
  const dotC = document.createElement('canvas'); dotC.width = dotC.height = 64
  const dCtx = dotC.getContext('2d'), g = dCtx.createRadialGradient(32, 32, 0, 32, 32, 32)
  g.addColorStop(0, 'rgba(255,170,48,1)'); g.addColorStop(0.2, 'rgba(255,120,20,0.6)'); g.addColorStop(0.5, 'rgba(200,80,0,0.15)'); g.addColorStop(1, 'rgba(100,40,0,0)')
  dCtx.fillStyle = g; dCtx.fillRect(0, 0, 64, 64)
  const dustMat = new THREE.PointsMaterial({ map: new THREE.CanvasTexture(dotC), size: 0.04, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, color: C_BRIGHT })
  const dustPoints = new THREE.Points(dustGeo, dustMat); orbGroup.add(dustPoints)

  // Scan rings
  function scanRing(radius, thickness) {
    const mesh = new THREE.Mesh(new THREE.RingGeometry(radius - thickness, radius + thickness, 120),
      new THREE.MeshBasicMaterial({ color: C_BRIGHT, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }))
    mesh.rotation.x = Math.PI / 2; return mesh
  }
  const scanRing1 = scanRing(R1, 0.01), scanRing2 = scanRing(R1 * 0.7, 0.008); orbGroup.add(scanRing1, scanRing2)
  if (floating) for (const part of [outerShell, panelGroup, shell2, innerCore, icoWire, coreSphere, glowSphere, scanRing1, scanRing2]) part.visible = false

  // Hex nodes
  for (let i = 0; i < 15 * detail; i++) {
    const phi = Math.acos(2 * Math.random() - 1), theta = Math.random() * Math.PI * 2, r = R1 + 0.02
    const hex = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CircleGeometry(0.03 + Math.random() * 0.02, 6)), lineMat(C_MID, 0.5))
    hex.position.set(r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(theta)); hex.lookAt(0, 0, 0); outerShell.add(hex)
  }

  // Phase drive: smoothed towards the active phase's targets each frame.
  const drive = { glow: 0.55, speed: 0.5, beat: 0, tint: new THREE.Color(PHASES.dormant.tint), target: PHASES.dormant }
  const tintTarget = new THREE.Color()
  function setPhase(phase) { drive.target = PHASES[phase] || PHASES.dormant }
  const moodTarget = new THREE.Vector3(1, 0.667, 0.188)
  let isActive = false, activeLevel = 0
  function setMood(rgb) { moodTarget.set(rgb[0] / 255, rgb[1] / 255, rgb[2] / 255) }
  function setActive(next) { isActive = Boolean(next) }
  let rageTarget = 0, rageLevel = 0
  function setRage(next) { rageTarget = Math.max(0, Math.min(1, Number(next) || 0)) }

  // Manual clock (THREE.Clock is deprecated in r185).
  let last = performance.now(), elapsed = 0
  const clock = { getDelta() { const now = performance.now(), d = (now - last) / 1000; last = now; elapsed += d; return d }, getElapsedTime: () => elapsed }
  let flickerTimer = 0, rafId = 0, disposed = false, paused = false
  let lastFrame = 0, formTime = 40, frameAverage = 0.016, sinceScale = 0, chargeLevel = 0.3
  // Same outline as the shader, so the text of her parts rides on the moving surface.
  const surface = (x, y, z, t) => 1.5 + 0.30 * Math.sin(2.1 * x + t * 0.5 + 1.7 * Math.sin(1.9 * y - t * 0.37))
    + 0.22 * Math.sin(3.3 * y - t * 0.41 + 2 * z) + 0.14 * Math.sin(5.1 * z + t * 0.63 + 2.3 * x)
  function animate() {
    if (disposed) return
    rafId = requestAnimationFrame(animate)
    if (paused) return
    if (maxFps && performance.now() - lastFrame < 1000 / maxFps - 2) return
    lastFrame = performance.now()
    const dt = Math.min(clock.getDelta(), 0.1), t = clock.getElapsedTime()
    const k = Math.min(1, dt * 2.5)
    drive.glow += (drive.target.glow - drive.glow) * k
    drive.speed += (drive.target.speed - drive.speed) * k
    drive.beat += (drive.target.beat - drive.beat) * k
    drive.tint.lerp(tintTarget.set(drive.target.tint), k)
    chromaticPass.uniforms.uTint.value.copy(drive.tint)
    chromaticPass.uniforms.uMood.value.lerp(moodTarget, Math.min(1, dt * 3))
    activeLevel += ((isActive ? 1 : 0) - activeLevel) * Math.min(1, dt * 6)
    const sp = drive.speed * (1 + activeLevel * 0.5), glow = drive.glow + activeLevel * 0.25
    rageLevel += (rageTarget - rageLevel) * Math.min(1, dt * 2.5)
    chromaticPass.uniforms.uRage.value = rageLevel
    formTime += dt * (0.55 + sp * 0.5) * (1 + rageLevel * 1.6)
    chargeLevel += (Math.min(1, glow * (0.55 + 0.25 * Math.min(sp, 2))) - chargeLevel) * Math.min(1, dt * 3)
    if (floating) {
      // Hand GPU time back to her models if the form ever gets too expensive: only ever scales down.
      frameAverage += (dt - frameAverage) * 0.05; sinceScale += dt
      if (frameAverage > 0.03 && sinceScale > 2 && renderScale > 1) {
        renderScale = Math.max(1, renderScale - 0.25); sinceScale = 0
        renderer.setPixelRatio(renderScale); composer?.setPixelRatio(renderScale)
      }
    }
    for (const m of lineMats) m.opacity = m.userData.base * (0.35 + 0.65 * glow)
    dustMat.opacity = 0.5 * glow

    outerShell.rotation.y += 0.0015 * sp; outerShell.rotation.x = Math.sin(t * 0.08) * 0.05
    panelGroup.rotation.y += 0.0018 * sp; panelGroup.rotation.x = Math.sin(t * 0.08 + 0.5) * 0.04
    shell2.rotation.y -= 0.001 * sp; shell2.rotation.z = Math.sin(t * 0.12) * 0.03
    innerCore.rotation.y -= 0.005 * sp; innerCore.rotation.z += 0.002 * sp; innerCore.rotation.x = Math.cos(t * 0.1) * 0.08
    icoWire.rotation.x += 0.008 * sp; icoWire.rotation.y += 0.012 * sp

    // Core pulse: the original's slow surges, plus a speech beat while she responds.
    const wave1 = Math.sin(t * 1.2)
    const wave3 = Math.pow(Math.max(0, Math.sin(t * 0.4)), 5), wave4 = Math.pow(Math.max(0, Math.sin(t * 0.7 + 2)), 8)
    const fadeOut = Math.pow(Math.max(0, Math.sin(t * 0.25)), 3) * (1 - drive.beat)
    const speech = drive.beat * (0.35 + 0.35 * Math.max(0, Math.sin(t * 6.3)) * Math.max(0, Math.sin(t * 2.1 + 1)))
    const surge = (wave3 * 1.5 + wave4 * 2.0) * (0.4 + 0.6 * glow) + speech * 2
    coreSphere.scale.setScalar(1 + surge + Math.sin(t * 5) * 0.05)
    coreSphereMat.opacity = Math.min(0.6, Math.max(0, (0.08 + wave1 * 0.05 + surge * 0.2) * (1 - fadeOut * 0.95)) * (0.3 + 0.7 * glow))
    glowSphere.scale.setScalar(1 + surge * 0.8)
    glowSphereMat.opacity = Math.max(0, (0.03 + surge * 0.08) * (1 - fadeOut * 0.9)) * glow
    icoWire.scale.setScalar(1 + surge * 0.6)
    icoWireMat.opacity = Math.min(1, (0.5 + surge * 0.4) * (0.4 + 0.6 * glow))

    for (const d of debris) {
      const u = d.userData, a = t * u.speed * (0.6 + 0.4 * sp) + u.phase
      d.position.set(u.orbitR * Math.cos(a) * Math.cos(u.tiltX), u.orbitR * Math.sin(u.tiltX) * Math.sin(a * 0.8) + Math.sin(a * 0.3 + u.tiltZ) * 0.2, u.orbitR * Math.sin(a) * Math.cos(u.tiltZ))
      d.rotation.x += 0.015; d.rotation.z += 0.01
    }
    for (const [group, mult] of [[textOuter, 1], [textInner, 2], [textAmbient, 1.2]]) {
      for (const s of group.children) {
        const u = s.userData; u.theta += u.speed * mult * (0.5 + 0.5 * sp)
        const nx = Math.sin(u.phi) * Math.cos(u.theta), ny = Math.cos(u.phi), nz = Math.sin(u.phi) * Math.sin(u.theta)
        const ride = floating ? (surface(nx, ny, nz, formTime) * u.r) / 2.05 : u.r
        s.position.set(ride * nx, ride * ny, ride * nz)
      }
    }
    const scanY1 = Math.sin(t * 0.4 * (0.5 + sp)) * R1, scanS1 = Math.sqrt(Math.max(0, R1 * R1 - scanY1 * scanY1)) / R1
    scanRing1.position.y = scanY1; scanRing1.scale.set(scanS1, scanS1, 1); scanRing1.material.opacity = 0.2 * scanS1 * glow
    const scanY2 = Math.sin(t * 0.6 * (0.5 + sp) + 2) * R3, scanS2 = Math.sqrt(Math.max(0, R3 * R3 - scanY2 * scanY2)) / R3
    scanRing2.position.y = scanY2; scanRing2.scale.set(scanS2, scanS2, 1); scanRing2.material.opacity = 0.15 * scanS2 * glow
    dustPoints.rotation.y += 0.0002 * sp
    if (!REDUCED) {
      flickerTimer += dt
      if (flickerTimer > 0.1) { flickerTimer = 0; for (const p of panelGroup.children) if (Math.random() > (sp > 1.5 ? 0.9 : 0.95)) p.visible = !p.visible }
    }
    bloom.strength = ((1.2 + Math.sin(t * 0.8) * 0.3) * (0.5 + 0.5 * glow) + speech) * (floating ? 0.5 : 1)
    chromaticPass.uniforms.uTime.value = t
    chromaticPass.uniforms.uForm.value.set(formTime, chargeLevel, speech, activeLevel)
    controls.update()
    if(composer) composer.render(); else renderer.render(scene,camera)
  }
  scheduleSceneStart({scheduleFrame:requestAnimationFrame,scheduleTask:fn=>setTimeout(fn,0),
    compile:()=>renderer.compileAsync ? renderer.compileAsync(scene,camera) : Promise.resolve(),
    start:animate,isDisposed:()=>disposed,onError:error=>console.warn('[nori-orb] shader initialization failed',error)})

  function onResize() {
    const w = container.clientWidth || innerWidth, h = container.clientHeight || innerHeight
    camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h); composer?.setSize(w, h)
  }
  addEventListener('resize', onResize)
  // The first layout can report a zero-size container; size everything again once the page has painted.
  requestAnimationFrame(() => requestAnimationFrame(onResize))
  const onVisibility = () => { paused = document.hidden; if (!paused) clock.getDelta() }
  document.addEventListener('visibilitychange', onVisibility)

  function dispose() {
    disposed = true; cancelAnimationFrame(rafId)
    removeEventListener('resize', onResize); document.removeEventListener('visibilitychange', onVisibility)
    controls.dispose()
    scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose()
      for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) { if (!mat) continue; mat.map?.dispose(); mat.dispose() }
    })
    composer?.dispose(); renderer.dispose(); renderer.domElement.remove()
  }
  return {
    setPhase, setMood, setActive, setRage, dispose,
    pause: () => { paused = true }, resume: () => { paused = false; clock.getDelta() },
    resetView: () => { camera.position.copy(HOME_POSITION); controls.target.set(0, 0, 0); camera.lookAt(controls.target); controls.update() },
  }
}

