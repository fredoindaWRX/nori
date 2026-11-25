// The megastructure inside Nori, matched to the owner's reference clip (frames saved 2026-11-14): a canyon of
// dark solid blocks built up in masses (rooftop fields, cube lattices, shelves, towers, big walls, fine greebles)
// with tiny lit windows, a few lit districts in blue with orange blocks, dark voids, and depth haze.
// Her real memories sit inside this structure. structureCells() is pure maths (testable in Node);
// createStructure() draws it with one instanced mesh, and blockMaterial() is shared with city-detail.js.

function seeded(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296 } }

// Her memory districts reach about 5.2 from the axis and the camera stands beside them, so the structure starts
// beyond that: no block centre is closer than this to the flight path's axis.
export const AVENUE_CLEAR = 7.4
export const KIND = Object.freeze({ dark: 0, cyan: 1, white: 2, warm: 3, green: 4, red: 5 })
const SEEN_CLEAR = 6.5          // no part of any block reaches closer to the axis than this
const TAU = Math.PI * 2

// Up to 4 hot spots (x, y, z, strength) that light the blocks around a recalled memory. city-detail.js writes it.
export const HOT_LIGHTS = { value: new Float32Array(16) }

// Returns { count, position, scale, kind, seed, glow } as typed arrays.
// kind is the colour of a block's lights; glow 0 means small windows on a dark block, above 0 the whole block is lit.
export function structureCells(wanted = 42000, seed = 0x4e4f5249) {
  const n = Math.max(0, Math.floor(wanted)), rand = seeded(seed)
  const position = new Float32Array(n * 3), scale = new Float32Array(n * 3), kind = new Float32Array(n), cellSeed = new Float32Array(n), glow = new Float32Array(n)
  let i = 0
  const snap = (v, g = 0.1) => Math.round(v / g) * g
  const put = (x, y, z, sx, sy, sz, k, g) => {
    if (i >= n) return
    const nx = Math.max(Math.abs(x) - sx / 2, 0) / 1.25, ny = Math.max(Math.abs(y) - sy / 2, 0) / 0.72
    if (Math.hypot(nx, ny) < SEEN_CLEAR || Math.hypot(x / 1.25, y / 0.72) < AVENUE_CLEAR + 0.01) return
    position[i * 3] = x; position[i * 3 + 1] = y; position[i * 3 + 2] = z
    scale[i * 3] = sx; scale[i * 3 + 1] = sy; scale[i * 3 + 2] = sz
    kind[i] = k; glow[i] = g; cellSeed[i] = rand(); i++
  }
  const wall = (theta, z) => 9.5 + 1.1 * Math.sin(z * 0.21 + theta * 2) + 0.6 * Math.sin(z * 0.53 + 1.7)
  const tone = () => { const k = rand(); return k < 0.5 ? KIND.cyan : k < 0.78 ? KIND.white : k < 0.94 ? KIND.warm : k < 0.97 ? KIND.green : KIND.red }

  // Lit districts: patches of wall where most blocks glow blue with a few orange ones (the clip's second frame).
  const lit = []
  for (let d = 0; d < 11; d++) { const z = -5 - rand() * 50, th = rand() * TAU, r = wall(th, z); lit.push([Math.cos(th) * r * 1.25, Math.sin(th) * r * 0.72, z, 1.6 + rand() * 2.4]) }
  const inLit = (x, y, z) => { for (const d of lit) if (Math.hypot(x - d[0], y - d[1], z - d[2]) < d[3]) return true; return false }

  // Backing: big dark panels behind everything, so gaps read as dark mass, not open sky.
  const panels = Math.min(Math.floor(n * 0.06), 520)
  for (let b = 0; b < panels; b++) {
    const slot = (b * 193) % 520, th = ((slot % 20) + rand()) / 20 * TAU, z = 4 - (Math.floor(slot / 20) + rand()) / 26 * 64
    const r = wall(th, z) + 2.2 + rand() * 1.2, flat = Math.abs(Math.sin(th)) > 0.62
    put(Math.cos(th) * r * 1.25, Math.sin(th) * r * 0.72, z, flat ? 4.8 : 1.6, flat ? 1.4 : 3.8, 3.4, KIND.dark, 0)
  }

  // Everything else is built in masses standing on the canyon wall and rising towards the avenue.
  let guard = n * 3 + 2000
  while (i < n && guard-- > 0) {
    const z = 3 - rand() * 62, pick = rand()
    const theta = pick < 0.3 ? -Math.PI / 2 + (rand() - 0.5) * 1.7 : pick < 0.44 ? Math.PI / 2 + (rand() - 0.5) * 1.4 : rand() * TAU
    // Voids: stretches of wall with almost nothing on them.
    const gap = Math.sin(z * 0.37 + 1.3) * Math.sin(theta * 3 + z * 0.11) + 0.5 * Math.sin(theta * 5 - z * 0.23 + 2)
    if (gap > 0.8 && rand() < 0.7) continue
    const r = wall(theta, z), a = Math.abs(Math.sin(theta)) > 0.62 ? 1 : 0, t = 1 - a
    const A = [snap(Math.cos(theta) * r * 1.25, 0.2), snap(Math.sin(theta) * r * 0.72, 0.2), snap(z, 0.2)], s = A[a] > 0 ? -1 : 1
    const level = rand(), chance = level < 0.4 ? 0.02 : level < 0.85 ? 0.16 : 0.45
    // u runs along the wall, v along the avenue, w0 is the height of the block's base above the wall.
    const box = (u, v, w0, du, dv, dw, forceKind, forceGlow) => {
      const p = [0, 0, A[2] + v], size = [0, 0, dv]
      p[t] = A[t] + u; p[a] = A[a] + s * (w0 + dw / 2); size[t] = du; size[a] = dw
      let k = KIND.dark, g = 0
      if (forceKind !== undefined) { k = forceKind; g = forceGlow || 0 }
      else if (inLit(p[0], p[1], p[2])) {
        const q = rand()
        if (q < 0.2) { g = 0.25 + rand() * 0.6; const c = rand(); k = c < 0.8 ? KIND.cyan : c < 0.93 ? KIND.warm : KIND.white }
        else if (q < 0.8) k = tone()
      } else if (rand() < chance) { k = tone(); if (Math.max(du, dv, dw) < 0.2) g = 1 }      // tiny lit blocks are lights themselves
      put(p[0], p[1], p[2], size[0], size[1], size[2], k, g)
    }
    const type = rand()
    if (type < 0.34) {
      // Rooftop field: a grid of small blocks of uneven height.
      const p = [0.12, 0.16, 0.2][(rand() * 3) | 0], U = 9 + ((rand() * 16) | 0), V = 9 + ((rand() * 16) | 0), tall = rand() * rand() * 1.4
      for (let u = 0; u < U; u++) for (let v = 0; v < V; v++) {
        if (rand() < 0.22) continue
        const fu = rand() < 0.2 ? 2 : 1, fv = rand() < 0.2 ? 2 : 1, h = p * (0.35 + rand() * rand() * 3) + tall * rand() * rand()
        box((u - U / 2 + (fu - 1) / 2) * p, (v - V / 2 + (fv - 1) / 2) * p, -0.3, fu * p * 0.92, fv * p * 0.92, h + 0.3)
      }
    } else if (type < 0.52) {
      // Cube lattice: equal cubes in rows with gaps, a few layers deep.
      const c = [0.14, 0.19, 0.25][(rand() * 3) | 0], pitch = c * 1.14, U = 7 + ((rand() * 13) | 0), V = 7 + ((rand() * 13) | 0), layers = 1 + ((rand() * 3) | 0)
      for (let l = 0; l < layers; l++) for (let u = 0; u < U; u++) for (let v = 0; v < V; v++) {
        if (rand() > 0.82 - l * 0.3) continue
        box((u - U / 2) * pitch, (v - V / 2) * pitch, l * pitch, c, c, c)
      }
    } else if (type < 0.66) {
      // Shelves: long thin slabs stacked with gaps, always thin in the vertical.
      const rows = 6 + ((rand() * 15) | 0), pitch = 0.14 + rand() * 0.1, th = 0.05 + rand() * 0.04, along = rand() < 0.7
      for (let j = 0; j < rows; j++) {
        if (rand() < 0.15) continue
        const len = snap(0.8 + rand() * 2.4), wid = snap(0.3 + rand() * 0.5), off = snap((rand() - 0.5) * 1.2)
        if (a === 0) box((j - rows / 2) * pitch, off, -0.1, th, len, wid + 0.1)
        else box(along ? snap((rand() - 0.5) * 0.6) : off, along ? off : snap((rand() - 0.5) * 0.6), j * pitch, along ? wid : len, along ? len : wid, th)
      }
    } else if (type < 0.78) {
      // Towers: thin pillars, standing out from the wall or running along it.
      const pillars = 8 + ((rand() * 21) | 0), out = rand() < 0.55
      for (let j = 0; j < pillars; j++) {
        const f = snap(0.1 + rand() * 0.2, 0.05), len = snap(0.8 + rand() * rand() * 3), u = snap((rand() - 0.5) * 2.6), v = snap((rand() - 0.5) * 2.6)
        if (out) box(u, v, -0.3, f, f, len + 0.3); else box(u, v, snap(rand() * 0.6), len, f, f)
      }
    } else if (type < 0.88) {
      // One big block with small plates on its face.
      const du = snap(1.2 + rand() * 2.4, 0.2), dv = snap(1.2 + rand() * 2.4, 0.2), dw = snap(0.6 + rand() * 1.2, 0.2)
      box(0, 0, -0.4, du, dv, dw + 0.4)
      const plates = 15 + ((rand() * 31) | 0)
      for (let j = 0; j < plates; j++) box(snap((rand() - 0.5) * (du - 0.3)), snap((rand() - 0.5) * (dv - 0.3)), dw, snap(0.1 + rand() * 0.4), snap(0.1 + rand() * 0.4), 0.04 + rand() * 0.16)
    } else if (type < 0.985) {
      // Greebles: a scatter of very small blocks.
      const bits = 60 + ((rand() * 91) | 0)
      for (let j = 0; j < bits; j++) box(snap((rand() - 0.5) * 2.2, 0.05), snap((rand() - 0.5) * 2.2, 0.05), snap(rand() * rand() * 0.6, 0.05), 0.06 + ((rand() * 7) | 0) * 0.02, 0.06 + ((rand() * 7) | 0) * 0.02, 0.06 + ((rand() * 7) | 0) * 0.02)
    } else {
      // Ember: a tight stack of glowing orange slabs in a dark housing, like the hot blocks in the clip.
      const w = 0.4 + rand() * 0.3
      box(0, 0, -0.3, w + 0.2, w + 0.2, 0.35, KIND.dark, 0)
      for (let j = 0; j < 7; j++) { if (a === 0) box((j - 3) * 0.07, 0, 0.05, 0.045, w, w * 0.8, KIND.warm, 1); else box(0, 0, 0.1 + j * 0.07, w, w, 0.045, KIND.warm, 1) }
    }
  }
  // Whatever could not be placed becomes dust far behind the wall.
  while (i < n) { const th = rand() * TAU, z = 3 - rand() * 62; put(Math.cos(th) * 17, Math.sin(th) * 10, z, 0.2, 0.2, 0.2, KIND.dark, 0) }
  return { count: n, position, scale, kind, seed: cellSeed, glow }
}

