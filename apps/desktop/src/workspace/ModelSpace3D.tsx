import { Canvas } from '@react-three/fiber'
import { OrbitControls, Stars } from '@react-three/drei'
import { useMemo } from 'react'

/** GPU-rendered model workspace shell. Geometry is illustrative, never model weights. */
export function ModelSpace3D({ modelName, runtime, online, state }: { modelName: string; runtime: string; online: boolean; state: string }) {
  const points = useMemo(() => Array.from({ length: 48 }, (_, index) => {
    const angle = index * Math.PI * (3 - Math.sqrt(5))
    const y = 1 - (index / 47) * 2
    const radius = Math.sqrt(1 - y * y)
    return [Math.cos(angle) * radius * 1.85, y * 1.85, Math.sin(angle) * radius * 1.85] as const
  }), [])
  return <div className="model-space-scene" role="img" aria-label={`GPU-rendered model workspace for ${modelName}; visual geometry is illustrative, not model weights`}>
    <Canvas dpr={[1, 1.5]} camera={{ position: [0, 0, 6.2], fov: 48 }} gl={{ antialias: true, powerPreference: 'low-power' }}>
      <color attach="background" args={['#070711']} />
      <fog attach="fog" args={['#070711', 8, 17]} />
      <ambientLight intensity={0.8} />
      <pointLight position={[3, 2, 4]} intensity={16} color={online ? '#b886ff' : '#6c6377'} />
      <Stars radius={24} depth={14} count={280} factor={1.1} saturation={0} fade speed={0} />
      <group>
        <mesh><icosahedronGeometry args={[1.16, 3]} /><meshPhysicalMaterial color={online ? '#6d3aa8' : '#342b42'} roughness={0.29} metalness={0.24} transmission={0.13} thickness={0.45} transparent opacity={0.78} /></mesh>
        <mesh scale={1.08}><icosahedronGeometry args={[1.16, 2]} /><meshBasicMaterial color={online ? '#d6a8ff' : '#8a7a9b'} wireframe transparent opacity={0.32} /></mesh>
        {points.map((point, index) => <mesh key={index} position={point}><sphereGeometry args={[index % 6 === 0 ? 0.045 : 0.023, 8, 8]} /><meshBasicMaterial color={online ? (index % 3 === 0 ? '#78e1d3' : '#d8adff') : '#9b8da8'} /></mesh>)}
        <mesh rotation={[Math.PI / 2.3, 0.18, 0]}><torusGeometry args={[1.62, 0.009, 5, 100]} /><meshBasicMaterial color="#ae78db" transparent opacity={0.55} /></mesh>
      </group>
      <OrbitControls enablePan={false} minDistance={3.4} maxDistance={9} autoRotate={false} />
    </Canvas>
    <div className="model-space-label"><span>{state}</span><strong>{modelName}</strong><small>{runtime} · GPU-rendered workspace visualization · not a weight/activation map</small></div>
  </div>
}
