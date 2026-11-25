import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/* A real depth field, not an animated wallpaper. Every star has a persistent
 * x/y lane and a depth coordinate that advances toward the camera, then wraps
 * behind the world. The varying depth gives the space-flight parallax. */
const COUNT = 4200
const DEPTH = 34

const vertex = /* glsl */ `
  uniform float uTime;
  attribute float aSeed;
  attribute float aSize;
  varying float vTint;
  void main() {
    vec3 p = position;
    float z = mod(p.z + uTime * (3.2 + aSeed * 4.8), ${DEPTH.toFixed(1)}) - ${DEPTH.toFixed(1)};
    // A tiny lateral current makes it feel like a path through a huge field.
    p.x += sin(uTime * 0.16 + aSeed * 21.0) * 0.18;
    p.y += cos(uTime * 0.13 + aSeed * 17.0) * 0.12;
    p.z = z;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = clamp(aSize * (32.0 / max(1.0, -mv.z)), 1.0, 10.0);
    vTint = aSeed;
  }
`
const fragment = /* glsl */ `
  varying float vTint;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float d = length(q);
    if (d > 0.5) discard;
    float a = pow(1.0 - smoothstep(0.0, 0.5, d), 1.8);
    vec3 cool = vec3(0.46, 0.82, 1.0);
    vec3 violet = vec3(0.78, 0.48, 1.0);
    vec3 white = vec3(0.92, 0.97, 1.0);
    vec3 c = mix(cool, violet, smoothstep(0.60, 0.94, vTint));
    c = mix(c, white, smoothstep(0.94, 1.0, vTint));
    gl_FragColor = vec4(c, a * (0.34 + vTint * 0.42));
  }
`

export function GalaxyFlight() {
  const material = useRef<THREE.ShaderMaterial>(null)
  const trailGeometry = useRef<THREE.BufferGeometry>(null)
  const { positions, seeds, sizes, trails, speeds } = useMemo(() => {
    const positions = new Float32Array(COUNT * 3)
    const seeds = new Float32Array(COUNT)
    const sizes = new Float32Array(COUNT)
    const trails = new Float32Array(COUNT * 6)
    const speeds = new Float32Array(COUNT)
    for (let i = 0; i < COUNT; i++) {
      const edge = Math.pow(Math.random(), 0.48)
      const a = Math.random() * Math.PI * 2
      const radius = 3.5 + edge * 15
      positions[i * 3] = Math.cos(a) * radius * (0.74 + Math.random() * 0.5)
      positions[i * 3 + 1] = Math.sin(a) * radius * 0.72
      positions[i * 3 + 2] = -Math.random() * DEPTH
      seeds[i] = Math.random()
      sizes[i] = 1.3 + Math.random() * 2.8
      // Two vertices per traveller. In perspective, these depth-aligned lines
      // radiate outward from the vanishing point like a real hyperspace tunnel.
      trails[i * 6] = positions[i * 3]
      trails[i * 6 + 1] = positions[i * 3 + 1]
      trails[i * 6 + 2] = positions[i * 3 + 2]
      trails[i * 6 + 3] = positions[i * 3] * 0.98
      trails[i * 6 + 4] = positions[i * 3 + 1] * 0.98
      trails[i * 6 + 5] = positions[i * 3 + 2] - (0.25 + seeds[i] * 1.4)
      speeds[i] = 2.4 + seeds[i] * 7.6
    }
    return { positions, seeds, sizes, trails, speeds }
  }, [])
  useFrame((state, dt) => {
    if (material.current) material.current.uniforms.uTime.value = state.clock.elapsedTime
    const a = trailGeometry.current?.attributes.position
    if (!a) return
    const p = a.array as Float32Array
    for (let i = 0; i < COUNT; i++) {
      const n = i * 6
      p[n + 2] += speeds[i] * dt
      p[n + 5] += speeds[i] * dt
      if (p[n + 2] > 4.5) {
        const z = -DEPTH + Math.random() * 4
        p[n] = (Math.random() - .5) * 26; p[n + 1] = (Math.random() - .5) * 16; p[n + 2] = z
        p[n + 3] = p[n] * .98; p[n + 4] = p[n + 1] * .98; p[n + 5] = z - (.25 + speeds[i] * .12)
      }
    }
    a.needsUpdate = true
  })
  return <>
  <points frustumCulled={false} renderOrder={-2}>
    <bufferGeometry>
      <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
      <bufferAttribute attach="attributes-aSize" args={[sizes, 1]} />
    </bufferGeometry>
    <shaderMaterial ref={material} uniforms={{ uTime: { value: 0 } }} vertexShader={vertex} fragmentShader={fragment} transparent blending={THREE.AdditiveBlending} depthWrite={false} />
  </points>
  <lineSegments frustumCulled={false} renderOrder={-3}>
    <bufferGeometry ref={trailGeometry}><bufferAttribute attach="attributes-position" args={[trails, 3]} /></bufferGeometry>
    <lineBasicMaterial color="#9bdcff" transparent opacity={0.22} blending={THREE.AdditiveBlending} depthWrite={false} />
  </lineSegments>
  </>
}
