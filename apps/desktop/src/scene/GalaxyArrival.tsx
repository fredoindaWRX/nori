import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const COUNT = 6500
const smooth = (x: number) => x * x * (3 - 2 * x)

/** Arrival phase: a scattered field resolves into four luminous spiral arms,
 * then returns to dust. One BufferGeometry keeps the whole formation one draw. */
export function GalaxyArrival() {
  const points = useRef<THREE.Points>(null)
  const { live, start, target, colors } = useMemo(() => {
    const live = new Float32Array(COUNT * 3)
    const start = new Float32Array(COUNT * 3)
    const target = new Float32Array(COUNT * 3)
    const colors = new Float32Array(COUNT * 3)
    for (let i = 0; i < COUNT; i++) {
      const n = i * 3
      const t = Math.pow(Math.random(), .58)
      const arm = i % 4
      const radius = t * 11
      const angle = arm * Math.PI / 2 + radius * .56 + Math.sqrt(t) * 2.2
      start[n] = (Math.random() - .5) * 30
      start[n + 1] = (Math.random() - .5) * 19
      start[n + 2] = -15 + (Math.random() - .5) * 9
      target[n] = Math.cos(angle) * radius
      target[n + 1] = Math.sin(angle) * radius * .42
      target[n + 2] = -16 + (Math.random() - .5) * (.25 + t * 1.6)
      live[n] = start[n]; live[n + 1] = start[n + 1]; live[n + 2] = start[n + 2]
      const outer = t
      colors[n] = .85 - outer * .24
      colors[n + 1] = .92 - outer * .48
      colors[n + 2] = 1
      if (outer > .62) { colors[n] = .66; colors[n + 1] = .30; colors[n + 2] = .95 }
    }
    return { live, start, target, colors }
  }, [])
  useFrame((state) => {
    const a = points.current?.geometry.attributes.position
    if (!a || !points.current) return
    // Travel → arrival → settled galaxy → dispersal, in one looping phase.
    const phase = (Math.sin(state.clock.elapsedTime * .16) + 1) * .5
    const amount = smooth(phase)
    const p = a.array as Float32Array
    for (let i = 0; i < p.length; i++) p[i] = start[i] + (target[i] - start[i]) * amount
    a.needsUpdate = true
    // Viewed from the camera-facing side, positive Z turns counter-clockwise.
    points.current.rotation.z = state.clock.elapsedTime * .035 * amount
    ;(points.current.material as THREE.PointsMaterial).opacity = .10 + amount * .40
  })
  return <points ref={points} frustumCulled={false} renderOrder={-4}>
    <bufferGeometry>
      <bufferAttribute attach="attributes-position" args={[live, 3]} />
      <bufferAttribute attach="attributes-color" args={[colors, 3]} />
    </bufferGeometry>
    <pointsMaterial size={.105} vertexColors transparent opacity={.1} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
  </points>
}
