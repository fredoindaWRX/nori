import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/* An all-direction star/nebula shell. Unlike a CSS backdrop this is a sphere
 * around the camera: there is visual data above, below, and behind the current
 * view, ready for future camera/gesture look controls as well. */
export function SpaceShell() {
  const shell = useRef<THREE.Points>(null)
  const { positions, colors } = useMemo(() => {
    const count = 7200
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1
      const a = Math.random() * Math.PI * 2
      const r = 42 + Math.random() * 22
      const s = Math.sqrt(1 - u * u)
      positions[i * 3] = Math.cos(a) * s * r
      positions[i * 3 + 1] = u * r
      positions[i * 3 + 2] = Math.sin(a) * s * r
      const warm = Math.random() > .78
      const violet = !warm && Math.random() > .52
      colors[i * 3] = warm ? .95 : violet ? .82 : .30
      colors[i * 3 + 1] = warm ? .38 : violet ? .20 : .52
      colors[i * 3 + 2] = warm ? .12 : violet ? .72 : .95
    }
    return { positions, colors }
  }, [])
  useFrame((state) => {
    if (!shell.current) return
    shell.current.rotation.y = state.clock.elapsedTime * .008
    shell.current.rotation.x = Math.sin(state.clock.elapsedTime * .021) * .035
  })
  return <points ref={shell} frustumCulled={false} renderOrder={-5}>
    <bufferGeometry>
      <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      <bufferAttribute attach="attributes-color" args={[colors, 3]} />
    </bufferGeometry>
    <pointsMaterial size={.18} vertexColors transparent opacity={.64} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
  </points>
}
