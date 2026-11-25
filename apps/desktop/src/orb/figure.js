// The figure itself, matched to the owner's clip frames (Screenshots 2026-11-14 194531/194535/194553):
//   - a crumpled, see-through deep blue film: a few big folded sheets, mostly dark glass you look through,
//     lit where a sheet turns edge-on or catches the light from above, with etched lines in patches
//   - two more films inside it for layered overlap
//   - a blue filter over everything inside her outline, so what is behind her reads as dark blue glass
//   - cracks of light fanning down from a wide soft core
//   - short dashes of light swirling around her in sprays, and a swarm of pale glyphs
//   - the orange Ultron figure beside her: stepped glowing traces, hot nodes, cyan flecks, lit while she uses tools
// crumple() and tracePath() are pure maths so they can be tested in Node.

function seeded(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296 } }
const fract = x => x - Math.floor(x)

// Each fold is a triangle wave across the film: direction x, y, z, how many folds, how deep, how bright its crease.
// Few, deep folds give large flat sheets. The same numbers are written into the shader below so the bright
// crease lines sit on the real creases.
const FOLDS = [[0.62, 0.51, -0.6, 0.52, 0.25, 1], [-0.44, 0.83, 0.34, 0.88, 0.15, 0.7], [0.71, -0.2, 0.67, 1.4, 0.085, 0.45], [-0.3, -0.62, 0.72, 2.4, 0.04, 0.2], [0.9, 0.35, 0.26, 3.7, 0.018, 0]]
const WARP = 0.34, CHAIN = 1.5, DEPTH = 0.75

// How far the film sits from the centre in direction (x, y, z): flat sheets meeting at sharp creases.
export function crumple(x, y, z, seed = 0) {
  const wx = x + WARP * Math.sin(y * 2.1 + seed * 1.7 + 0.5), wy = y + WARP * Math.sin(z * 1.9 - seed + 1.3), wz = z + WARP * Math.sin(x * 2.3 + seed * 0.6 + 2.1)
  let h = 0
  for (let i = 0; i < FOLDS.length; i++) {
    const F = FOLDS[i], u = (wx * F[0] + wy * F[1] + wz * F[2]) * F[3] + seed * 0.37 * (i + 1) + h * CHAIN
    // Each fold is shifted by the ones before it, which is what makes creases kink where they cross.
    h += F[4] * (Math.abs(fract(u) - 0.5) * 4 - 1)
  }
  return 1 + DEPTH * h
}

// Lumpy radius for the Ultron figure, so its outline is not a ball.
function lumps(x, y, z, seed = 0) {
  const a = x * 1.9 + seed, b = y * 1.6 - seed * 0.7, c = z * 2.1 + seed * 1.3
  return Math.sin(a + 1.6 * Math.sin(b)) * Math.sin(b * 1.1 + 1.1 * Math.sin(c)) * Math.sin(c * 0.9 + a * 0.7)
}

// A stepped walk in latitude and longitude. keep: 0 turns at random, 1 always carries on the same way (a staircase).
function walk(rand, lat, lon, steps, keep = 0, minRun = 0.05, maxRun = 0.21) {
  const out = [[lat, lon]]
  let sLon = rand() < 0.5 ? -1 : 1, sLat = rand() < 0.5 ? -1 : 1
  for (let i = 0; i < steps; i++) {
    const size = minRun + rand() * (maxRun - minRun), flip = rand() < 0.5 * (1 - keep)
    if (i % 2 === 0) { if (flip) sLon = -sLon; lon += size * sLon / Math.max(0.3, Math.cos(lat)) }
    else { if (flip) sLat = -sLat; lat = Math.max(-1.35, Math.min(1.35, lat + size * sLat)) }
    out.push([lat, lon])
  }
  return out
}
const onSphere = (lat, lon, r) => [r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon)]

// A circuit-like path on a sphere: runs along a latitude, steps, runs along a longitude, steps, like board traces.
export function tracePath(rand, radius, steps = 9) {
  const lat = (rand() - 0.5) * Math.PI * 0.9, lon = rand() * Math.PI * 2
  return walk(rand, lat, lon, steps).map(([la, lo]) => onSphere(la, lo, radius))
}

const glsl = n => (Number.isInteger(n) ? n + '.0' : String(n))
// The fold loop, unrolled for the fragment shader. Collects crease lines, their soft halo and a sheet id.
const FOLD_GLSL = FOLDS.map((F, i) => [
  `{float u=dot(w,vec3(${glsl(F[0])},${glsl(F[1])},${glsl(F[2])}))*${glsl(F[3])}+uSeed*${glsl(0.37 * (i + 1))}+h*${glsl(CHAIN)};`,
  'float fr=fract(u);',
  F[5] ? [
    'float fw=fwidth(u)+1e-5;float d=min(min(fr,1.0-fr),abs(fr-0.5));',
    // Ridges that point outward are bright, valleys faint, and every crease comes and goes along its length.
    'float peak=mix(0.16,1.0,step(0.25,abs(fr-0.5)));float thin=smoothstep(0.34,0.1,fw);float lw=max(fw*1.1,0.0035);',
    `float vary=smoothstep(0.3,0.8,0.5+0.5*sin(dot(w,vec3(${glsl(2.9 + i)},-2.1,1.7))+${glsl(1.9 * i)}+uSeed)*sin(dot(w,vec3(1.3,${glsl(2.4 - i * 0.5)},-2.6))+${glsl(0.7 + i)}));`,
    `crease+=${glsl(F[5])}*peak*thin*(0.12+0.88*vary)*(1.0-smoothstep(lw*0.4,lw*1.5,d));`,
    `halo+=${glsl(F[5])}*peak*thin*vary*exp(-d/(fw*6.0+0.004));`,
  ].join('') : '',
  i < 3 ? `id.${'xyz'[i]}=floor(u*2.0);` : '',
  `h+=${glsl(F[4])}*(abs(fr-0.5)*4.0-1.0);}`,
].join('')).join('\n')

