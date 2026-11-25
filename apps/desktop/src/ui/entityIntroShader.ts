export const entityVertex = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`

export const entityFragment = /* glsl */ `
precision highp float;
uniform sampler2D uOpen;
uniform sampler2D uSkin;
uniform float uTime;
uniform float uAspect;
uniform vec2 uResolution;
varying vec2 vUv;
const vec2 SIZE = vec2(1672.0, 941.0);
const vec2 EYE = vec2(581.0, 326.0);
vec3 opened(vec2 p) { return texture2D(uOpen, vec2(p.x / SIZE.x, 1.0 - p.y / SIZE.y)).rgb; }
vec3 skin(vec2 p) { return texture2D(uSkin, vec2(p.x / SIZE.x, 1.0 - p.y / SIZE.y)).rgb; }
float hash(vec3 p) {
  p = fract(p * .1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float noise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),
                 mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                 mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float cloud(vec3 p) {
  float sum = 0.0, weight = .53;
  for (int i=0;i<4;i++) {
    sum += weight * noise(p);
    p = p.yzx * 2.08 + vec3(11.4, 7.9, 5.1);
    weight *= .48;
  }
  return sum;
}
float pulse(float t, float start, float shut, float hold, float release) {
  return smoothstep(start,start+shut,t)*(1.0-smoothstep(start+shut+hold,start+shut+hold+release,t));
}
float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b-a;
  return length(p-a-ab*clamp(dot(p-a,ab)/max(.00000001,dot(ab,ab)),0.0,1.0));
}

// The view inside the iris and the eventual full-screen flight are the SAME
// spatial scene. The camera moves through this volume; no final plate or
// second scene is mixed in when the eye fills the screen.
vec3 galaxy(vec2 q, float time) {
  float flight = smoothstep(1.7, 4.4, time);
  float travel = .08*time + .43*max(0.0,time-2.1);
  vec3 origin = vec3(.09*sin(time*.24), .06*cos(time*.21), travel);
  // Rotate the sampled field clockwise so its visible spiral turns
  // counter-clockwise. Keep the motion slow enough to read as distant space.
  float turn = -time * .035;
  q = mat2(cos(turn), -sin(turn), sin(turn), cos(turn)) * q;
  vec3 ray = normalize(vec3(q*.77, 1.0));
  vec3 col = vec3(.0015,.002,.009);
  float transmittance = 1.0;
  // Layered 3D gas: domain-warped density, dark dust, and internal light.
  for (int i=0;i<18;i++) {
    float depth = .7 + float(i)*.38;
    vec3 p = origin + ray*depth;
    vec3 slow = vec3(time*.014, -time*.012, time*.009);
    float bend = cloud(p*.47 + slow);
    float structure = cloud(p*1.13 + vec3(bend*2.2,bend*.8,-bend));
    float fine = cloud(p*13.4 + slow);
    float micro = noise(p*28.0 + slow*1.7);
    float seam = p.x*.57 - p.y*.82 + sin(p.z*.68)*.8;
    float bank = exp(-seam*seam*.66);
    float density = smoothstep(.49,.75,structure) * (.06 + .94*bank);
    float filament = pow(max(0.0,1.0-abs(structure-.54)*10.0),3.0);
    density *= pow(fine,2.5)*5.6 * (.72 + .56*micro);
    float palette = smoothstep(.2,.8,noise(p*.38+vec3(8,4,1)));
    vec3 tint = mix(vec3(.025,.06,.43),vec3(.63,.035,.35),palette);
    tint = mix(tint,vec3(.38,.22,.65),filament*.45);
    float light = .7 + 1.8*exp(-dot(p.xy-vec2(.2,.1),p.xy-vec2(.2,.1))*.34);
    col += transmittance * density * tint * light * 1.35;
    col += transmittance * filament * density * vec3(.32,.22,.48)*.22;
    transmittance *= 1.0-density*.17;
  }
  // Perspective planes give stars proper outward motion and depth. Each
  // layer fades at its near/far boundary, eliminating visible wraparound.
  float pixel = max(.00055, 1.15/uResolution.y);
  for (int layer=0;layer<7;layer++) {
    float l = float(layer);
    float z = mod(l*1.471-travel,10.3)+.18;
    float fade = smoothstep(.18,.8,z)*(1.0-smoothstep(8.7,10.48,z));
    vec2 projected = q*z*.72 + origin.xy;
    vec2 cell = floor(projected*4.2);
    for (int n=0;n<2;n++) {
      vec3 seed = vec3(cell,l*17.3+float(n)*41.7);
      float chance = hash(seed);
      vec2 offset = .15 + .7*vec2(hash(seed+3.1),hash(seed+8.7));
      vec2 star = ((cell+offset)/4.2-origin.xy)/(z*.72);
      vec2 tail = star*(1.0+.015*flight/max(.7,z));
      float dist = segmentDistance(q,star,tail);
      float size = pixel*(.75+chance*1.1) + .00035/z;
      float core = exp(-dist*dist/(size*size));
      float visible = smoothstep(.80,.96,chance)*fade;
      col += core*visible*mix(vec3(.36,.48,1.0),vec3(.96,.85,1.0),chance)*1.5;
    }
  }
  // Distant lights persist through the eye entry, anchoring the camera move.
  vec2 core = vec2(.07*sin(time*.13),-.05);
  float r = length(q-core);
  col += vec3(.24,.17,.48)*.025/(.08+r*r*4.5);
  col = 1.0-exp(-col*1.33);
  return col;
}