// The one shader every block in the city uses. Instances carry aKind, aSeed and aGlow.
export function blockMaterial(THREE) {
  return new THREE.ShaderMaterial({
    uniforms: { uT: { value: 0 }, uHot: HOT_LIGHTS, uLift: { value: 0 } },
    vertexShader: [
      'attribute float aKind;attribute float aSeed;attribute float aGlow;',
      'varying vec2 vUv;varying vec3 vN;varying vec3 vP;varying vec3 vSize;varying vec4 vBlock;varying vec3 vField;varying float vDepth;',
      'float h3(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}',
      'float vnoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);',
      '  return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),',
      '             mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}',
      'void main(){',
      '  vUv=uv;vN=normal;vBlock=vec4(aKind,aSeed,aGlow,0.0);',
      '  vSize=vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));',
      '  vec3 c=instanceMatrix[3].xyz;',
      // Slow fields over the whole city, worked out once per block: how bright its stone is, how many windows are on.
      '  vField=vec3(vnoise(c*0.33+7.0),vnoise(c*0.21+31.0),vnoise(c*0.7+3.0));',
      '  vec4 wp=instanceMatrix*vec4(position,1.0);vP=wp.xyz;',
      '  vec4 mv=modelViewMatrix*wp;vDepth=-mv.z;gl_Position=projectionMatrix*mv;}',
    ].join('\n'),
    fragmentShader: [
      'uniform float uT;uniform vec4 uHot[4];uniform float uLift;',
      'varying vec2 vUv;varying vec3 vN;varying vec3 vP;varying vec3 vSize;varying vec4 vBlock;varying vec3 vField;varying float vDepth;',
      'float h2(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}',
      'void main(){',
      '  float kind=vBlock.x,seed=vBlock.y,glow=vBlock.z;',
      '  vec3 an=abs(vN);',
      // Face size in world units, so windows and bevels are the same size on every block.
      '  vec2 fs=an.x>0.5?vSize.zy:an.y>0.5?vSize.xz:vSize.xy;',
      '  float face=an.x>0.5?1.0:an.y>0.5?2.0:3.0;face+=dot(vN,vec3(0.25));',
      '  vec2 f=vUv*fs;vec2 e2=min(f,fs-f);float d=min(e2.x,e2.y);',
      '  float px=max(fwidth(f.x),fwidth(f.y));float bw=max(0.008,px*1.1);',
      '  float edge=(1.0-smoothstep(0.0,bw,d))*clamp(0.008/bw*1.6,0.0,1.0);',
      // Light comes from the avenue (the open middle) and a little from above and from the entrance.
      '  vec3 toAxis=normalize(vec3(-vP.x*0.64,-vP.y*1.93,0.0001));',
      '  float lam=max(dot(vN,toAxis),0.0);',
      '  float top=max(vN.y,0.0);',
      // 2026-11-23 (owner, out past the outer walls: "I feel like I'm in that void that's in space"): faces that look away
      // from the avenue get light too, and the unlit floor is higher, so the outside of her is a lit city, not a black mass.
      '  float back=max(-dot(vN,toAxis),0.0);',
      '  float shade=0.2+0.6*lam+0.38*back+0.22*abs(vN.z)+(0.42+uLift*3.0)*top+0.16*max(-vN.y,0.0);',
      '  float stone=(0.4+0.8*seed)*(0.3+1.4*vField.x*vField.x)+uLift;',
      '  vec3 col=vec3(0.34,0.6,0.68)*shade*stone*1.35;',
      // 2026-11-17 (owner's clip frames): the clip's walls are built from far smaller blocks than hers. Every face is
      // cut into sub-blocks about a tenth of a unit across, each with its own shade, a dark seam round it and a pale
      // upper edge. Far away, where the sub-blocks are smaller than a pixel, this fades to its average.
      '  vec2 pg=f/0.095;vec2 pid=floor(pg);vec2 pq=fract(pg);float pfw=max(fwidth(pg.x),fwidth(pg.y));float pfar=smoothstep(0.35,1.1,pfw);',
      '  float ps=h2(pid*1.31+face*7.1+seed*13.0);float pd=min(min(pq.x,1.0-pq.x),min(pq.y,1.0-pq.y));',
      '  float seam=(1.0-smoothstep(0.03,0.07+pfw,pd))*(1.0-pfar);',
      '  col*=mix(0.6+1.0*ps*ps,0.95,pfar);col*=1.0-0.8*seam;',
      '  col+=vec3(0.36,0.5,0.5)*(1.0-pfar)*(1.0-seam)*smoothstep(0.2,0.07,1.0-pq.y)*(0.03+0.3*top+0.22*lam)*(0.3+0.7*ps);',
      // 2026-11-17 (owner: "make it more detailed"): inside every sub-block, one of three kinds of fine work, each drawn
      // hard-edged and faded out before it gets smaller than a pixel: vent slats, a plate with four rivets, or thin
      // circuit traces that carry a slow pulse.
      '  float mk=h2(pid*2.11+face*3.7+seed*5.0);vec2 mg=pq*6.0;vec2 mid=floor(mg);vec2 mq=fract(mg);float mfw=pfw*6.0;',
      '  float mnear=(1.0-smoothstep(0.25,0.8,mfw))*(1.0-seam)*smoothstep(0.1,0.16,pd);',
      '  float slat=step(mk,0.28)*(1.0-smoothstep(0.16,0.16+mfw,abs(mq.y-0.5)));',
      '  vec2 rv=abs(pq-0.5)-0.3;float rivet=step(0.28,mk)*step(mk,0.5)*(1.0-smoothstep(0.035,0.035+pfw*1.5,length(rv)));',
      '  float plate=step(0.28,mk)*step(mk,0.5)*(1.0-smoothstep(0.0,pfw*1.5,abs(max(abs(pq.x-0.5),abs(pq.y-0.5))-0.2)-0.012));',
      '  float th=h2(mid+pid*7.3+face);float tdir=step(0.5,h2(mid.yx+pid*3.1));',
      '  float trace=step(0.5,mk)*step(mk,0.74)*step(0.55,th)*(1.0-smoothstep(0.1,0.1+mfw,abs(mix(mq.x,mq.y,tdir)-0.5)));',
      '  col*=1.0-0.6*slat*mnear;col+=vec3(0.4,0.55,0.56)*(rivet*0.5+plate*0.16)*mnear*(0.25+0.5*top+0.5*lam);',
      '  col+=vec3(0.1,0.3,0.34)*trace*mnear*(0.2+0.5*lam+0.4*top);',
      // A thin pale catch-light on the edges, strongest on top faces and on faces that look at the avenue.
      '  col+=vec3(0.42,0.54,0.52)*edge*(0.05+0.6*top+0.5*lam)*(0.35+0.65*stone);',
      '  vec3 tint=kind<0.5?vec3(0.55,0.9,0.95):kind<1.5?vec3(0.25,0.72,1.0):kind<2.5?vec3(0.82,0.93,1.0):kind<3.5?vec3(1.0,0.48,0.07):kind<4.5?vec3(0.2,0.9,0.45):vec3(1.0,0.14,0.1);',
      '  float on=mix(0.45,1.0,step(0.5,kind));',
      // Windows: a fine grid on each face; a few cells are lit, in runs along some rows, each its own size and brightness.
      '  vec2 cs=vec2(0.05,0.034);vec2 g=f/cs;vec2 id=floor(g);vec2 q=fract(g)-0.5;vec2 cells=floor(fs/cs);',
      '  float whole=step(id.x+0.5,cells.x)*step(id.y+0.5,cells.y);',
      '  float a1=h2(id+face*17.3+seed*91.7),a2=h2(id.yx*1.7+seed*37.1+face),row=h2(vec2(id.y,face+seed*53.0));',
      '  float prob=(0.045+0.24*smoothstep(0.3,0.8,vField.y))*(row>0.72?2.4:0.55);',
      '  float lit=step(1.0-prob,a1);',
      '  vec2 half_=mix(vec2(0.14,0.16),vec2(0.42,0.32),a2);vec2 aa=fwidth(g)*0.75+0.01;',
      '  float shape=smoothstep(half_.x+aa.x,half_.x-aa.x,abs(q.x))*smoothstep(half_.y+aa.y,half_.y-aa.y,abs(q.y));',
      '  float blink=a2>0.9?0.6+0.4*sin(uT*(1.0+a1*5.0)+a1*60.0):1.0;',
      '  float bright=(0.5+2.4*a2*a2)*blink;',
      // Far away the grid is finer than a pixel: fade to its average so it does not shimmer.
      '  float fine=smoothstep(0.45,1.4,max(fwidth(g.x),fwidth(g.y)));',
      '  vec2 wq=clamp(q/half_*0.5+0.5,0.0,1.0);vec2 wc=floor(wq*vec2(5.0,4.0));vec2 wf=fract(wq*vec2(5.0,4.0));',
      '  float bit=step(0.42,h2(wc+id*3.3+floor(uT*(0.25+a1*0.6)+a1*10.0)));',
      '  float wnear=(1.0-smoothstep(0.05,0.2,max(fwidth(g.x),fwidth(g.y))))*step(0.3,a2);',
      '  float screen=mix(1.0,(0.22+0.78*bit)*smoothstep(0.0,0.14,wf.y)*smoothstep(1.0,0.86,wf.y)*smoothstep(0.0,0.1,wf.x),wnear);',
      '  float win=mix(lit*shape*bright*screen,prob*0.3,fine)*whole*on*(1.0-step(0.001,glow));',
      '  vec3 wtint=mix(tint,vec3(0.85,0.95,1.0),step(0.8,a1*a2*4.0)*0.6);',
      '  float a3=h2(id*2.37+seed*11.3+face*3.1);',
      '  wtint=a3>0.975?vec3(1.0,0.16,0.1):a3>0.93?vec3(1.0,0.55,0.1):a3>0.9?vec3(0.25,1.0,0.6):wtint;',
      '  vec3 em=wtint*win*1.5;',
      // Windows also put a little of their colour on the stone around them.
      '  col+=tint*on*(1.0-step(0.001,glow))*prob*0.03*shade;',
      // Lit blocks: the whole block glows, brighter on the faces that look at the avenue, with a darker inset panel.
      '  float sweep=smoothstep(0.55,1.0,0.5+0.5*sin(uT*0.7+seed*37.0+vP.z*0.35+vP.y*0.9));',
      '  em+=vec3(0.08,0.78,1.0)*edge*step(0.35,seed)*(0.3+0.7*sweep)*0.85*(1.0-step(0.001,glow));',
      '  em+=vec3(0.06,0.55,0.75)*seam*top*step(0.45,vField.z)*0.35;',
      // The traces carry light: a pulse runs along them, each sub-block on its own beat.
      '  em+=vec3(0.1,0.75,0.95)*trace*mnear*(0.05+0.45*smoothstep(0.75,1.0,sin(uT*1.3+mk*40.0+(mid.x+mid.y)*0.9)));',
      '  float flick=0.82+0.18*sin(uT*(0.5+seed*2.2)+seed*40.0);',
      '  float inset=smoothstep(0.0,bw,d-min(fs.x,fs.y)*0.14);float fh=h2(vec2(face,seed*77.0));float faceLit=max(step(0.35,fh),step(0.99,glow));',
      '  float body=inset*faceLit*(0.35+0.65*fh)*(0.55+0.45*lam+0.2*max(vN.z,0.0))+0.2*edge+0.05;',
      '  em+=tint*glow*flick*body*1.1;',
      // Hot spots (a recalled memory) throw orange light on nearby blocks.
      '  for(int i=0;i<4;i++){vec3 L=uHot[i].xyz-vP;float dd=dot(L,L);col+=vec3(1.0,0.42,0.06)*uHot[i].w*(0.25+0.75*max(dot(vN,normalize(L)),0.0))*(0.05+0.2*stone)/(1.0+dd*1.5);}',
      '  float fog=clamp((vDepth-14.0)/95.0,0.0,1.0);',
      '  float fg=1.0-(1.0-fog)*(1.0-fog);',
      // Haze swallows the stone before it swallows the lights, so far windows still sparkle.
      '  col=mix(col,vec3(0.035,0.075,0.1),fg)+em*(1.0-0.5*fg);',
      // Close blocks keep their light (2026-11-23, owner: "still black blocks"): until now anything within 2.6 units of
      // the lens was drawn as a black silhouette. Only the last few centimetres dim a little, so a face never flares.
      '  gl_FragColor=vec4(col*mix(0.6,1.0,smoothstep(0.08,0.7,vDepth)),1.0);',
      '}',
    ].join('\n'),
  })
}