const MEMBRANE_VERTEX = 'varying vec3 vPos;varying vec3 vView;varying vec3 vN;varying vec3 vNx;varying vec3 vNy;varying vec3 vNz;void main(){vPos=position;vN=normalMatrix*normal;vNx=normalMatrix[0];vNy=normalMatrix[1];vNz=normalMatrix[2];vec4 mv=modelViewMatrix*vec4(position,1.0);vView=mv.xyz;gl_Position=projectionMatrix*mv;}'
const MEMBRANE_FRAGMENT = [
  'uniform float uT;uniform float uFire;uniform float uGain;uniform float uSeed;uniform float uLines;varying vec3 vPos;varying vec3 vView;varying vec3 vN;varying vec3 vNx;varying vec3 vNy;varying vec3 vNz;',
  'float hash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}',
  'void main(){',
  '  vec3 p=normalize(vPos);',
  `  vec3 w=p+${glsl(WARP)}*sin(p.yzx*vec3(2.1,1.9,2.3)+vec3(uSeed*1.7+0.5,1.3-uSeed,uSeed*0.6+2.1));`,
  '  float h=0.0;float crease=0.0;float halo=0.0;vec3 id=vec3(0.0);',
  FOLD_GLSL,
  // The true folded surface, worked out per pixel, gives each sheet its own flat tilt with sharp creases.
  `  vec3 po=p*(1.0+${glsl(DEPTH)}*h);vec3 flatN=mat3(vNx,vNy,vNz)*cross(dFdx(po),dFdy(po));`,
  '  vec3 v=normalize(-vView);vec3 n=normalize(vN);n*=sign(dot(n,v)+1e-5);flatN=normalize(flatN+1e-9);flatN*=sign(dot(flatN,v)+1e-5);n=normalize(mix(n,flatN,0.6));',
  // Glass: almost nothing when you look straight through a sheet, light where it turns edge-on.
  '  float facing=dot(n,v);float rim=pow(1.0-facing,3.0);',
  // One key light from above and a little behind the viewer: a broad milky sheen on the sheets that face it.
  '  float spec=max(dot(reflect(-normalize(vec3(-0.28,0.86,0.42)),n),v),0.0);',
  '  float sheen=pow(spec,7.0);float glint=pow(spec,60.0);',
  // Whole sheets stay dark; the others carry a little light.
  '  float e1=hash(id),e2=hash(id+3.7),e3=hash(id+9.1);float lit=smoothstep(0.42,0.78,e3);',
  // Fine etched lines in patches: each sheet has its own direction and spacing, broken into runs like board traces.
  '  vec3 dir=normalize(vec3(hash(id+1.1),hash(id+2.2),hash(id+4.4))-0.5);vec3 dir2=normalize(cross(dir,p)+0.001);',
  '  float c=dot(w,dir)*mix(46.0,110.0,e2);float c2=dot(w,dir2)*mix(9.0,26.0,e3);',
  '  float fc=fwidth(c);float s=abs(fract(c)-0.5)*2.0;',
  '  float lines=mix(1.0-smoothstep(0.3-fc,0.3+fc,s),0.3,smoothstep(0.45,1.1,fc));',
  '  float run=step(0.38,hash(vec3(floor(c),floor(c2),e1*17.0)));',
  '  float fc2=fwidth(c2);float cross2=(1.0-smoothstep(0.1-fc2,0.1+fc2,abs(fract(c2)-0.5)*2.0))*step(0.55,e3)*smoothstep(0.6,0.2,fc2);',
  '  float etched=(lines*run+cross2*0.7)*step(0.56,e1);',
  // Micro detail (owner, 2026-11-17: "none of it is detailed"): the clip's film is built from thousands of small
  // marks. Every sheet now carries small data tiles in clusters, a second finer set of traces and pin-point
  // glints. Each layer fades out before it gets finer than the pixels, so it never shimmers.
  '  vec2 g=vec2(dot(w,dir),dot(w,dir2))*vec2(mix(64.0,104.0,e1),mix(22.0,36.0,e2));vec2 gw=fwidth(g);float keepG=smoothstep(0.7,0.2,max(gw.x,gw.y));',
  '  vec2 cell=floor(g);vec2 f=fract(g);float th=hash(vec3(cell,e2*31.0)),tl=hash(vec3(cell.yx,e1*13.0));',
  '  float clump=smoothstep(0.38,0.7,0.5+0.5*sin(dot(w,vec3(5.1,-3.7,4.3))+e1*20.0)*sin(dot(w,vec3(-4.4,6.2,2.9))+e3*17.0));',
  '  float tile=step(0.52,th)*smoothstep(0.0,0.1+gw.x,f.x)*smoothstep(1.0,0.9-gw.x,f.x)*smoothstep(0.0,0.14+gw.y,f.y)*smoothstep(1.0,0.4+0.5*tl,f.y);',
  '  float micro=tile*clump*keepG*(0.35+0.65*th);',
  '  float pin=step(0.972,th)*smoothstep(0.5,0.1,length(f-0.5))*keepG*(0.55+0.45*sin(uT*2.1+th*70.0));',
  '  float c3=dot(w,dir2)*mix(150.0,230.0,e3);float f3=fwidth(c3);float fine=(1.0-smoothstep(0.22-f3,0.22+f3,abs(fract(c3)-0.5)*2.0))*smoothstep(0.55,0.15,f3)*step(0.3,hash(vec3(floor(c3),floor(c*0.12),e2*9.0)))*(1.0-clump);',
  '  vec3 warm=vec3(0.78,0.96,0.52);vec3 tcol=mix(mix(vec3(0.07,0.42,1.0),vec3(0.58,0.86,1.0),th),warm,step(0.86,tl));',
  '  float shimmer=0.86+0.14*sin(uT*1.3+e1*40.0);',
  '  vec3 deep=vec3(0.004,0.032,0.115),mid=vec3(0.07,0.42,1.0),ice=vec3(0.58,0.86,1.0),white=vec3(0.92,0.97,1.0);',
  '  vec3 col=deep*0.3*lit',
  '    +mix(mid,ice,0.85)*rim*(0.05+0.26*lit)+ice*rim*rim*0.2',
  '    +mix(mid,white,min(1.0,sheen*2.6))*sheen*(0.22+0.7*lit)+white*glint*0.4',
  '    +(mix(ice,white,0.5)*crease*1.1+white*crease*crease*0.7)*uLines+mid*halo*0.05*uLines',
  '    +mix(mid,white,sheen)*etched*(0.05+0.2*lit*e2+sheen*2.4)',
  '    +tcol*micro*(0.07+0.22*lit+sheen*1.5+rim*0.35)+mix(tcol,white,0.6)*pin*(0.35+sheen)+mix(mid,ice,0.6)*fine*(0.03+0.1*lit+sheen*1.1+rim*0.2);',
  '  gl_FragColor=vec4(col*shimmer*(1.0+uFire*0.4)*uGain,1.0);',
  '}',
].join('\n')