void main() {
  vec2 screen = vec2((vUv.x-.5)*uAspect, .5-vUv.y);
  // Match the reference's close eye -> blink -> illumination -> rapid push.
  float push = smoothstep(1.65, 4.3, uTime);
  float zoom = 2.16*exp(push*4.0);
  vec2 cameraCenter = mix(vec2(570.0,350.0),EYE,smoothstep(1.35,2.7,uTime));
  vec2 p = screen*SIZE.y/zoom + cameraCenter;
  p += vec2(sin(uTime*.71),cos(uTime*.89))*.45*(1.0-push);
  float openness = 1.0-.995*pulse(uTime,.76,.17,.13,.34);
  float along = clamp((p.x-319.0)/452.0,0.0,1.0);
  float arch = pow(max(0.0,sin(along*3.14159265)),.85);
  float baseline = mix(256.0,457.0,along);
  float top = baseline-126.0*arch;
  float bottom = baseline+70.0*arch;
  float seam = baseline+31.0*arch;
  float upper = mix(seam,top,openness);
  float lower = mix(seam,bottom,openness);
  float anchorTop = top-76.0*arch-1.0;
  float anchorBottom = bottom+74.0*arch+1.0;
  float socket = smoothstep(319.0,335.0,p.x)*(1.0-smoothstep(751.0,771.0,p.x));
  float region = socket*smoothstep(anchorTop,anchorTop+20.0,p.y)*(1.0-smoothstep(anchorBottom-20.0,anchorBottom,p.y));
  float eyeMask = socket*smoothstep(top-3.0,top+2.0,p.y)*(1.0-smoothstep(bottom-2.0,bottom+3.0,p.y));
  float exposed = smoothstep(upper-.7,upper+.7,p.y)*(1.0-smoothstep(lower-.7,lower+.7,p.y));
  exposed *= smoothstep(.005,.035,openness);
  float isUpper = 1.0-step((upper+lower)*.5,p.y);
  float upperY = mix(anchorTop,seam,clamp((p.y-anchorTop)/max(1.0,upper-anchorTop),0.0,1.0));
  float lowerY = mix(seam,anchorBottom,clamp((p.y-lower)/max(1.0,anchorBottom-lower),0.0,1.0));
  vec3 lid = skin(vec2(p.x,mix(lowerY,upperY,isUpper)));
  vec2 iris = (p-EYE)/vec2(138.0,132.0);
  float radius = length(iris);
  // Correct the portal projection continuously as the camera crosses it.
  // At close range it tends to a fixed camera FOV, never a shrinking still.
  float projectedRadius = 138.0*zoom/SIZE.y;
  vec2 ray = (p-EYE)/138.0 * sqrt(1.0+projectedRadius*projectedRadius);
  vec3 space = galaxy(ray,uTime);
  vec3 eye = opened(p);
  float light = dot(eye,vec3(.2126,.7152,.0722));
  float awaken = smoothstep(1.22,1.95,uTime);
  float interior = 1.0-smoothstep(.76,1.03,radius);
  float fiber = smoothstep(.27,.48,radius)*(1.0-smoothstep(.86,1.02,radius));
  // Corneal reflection and radial iris tissue stay in their anatomical place;
  // space is shaded as the eye's interior, with the eyelid casting its shadow.
  vec3 irisColor = space * mix(.6,1.12,awaken);
  irisColor += eye*fiber*.27;
  irisColor += vec3(1,.95,1)*max(0.0,light-.68)*.34;
  eye = mix(eye,irisColor,interior*eyeMask);
  eye *= mix(.68,1.0,smoothstep(0.0,17.0,p.y-upper));
  vec3 facial = mix(lid,eye,exposed);
  // Fully open geometry uses original undistorted lids; interpolation only
  // acts on the eyelid while blinking, avoiding the old stretched brow.
  vec3 openFace = mix(opened(p),eye,eyeMask);
  vec3 color = mix(skin(p),facial,region);
  color = mix(color,openFace,smoothstep(.91,.995,openness));
  float rimLight = exp(-abs(radius-.87)*11.0)*awaken*.15*eyeMask*exposed;
  color += vec3(.29,.12,.52)*rimLight;
  // Light spills naturally onto the socket as in the reference reopening.
  float glow = exp(-dot(iris,iris)*1.7)*awaken*(1.0-smoothstep(2.7,4.0,uTime));
  color += vec3(.16,.08,.3)*glow*.37;
  // Once the camera is inside the cornea, reflections/tissue recede. The same
  // galaxy sample already visible inside it occupies every pixel naturally.
  float inside = smoothstep(3.08,3.8,uTime);
  color = mix(color,space,inside);
  float vignette = 1.0-.16*smoothstep(.3,1.4,length(screen));
  color *= vignette;
  color *= smoothstep(0.0,.35,uTime);
  gl_FragColor = vec4(color,1.0);
}
`