// One instanced mesh of unit boxes for a set of cells. material is optional (shared when given).
export function blockMesh(THREE, cells, material = blockMaterial(THREE)) {
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  geometry.setAttribute('aKind', new THREE.InstancedBufferAttribute(cells.kind, 1))
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(cells.seed, 1))
  geometry.setAttribute('aGlow', new THREE.InstancedBufferAttribute(cells.glow, 1))
  const mesh = new THREE.InstancedMesh(geometry, material, cells.count)
  const matrix = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3()
  for (let i = 0; i < cells.count; i++) {
    p.set(cells.position[i * 3], cells.position[i * 3 + 1], cells.position[i * 3 + 2]); s.set(cells.scale[i * 3], cells.scale[i * 3 + 1], cells.scale[i * 3 + 2])
    mesh.setMatrixAt(i, matrix.compose(p, q, s))
  }
  mesh.instanceMatrix.needsUpdate = true
  mesh.frustumCulled = false
  return mesh
}

export function createStructure(THREE, wanted) {
  const cells = structureCells(wanted)
  const mesh = blockMesh(THREE, cells), material = mesh.material, geometry = mesh.geometry
  return { mesh, cells, update(t) { material.uniforms.uT.value = t }, dispose() { geometry.dispose(); material.dispose() } }
}