// Thick lines that face the camera. Width is in world units, so they keep their look at any resolution,
// and never get thinner than about one pixel. Light runs along them (uDash, uSpeed).
const LINE_VERTEX = [
  'attribute vec3 aDir;attribute vec4 aInfo;attribute vec3 color;uniform float uPx;uniform float uWidth;',
  'varying float vSide;varying float vU;varying float vSeed;varying vec3 vCol;varying float vFade;',
  'void main(){',
  '  vec4 mv=modelViewMatrix*vec4(position,1.0);vec3 dv=(modelViewMatrix*vec4(aDir,0.0)).xyz;',
  '  vec3 side=cross(dv,mv.xyz);side/=max(length(side),1e-6);',
  '  float w=aInfo.y*uWidth*length(modelViewMatrix[0].xyz);float least=-mv.z*2.0/projectionMatrix[1][1]*uPx;',
  '  vFade=min(1.0,w/least);mv.xyz+=side*aInfo.x*max(w,least);',
  '  vSide=aInfo.x;vU=aInfo.z;vSeed=aInfo.w;vCol=color;gl_Position=projectionMatrix*mv;',
  '}',
].join('\n')
const LINE_FRAGMENT = [
  'uniform float uT;uniform float uOpacity;uniform float uDash;uniform float uSpeed;uniform float uBase;uniform float uSharp;uniform vec3 uHot;uniform float uCrisp;uniform float uHard;',
  'varying float vSide;varying float vU;varying float vSeed;varying vec3 vCol;varying float vFade;',
  'void main(){',
  // uCrisp 0: a soft stroke that fades toward its sides (the cracks of light inside her). uCrisp 1: a stroke with a
  // hard edge, smoothed over about one pixel only (the dashes and glyphs around her; owner, 2026-11-17: "so crispy
  // and defined").
  '  float side=1.0-abs(vSide);float across=mix(side*side*(3.0-2.0*side),smoothstep(0.0,max(fwidth(vSide)*1.4,0.02),side),uCrisp);',
  '  float f=fract(vU*uDash*(0.7+0.6*fract(vSeed*3.7))-uT*uSpeed*(0.55+0.9*fract(vSeed*7.3))+vSeed*13.0);',
  // uHard 1 (2026-11-21, "those outer particles aren't defined"): a lit dash with hard ends and a brighter head
  // instead of a comet that fades along its length.
  '  float fw=max(fwidth(f),1e-4);float hard=smoothstep(0.66-fw,0.66+fw,f)*(0.72+0.28*smoothstep(0.66,1.0,f));',
  '  float pulse=mix(pow(f,uSharp),hard,uHard);',
  '  vec3 col=vCol*(uBase+(1.0-uBase)*pulse)+uHot*pow(pulse,3.0)*dot(vCol,vec3(0.4));',
  '  gl_FragColor=vec4(col*across*vFade*uOpacity,1.0);',
  '}',
].join('\n')

