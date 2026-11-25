import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

/** Slow, nearby debris gives the calm deep-space voyage a foreground layer. */
export function DeepSpaceDebris() {
  const group = useRef<THREE.Points>(null)
  const { positions, colors } = useMemo(() => {
    const count = 260, positions = new Float32Array(count * 3), colors = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const n = i * 3, a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 20
      positions[n] = Math.cos(a) * r; positions[n + 1] = (Math.random() - .5) * 14; positions[n + 2] = -3 - Math.random() * 25
      const warm = Math.random() > .74
      colors[n] = warm ? .72 : .25; colors[n + 1] = warm ? .34 : .22; colors[n + 2] = warm ? .12 : .34
    }
    return { positions, colors }
  }, [])
  useFrame((state) => { if (group.current) { group.current.rotation.y = state.clock.elapsedTime * .012; group.current.rotation.x = Math.sin(state.clock.elapsedTime * .08) * .025 } })
  return <points ref={group} frustumCulled={false} renderOrder={-1}>
    <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /><bufferAttribute attach="attributes-color" args={[colors, 3]} /></bufferGeometry>
    <pointsMaterial size={.42} vertexColors transparent opacity={.72} sizeAttenuation depthWrite={false} />
  </points>
}