// Round glowing dots sized in world units (hot nodes). aInfo: size, seed, soft (1 = a wide blur with no white centre).
const DOT_VERTEX = 'attribute vec4 aInfo;attribute vec3 color;uniform float uPx;uniform float uT;varying vec3 vCol;varying float vB;varying float vSoft;void main(){vec4 mv=modelViewMatrix*vec4(position,1.0);vCol=color;vSoft=aInfo.z;vB=0.55+0.45*sin(uT*(1.5+aInfo.y*3.0)+aInfo.y*40.0);gl_PointSize=max(1.5,aInfo.x*length(modelViewMatrix[0].xyz)*projectionMatrix[1][1]/(-mv.z*2.0*uPx));gl_Position=projectionMatrix*mv;}'
const DOT_FRAGMENT = 'uniform float uOpacity;varying vec3 vCol;varying float vB;varying float vSoft;void main(){float r=length(gl_PointCoord-vec2(0.5))*2.0;float a=smoothstep(1.0,0.0,r);float core=smoothstep(0.45,0.0,r)*(1.0-vSoft);gl_FragColor=vec4((vCol*a*a*(1.0-0.55*vSoft)+vec3(1.0,0.95,0.8)*core*0.8)*vB*uOpacity,1.0);}'

// The core: a wide soft white-blue bloom that washes out the sheets around it (no star rays), drawn after the blue filter.
const CORE_VERTEX = 'uniform float uSize;varying vec2 vUv;void main(){vUv=position.xy;vec4 mv=modelViewMatrix*vec4(0.0,0.0,0.0,1.0);mv.xy+=position.xy*uSize*length(modelViewMatrix[0].xyz);gl_Position=projectionMatrix*mv;}'
const CORE_FRAGMENT = [
  'uniform float uT;uniform float uFire;varying vec2 vUv;',
  'void main(){',
  '  float r=length(vUv*vec2(1.0,1.12));',
  '  float hot=exp(-r*r*80.0),wide=exp(-r*r*9.0),haze=exp(-r*3.2);',
  '  float beat=0.88+0.12*sin(uT*2.3)+uFire*0.4;',
  '  vec3 col=vec3(1.0,0.98,0.94)*hot*1.1+vec3(0.66,0.86,1.0)*wide*0.38+vec3(0.1,0.36,1.0)*haze*0.08;',
  '  gl_FragColor=vec4(col*beat*smoothstep(1.0,0.7,r),1.0);',
  '}',
].join('\n')

export function createFigure(THREE, { additive, density = 1 }) {
  const group = new THREE.Group(), disposables = [], lineMats = []
  const keep = x => { disposables.push(x); return x }
  const detail = Math.max(6, Math.min(52, Math.round(40 * Math.sqrt(density))))
  const amount = (n, lo = 0.12, hi = 1.6) => Math.max(1, Math.round(n * Math.min(hi, Math.max(lo, density))))
  const size = new THREE.Vector2()
  // Lines and dots need the picture height to keep a one-pixel minimum.
  const watchSize = (mesh, mat) => { mesh.onBeforeRender = renderer => { const rt = renderer.getRenderTarget(); mat.uniforms.uPx.value = 1 / Math.max(1, rt ? rt.height : renderer.getDrawingBufferSize(size).y) } }

  // ---- The film ----
  function filmGeometry(radius, seed, facets) {
    const geo = keep(new THREE.IcosahedronGeometry(1, facets))
    const pos = geo.attributes.position, nor = geo.attributes.normal, e = 0.004
    const at = (x, y, z) => { const m = Math.hypot(x, y, z) || 1; return crumple(x / m, y / m, z / m, seed) }
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), r = at(x, y, z)
      // Smooth normal from the slope of the film, so each sheet shades as one piece.
      const gx = (at(x + e, y, z) - r) / e, gy = (at(x, y + e, z) - r) / e, gz = (at(x, y, z + e) - r) / e
      const nx = x * r - gx, ny = y * r - gy, nz = z * r - gz, nm = Math.hypot(nx, ny, nz) || 1
      nor.setXYZ(i, nx / nm, ny / nm, nz / nm)
      pos.setXYZ(i, x * r * radius, y * r * radius, z * r * radius)
    }
    return geo
  }
  function membrane(radius, seed, gain, lines, facets, order) {
    const geo = filmGeometry(radius, seed, facets)
    const mat = keep(new THREE.ShaderMaterial(additive({
      side: THREE.DoubleSide, uniforms: { uT: { value: 0 }, uFire: { value: 0 }, uGain: { value: gain }, uSeed: { value: seed }, uLines: { value: lines } },
      vertexShader: MEMBRANE_VERTEX, fragmentShader: MEMBRANE_FRAGMENT,
    })))
    const mesh = new THREE.Mesh(geo, mat); mesh.renderOrder = order; group.add(mesh)
    return { mesh, mat, geo }
  }
  // Draw order: flecks (0) -> blue filter (5) -> films, cracks, core, dashes (6-8) -> memory nodes (10, set by the scene).
  const outer = membrane(1.1, 0, 1, 1, detail, 6), middle = membrane(0.84, 2.1, 0.7, 0.45, Math.max(5, Math.round(detail * 0.8)), 6), inner = membrane(0.58, 4.2, 0.6, 0.3, Math.max(4, Math.round(detail * 0.6)), 6)
  // The inner films are squashed and pushed off centre, so the layers do not nest as rings.
  middle.mesh.rotation.set(-0.5, 0.8, 1.1); middle.mesh.scale.set(1.06, 0.82, 1.1); middle.mesh.position.set(0.1, -0.06, 0.02)
  inner.mesh.rotation.set(0.7, 1.9, 0.3); inner.mesh.scale.set(0.86, 1.2, 0.8); inner.mesh.position.set(-0.12, 0.1, 0)

  // Blue filter: multiplies everything already drawn inside her outline, so the room behind her shows as dark blue glass.
  const filterMat = keep(new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.FrontSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
    uniforms: { uFire: { value: 0 } },
    vertexShader: 'varying vec3 vView;varying vec3 vN;void main(){vN=normalMatrix*normal;vec4 mv=modelViewMatrix*vec4(position,1.0);vView=mv.xyz;gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'uniform float uFire;varying vec3 vView;varying vec3 vN;void main(){float facing=abs(dot(normalize(vN),normalize(-vView)));vec3 tint=mix(vec3(0.3,0.55,1.0),vec3(0.2,0.42,0.95),facing);gl_FragColor=vec4(tint*(1.0+uFire*0.15),1.0);}',
  }))
  const filter = new THREE.Mesh(outer.geo, filterMat); filter.renderOrder = 5; group.add(filter)

  // ---- Thick-line builder shared by the cracks, the dashes and the traces ----
  function strands() {
    const P = [], D = [], I = [], C = [], idx = []
    let n = 0
    // points: [[x,y,z]...]; width and shade may be numbers or functions of 0..1 along the strand.
    function add(points, width, colour, seed, shade = 1) {
      const last = points.length - 1
      let u = 0
      for (let s = 1; s <= last; s++) {
        const a = points[s - 1], b = points[s], d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], len = Math.hypot(d[0], d[1], d[2])
        if (len < 1e-7) continue
        for (const [p, t, uu] of [[a, (s - 1) / last, u], [b, s / last, u + len]]) {
          const w = typeof width === 'function' ? width(t) : width, k = typeof shade === 'function' ? shade(t) : shade
          for (const sd of [-1, 1]) { P.push(p[0], p[1], p[2]); D.push(d[0], d[1], d[2]); I.push(sd, w, uu, seed); C.push(colour[0] * k, colour[1] * k, colour[2] * k) }
        }
        idx.push(n, n + 1, n + 2, n + 2, n + 1, n + 3); n += 4; u += len
      }
    }
    function mesh(uniforms, order) {
      const geo = keep(new THREE.BufferGeometry())
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('aDir', new THREE.Float32BufferAttribute(D, 3))
      geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(I, 4)); geo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3))
      geo.setIndex(idx)
      const mat = keep(new THREE.ShaderMaterial(additive({
        side: THREE.DoubleSide,
        uniforms: { uT: { value: 0 }, uPx: { value: 1 / 800 }, uWidth: { value: 1 }, uOpacity: { value: 1 }, uDash: { value: 1 }, uSpeed: { value: 0.3 }, uBase: { value: 0.3 }, uSharp: { value: 4 }, uHot: { value: new THREE.Vector3(0, 0, 0) }, uCrisp: { value: 0 }, uHard: { value: 0 }, ...uniforms },
        vertexShader: LINE_VERTEX, fragmentShader: LINE_FRAGMENT,
      })))
      const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = order; watchSize(m, mat); lineMats.push(mat)
      return { mesh: m, mat }
    }
    return { add, mesh }
  }
  const rand = seeded(0x1ce)
  const rv = () => { for (;;) { const v = [rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1], m = Math.hypot(...v); if (m > 0.05 && m <= 1) return v.map(x => x / m) } }
  const norm = v => { const m = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / m, v[1] / m, v[2] / m] }
  const CORE_AT = [0.1, 0.05, 0.14]

  // ---- Cracks of light: long, nearly straight, forking a little, fanning from the core down into the lower half ----
  const crackLines = strands()
  function filament(p, d, length, w, colour, depth) {
    const step = 0.06, steps = Math.max(2, Math.round(length / step)), pts = [p]
    for (let s = 0; s < steps; s++) {
      const bend = rand() < 0.07 ? 0.5 : 0.05
      d = norm([d[0] + (rand() - 0.5) * bend, d[1] + (rand() - 0.5) * bend, d[2] + (rand() - 0.5) * bend])
      p = [p[0] + d[0] * step, p[1] + d[1] * step, p[2] + d[2] * step]; pts.push(p)
      if (depth < 1 && s > 3 && rand() < 0.07) filament(p, norm([d[0] + (rand() - 0.5) * 0.9, d[1] + (rand() - 0.5) * 0.9, d[2] + (rand() - 0.5) * 0.9]), length * (1 - s / steps) * (0.5 + rand() * 0.5), w * 0.6, colour, depth + 1)
    }
    crackLines.add(pts, t => w * (1 - 0.7 * t), colour, rand(), t => (1 - 0.55 * t) * Math.min(1, t * 10 + 0.25))
  }
  for (let c = 0; c < amount(22, 0.3, 1.5); c++) {
    // Most head down and outward; a few go up so the fan is not cut off flat.
    const up = rand() < 0.16, r = rv(), d = norm([r[0] * 1.2, up ? Math.abs(r[1]) * 0.7 : -0.25 - Math.abs(r[1]) * 1.1, r[2] * 0.9 + 0.25])
    const warm = rand() < 0.4, b = up ? 0.3 + rand() * 0.3 : 0.4 + rand() * 0.6
    filament(CORE_AT.map((x, i) => x + d[i] * 0.05), d, (up ? 0.45 : 0.75) + rand() * 0.5, 0.004 + rand() * 0.008, warm ? [1.0 * b, 0.9 * b, 0.62 * b] : [0.66 * b, 0.88 * b, 1.0 * b], 0)
  }
  const cracks = crackLines.mesh({ uDash: { value: 1.1 }, uSpeed: { value: 0.45 }, uBase: { value: 0.5 }, uSharp: { value: 3 } }, 7)
  group.add(cracks.mesh)

  const coreMat = keep(new THREE.ShaderMaterial(additive({ uniforms: { uT: { value: 0 }, uFire: { value: 0 }, uSize: { value: 1.0 } }, vertexShader: CORE_VERTEX, fragmentShader: CORE_FRAGMENT })))
  const core = new THREE.Mesh(keep(new THREE.PlaneGeometry(2, 2)), coreMat); core.frustumCulled = false; core.renderOrder = 8
  core.position.set(CORE_AT[0], CORE_AT[1], CORE_AT[2]); group.add(core)

  // ---- Dashes of light swirling around her: short strokes with bright heads, gathered in a few dense sprays ----
  const swirl = new THREE.Group(), streamLines = strands(), glyphLines = strands()
  // The current: round her (mostly about the upright axis), with eddies, easing outward.
  const current = (p, axis, phase) => {
    const m = Math.hypot(p[0], p[1], p[2]) || 1
    const o = norm([axis[1] * p[2] - axis[2] * p[1], axis[2] * p[0] - axis[0] * p[2], axis[0] * p[1] - axis[1] * p[0]])
    const e = [Math.sin(p[1] * 1.7 + p[2] * 0.9 + phase), Math.sin(p[2] * 1.9 + p[0] * 1.1 + phase * 1.7), Math.sin(p[0] * 1.5 + p[1] * 1.3 + phase * 0.6)]
    return norm([o[0] + e[0] * 0.45 + p[0] / m * 0.3, o[1] + e[1] * 0.45 + p[1] / m * 0.3, o[2] + e[2] * 0.45 + p[2] / m * 0.3])
  }
  // Spray centres (x, y, z, radius): low left, low right, far left, upper right.
  const SPRAYS = [[-1.55, -1.0, 0.45, 0.62], [1.4, -1.1, 0.4, 0.55], [-1.9, 0.1, 0.1, 0.5], [1.55, 0.8, -0.3, 0.42]]
  for (let b = 0; b < amount(230, 0.14); b++) {
    const axis = norm([(rand() - 0.5) * 0.9, 1, (rand() - 0.5) * 0.9]), phase = rand() * 6.28
    const spray = rand() < 0.74 ? SPRAYS[(rand() * SPRAYS.length) | 0] : null, off = rv(), reach = Math.pow(rand(), 0.6)
    const start = spray ? [spray[0] + off[0] * spray[3] * reach, spray[1] + off[1] * spray[3] * reach, spray[2] + off[2] * spray[3] * reach] : off.map(x => x * (1.35 + reach * 1.3))
    const spread = 0.04 + rand() * 0.12, steps = 3 + Math.round(rand() * 6), stepLen = 0.055
    const pick = rand(), tone = pick < 0.72 ? [0.22, 0.8, 1.0] : pick < 0.9 ? [0.7, 0.92, 1.0] : [0.7, 0.95, 0.45]
    for (let s = 0; s < 3 + Math.round(rand() * 6); s++) {
      let p = [start[0] + (rand() - 0.5) * spread * 2, start[1] + (rand() - 0.5) * spread * 2, start[2] + (rand() - 0.5) * spread * 2]
      const pts = [p]
      for (let k = 0; k < steps; k++) {
        const v = current(p, axis, phase); p = [p[0] + v[0] * stepLen, p[1] + v[1] * stepLen, p[2] + v[2] * stepLen]
        // Dashes slide over her, not through her.
        const m = Math.hypot(p[0], p[1], p[2]); if (m < 1.24) p = p.map(x => x * 1.24 / m)
        pts.push(p)
      }
      const bright = 0.45 + rand() * 0.55
      streamLines.add(pts, (0.0028 + rand() * 0.0042) * 1.6, tone, rand(), t => bright * Math.min(1, Math.sin(Math.PI * t) * 1.6))
    }
  }
  // Swarms of pale yellow-green glyphs around her (the clip has clusters on every side): tiny squiggles that hold
  // their light. The first swarm, up on the left, stays the densest.
  const SWARMS = [[-1.45, 1.2, 0.15, 0.62], [-1.45, 1.2, 0.15, 0.62], [1.35, 1.25, -0.1, 0.5], [-1.75, -0.35, 0.3, 0.45], [1.7, -0.2, 0.2, 0.5], [0.2, -1.55, 0.35, 0.5], [0.1, 1.6, -0.2, 0.42]]
  for (let i = 0; i < amount(900, 0.14); i++) {
    const swarm = SWARMS[(rand() * SWARMS.length) | 0]
    const off = rv(), reach = Math.pow(rand(), 0.55) * swarm[3], pts = [[swarm[0] + off[0] * reach, swarm[1] + off[1] * reach * 0.8, swarm[2] + off[2] * reach * 0.6]]
    let d = norm([rv()[0], rv()[1] * 0.6, 0.2 * rv()[2]])
    for (let k = 0; k < 2 + Math.round(rand() * 3); k++) {
      const len = 0.011 + rand() * 0.02, q = pts[pts.length - 1]
      pts.push([q[0] + d[0] * len, q[1] + d[1] * len, q[2] + d[2] * len]); d = norm([d[1] * (rand() < 0.5 ? 1 : -1) + (rand() - 0.5) * 0.5, -d[0] + (rand() - 0.5) * 0.5, d[2]])
    }
    // 2x wider (2026-11-21): at the desktop's 8K-then-scaled-down picture the old width fell under a 1440p screen pixel.
    glyphLines.add(pts, (0.0038 + rand() * 0.004) * 2, rand() < 0.75 ? [0.78, 0.95, 0.5] : [0.5, 0.95, 0.85], rand(), 0.35 + rand() * 0.65)
  }
  const streams = streamLines.mesh({ uCrisp: { value: 1 }, uHard: { value: 1 }, uDash: { value: 3.4 }, uSpeed: { value: 0.5 }, uBase: { value: 0 }, uSharp: { value: 6 }, uHot: { value: new THREE.Vector3(1.0, 1.0, 0.9) } }, 7)
  const glyphs = glyphLines.mesh({ uCrisp: { value: 1 }, uDash: { value: 0.01 }, uSpeed: { value: 0.35 }, uBase: { value: 0.6 }, uSharp: { value: 2 } }, 7)
  swirl.add(streams.mesh, glyphs.mesh); group.add(swirl)

  // ---- The Ultron figure: stepped glowing traces on a lumpy shape, hot nodes, cyan flecks. Dark until she uses tools. ----
  const traceLines = strands(), fleckLines = strands(), nodeP = [], nodeI = [], nodeC = []
  const shape = (lat, lon, layer) => { const d = onSphere(lat, lon, 1), r = layer * (0.74 + 0.5 * lumps(d[0], d[1], d[2], 3.1)); return [d[0] * r, d[1] * r * 1.22, d[2] * r] }
  const node = (p, s, c, soft = 0) => { nodeP.push(p[0], p[1], p[2]); nodeI.push(s, rand(), soft, 0); nodeC.push(c[0], c[1], c[2]) }
  const ORANGE = [1.0, 0.24, 0.02], AMBER = [1.0, 0.5, 0.08], YELLOW = [1.0, 0.82, 0.3]
  const mixc = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
  for (let c = 0; c < amount(34, 0.2, 1.5); c++) {
    // Traces come in clumps, leaving gaps, so the figure is not an even ball of wire.
    const lat0 = (rand() - 0.5) * 2.5, lon0 = rand() * 6.283, layer = 0.5 + Math.pow(rand(), 0.7) * 0.78
    for (let k = 0; k < 4 + Math.round(rand() * 7); k++) {
      const steps = 12 + Math.round(rand() * 22), fine = rand() < 0.6
      const path = walk(rand, Math.max(-1.3, Math.min(1.3, lat0 + (rand() - 0.5) * 0.5)), lon0 + (rand() - 0.5) * 0.6, steps, 0.86, fine ? 0.02 : 0.05, fine ? 0.09 : 0.2)
      const lift = layer * (0.94 + rand() * 0.12), pts = path.map(([la, lo]) => shape(la, lo, lift))
      // About a third are thick soft strokes that run hot (yellow); the rest stay thin and red-orange.
      const thick = rand() < 0.34, heat = rand(), bright = 0.25 + Math.pow(rand(), 1.6) * 0.75, wide = thick ? 0.016 + rand() * 0.02 : 0.004 + rand() * 0.007
      traceLines.add(pts, wide, thick ? mixc(AMBER, YELLOW, heat * 0.8) : mixc(ORANGE, AMBER, heat), rand(), t => bright * (thick ? 0.75 : 1) * (0.55 + 0.45 * Math.sin(Math.PI * t)))
      // Hot bars and nodes sit on the corners.
      for (let s = 1; s < pts.length; s++) {
        if (rand() < 0.05) traceLines.add([pts[s - 1], pts[s]], 0.02 + rand() * 0.022, YELLOW, rand(), 0.6 + rand() * 0.4)
        if (rand() < 0.06) node(pts[s], 0.025 + rand() * 0.04, mixc(AMBER, YELLOW, rand()))
      }
    }
  }
  // Big soft yellow blobs, like lights out of focus, and a few rings.
  for (let i = 0; i < amount(18, 0.3, 1.5); i++) node(shape((rand() - 0.5) * 2.2, rand() * 6.283, 0.55 + rand() * 0.7), 0.13 + rand() * 0.14, mixc(AMBER, YELLOW, 0.4 + rand() * 0.6), 1)
  for (let i = 0; i < amount(7, 0.3, 1.5); i++) {
    const centre = shape((rand() - 0.5) * 2, rand() * 6.283, 0.7 + rand() * 0.5), a = rv(), b = norm([a[1], -a[0], 0.3 * a[2]]), r = 0.04 + rand() * 0.05, pts = []
    for (let k = 0; k <= 14; k++) { const th = k / 14 * 6.2832; pts.push([0, 1, 2].map(j => centre[j] + (a[j] * Math.cos(th) + b[j] * Math.sin(th)) * r)) }
    traceLines.add(pts, 0.014 + rand() * 0.01, YELLOW, rand(), 0.7 + rand() * 0.3)
  }
  // Long tendrils reaching out of it.
  for (let i = 0; i < amount(9, 0.3, 1.5); i++) {
    const path = walk(rand, (rand() - 0.5) * 1.6, rand() * 6.283, 50, 0.95, 0.03, 0.1), from = 0.9 + rand() * 0.3, grow = 0.2 + rand() * 0.5
    traceLines.add(path.map(([la, lo], k) => shape(la, lo, from + grow * k / 50)), 0.008 + rand() * 0.012, mixc(ORANGE, AMBER, rand()), rand(), t => 0.8 * Math.sin(Math.PI * t))
  }
  // Cyan-green flecks: a few dense patches of short dashes that share a heading.
  for (let i = 0; i < 4; i++) {
    const centre = [[0.25, -0.75, 0.75], [-0.55, -0.15, 0.85], [0.45, 0.2, 0.9], [-0.2, -1.05, 0.5]][i], head = rv(), tone = i % 2 ? [0.4, 1.0, 0.75] : [0.25, 0.9, 1.0]
    for (let k = 0; k < amount(64, 0.25, 1.5); k++) {
      const p = [centre[0] + (rand() - 0.5) * 0.42, centre[1] + (rand() - 0.5) * 0.36, centre[2] + (rand() - 0.5) * 0.3]
      const d = norm([head[0] + (rand() - 0.5) * 0.6, head[1] + (rand() - 0.5) * 0.6, head[2] + (rand() - 0.5) * 0.6]), len = 0.03 + rand() * 0.07
      fleckLines.add([p, [p[0] + d[0] * len, p[1] + d[1] * len, p[2] + d[2] * len]], 0.009 + rand() * 0.012, tone, rand(), 0.4 + rand() * 0.6)
    }
  }
  const traces = traceLines.mesh({ uDash: { value: 2.2 }, uSpeed: { value: 0.7 }, uBase: { value: 0.55 }, uSharp: { value: 3 }, uHot: { value: new THREE.Vector3(1.0, 0.85, 0.45) }, uOpacity: { value: 0 } }, 1)
  const flecks = fleckLines.mesh({ uDash: { value: 0.01 }, uSpeed: { value: 0.5 }, uBase: { value: 0.3 }, uSharp: { value: 2 }, uOpacity: { value: 0 } }, 1)
  const nodeGeo = keep(new THREE.BufferGeometry())
  nodeGeo.setAttribute('position', new THREE.Float32BufferAttribute(nodeP, 3)); nodeGeo.setAttribute('aInfo', new THREE.Float32BufferAttribute(nodeI, 4)); nodeGeo.setAttribute('color', new THREE.Float32BufferAttribute(nodeC, 3))
  const nodeMat = keep(new THREE.ShaderMaterial(additive({ uniforms: { uT: { value: 0 }, uPx: { value: 1 / 800 }, uOpacity: { value: 0 } }, vertexShader: DOT_VERTEX, fragmentShader: DOT_FRAGMENT })))
  const nodes = new THREE.Points(nodeGeo, nodeMat); nodes.frustumCulled = false; nodes.renderOrder = 1; watchSize(nodes, nodeMat)
  const circuits = new THREE.Group(); circuits.add(traces.mesh, flecks.mesh, nodes)
  // Not a child of the turning figure: it stands to her right, a little behind, and is added to the scene by the caller.
  circuits.position.set(3.3, 0.15, -0.9); circuits.scale.setScalar(1.75); circuits.visible = false

  let tool = 0
  const films = [outer, middle, inner], OFFSET = [0, 4, 9]
  // t: seconds, fire: 0..1 how hard she is working, toolTarget: 0..1 whether she is using tools right now, dt: seconds since last frame.
  function update(t, fire, toolTarget, dt = 1 / 144) {
    tool += (toolTarget - tool) * (1 - Math.exp(-dt * 8.9))
    for (let i = 0; i < 3; i++) { const u = films[i].mat.uniforms; u.uT.value = t + OFFSET[i]; u.uFire.value = fire }
    filterMat.uniforms.uFire.value = fire
    middle.mesh.rotation.y = 0.8 - t * 0.045
    inner.mesh.rotation.y = 1.9 + t * 0.07; inner.mesh.rotation.x = 0.7 + Math.sin(t * 0.11) * 0.2
    for (const mat of lineMats) mat.uniforms.uT.value = t
    cracks.mat.uniforms.uOpacity.value = 0.85 + 0.12 * Math.sin(t * 2.6) + fire * 0.5
    coreMat.uniforms.uT.value = t; coreMat.uniforms.uFire.value = fire
    swirl.rotation.y = t * 0.04; swirl.rotation.x = Math.sin(t * 0.07) * 0.1
    streams.mat.uniforms.uOpacity.value = 1.25 + fire * 0.5; glyphs.mat.uniforms.uOpacity.value = 0.75 + 0.15 * Math.sin(t * 1.7) + fire * 0.3
    circuits.visible = tool > 0.01
    traces.mat.uniforms.uOpacity.value = tool * (0.85 + 0.15 * Math.sin(t * 5)); flecks.mat.uniforms.uOpacity.value = tool
    nodeMat.uniforms.uT.value = t; nodeMat.uniforms.uOpacity.value = tool
    circuits.rotation.y = -t * 0.09; circuits.rotation.x = Math.sin(t * 0.13) * 0.15
  }
  function dispose() { for (const x of disposables) x.dispose?.() }
  return { group, companion: circuits, update, dispose, detail }
}
