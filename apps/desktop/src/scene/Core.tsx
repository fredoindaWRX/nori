import { useMemo, useRef, type RefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import type { Drive } from './Scene'

/** Nori's live form: black dimensional orb, ghost-purple energy shell — never an eye. */
const chargeFor = {
  offline: .02,
  boot: .30,
  dormant: .08,
  waking: .56,
  listening: .38,
  thinking: .72,
  tooling: .82,
  speaking: 1,
} as const

/**
 * A containment band is intentionally broken into hundreds of tiny field
 * strokes, with bright timing marks and charge nodes. Perfect toruses read as
 * clip-art; an instrumented magnetic field has gaps, rails, and hardware.
 */
function ContainmentBand({
  radius,
  squash = 1,
  rotation,
  color,
  opacity,
  dash = 5,
}: {
  radius: number
  squash?: number
  rotation: [number, number, number]
  color: string
  opacity: number
  dash?: number
}) {
  const { positions, nodes } = useMemo(() => {
    const points: number[] = []
    const nodePoints: [number, number, number][] = []
    const sections = 260
    const step = Math.PI * 2 / sections
    for (let i = 0; i < sections; i++) {
      // Long structural arcs punctuated by deliberate field gaps.
      if ((i + 2) % dash < 2) continue
      const a = i * step
      const b = a + step * .72
      points.push(
        Math.cos(a) * radius, Math.sin(a) * radius * squash, 0,
        Math.cos(b) * radius, Math.sin(b) * radius * squash, 0,
      )
      if (i % 43 === 0) nodePoints.push([Math.cos(a) * radius, Math.sin(a) * radius * squash, 0])
    }
    return { positions: new Float32Array(points), nodes: nodePoints }
  }, [radius, squash, dash])

  return (
    <group rotation={rotation}>
      <lineSegments>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} transparent opacity={opacity} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
      {/* Offset hairline gives each arc a built, double-rail profile. */}
      <lineSegments scale={[.984, .984, 1]}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} transparent opacity={opacity * .15} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
      {nodes.map((position, index) => (
        <mesh key={index} position={position}>
          <sphereGeometry args={[.027, 10, 10]} />
          <meshBasicMaterial color="#f0c9ff" transparent opacity={Math.min(1, opacity + .15)} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
      ))}
    </group>
  )
}

export function Core({ drive, surfaceRef }: { drive: Drive; surfaceRef?: RefObject<THREE.Mesh | null> }) {
  const body = useRef<THREE.Mesh>(null)
  const aura = useRef<THREE.Group>(null)
  const civilization = useRef<THREE.Mesh>(null)
  const civilizationMaterial = useRef<THREE.ShaderMaterial>(null)
  const surface = useTexture('/images/nori-orb-surface.png')
  surface.colorSpace = THREE.SRGBColorSpace
  surface.wrapS = THREE.RepeatWrapping
  surface.wrapT = THREE.RepeatWrapping
  surface.anisotropy = 16
  // Paired local 8K NASA maps. The shader below selects the correct layer
  // from the real-world sun position instead of treating night as a static
  // cosmetic mode.
  const [dayMap, civilizationMap] = useTexture([
    '/images/nori-earth-map-8k.jpg',
    '/images/nori-earth-civilization-8k.jpg',
  ])
  dayMap.colorSpace = THREE.SRGBColorSpace
  dayMap.wrapS = THREE.RepeatWrapping
  dayMap.wrapT = THREE.ClampToEdgeWrapping
  dayMap.anisotropy = 16
  civilizationMap.colorSpace = THREE.SRGBColorSpace
  civilizationMap.wrapS = THREE.RepeatWrapping
  civilizationMap.wrapT = THREE.ClampToEdgeWrapping
  civilizationMap.anisotropy = 16
  const planetUniforms = useMemo(() => ({
    dayMap: { value: dayMap },
    nightMap: { value: civilizationMap },
    sunLongitude: { value: 0 },
    sunDeclination: { value: 0 },
    opacity: { value: 0 },
    detail: { value: 0 },
  }), [dayMap, civilizationMap])
  const forgedGeometry = useMemo(() => {
    // A dense rounded object with small folded/crumpled relief. This preserves
    // a spherical silhouette while catching light in many tight facets.
    const geometry = new THREE.SphereGeometry(1.57, 192, 128)
    const positions = geometry.attributes.position
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i)
      const r = Math.hypot(x, y, z) || 1
      const nx = x / r, ny = y / r, nz = z / r
      const fold =
        Math.sin(nx * 21 + ny * 13 + nz * 17) * .018 +
        Math.sin(nx * 47 - ny * 39 + nz * 31) * .012 +
        Math.sin(nx * 89 + ny * 61 - nz * 73) * .006
      positions.setXYZ(i, x * (1 + fold), y * (1 + fold), z * (1 + fold))
    }
    positions.needsUpdate = true
    geometry.computeVertexNormals()
    return geometry
  }, [])

  useFrame((state, dt) => {
    // State is its own energy source; talking/thinking must look charged even
    // during a quiet syllable or a pause in speech synthesis.
    const stateCharge = chargeFor[drive.phase]
    const level = Math.max(drive.level, .045, stateCharge)
    const pulse = 1 + level * .10 + Math.sin(state.clock.elapsedTime * (1.25 + stateCharge)) * (.012 + stateCharge * .012)
    if (body.current) {
      body.current.scale.setScalar(pulse * drive.reactor.scale)
      // The asymmetrical forged surface makes this rotation visibly legible:
      // Nori remains calm at rest, but never reads as a frozen screenshot.
      body.current.rotation.y += dt * (.115 + level * .36) * drive.reactor.spin
      body.current.rotation.x += dt * (.031 + level * .09)
      body.current.rotation.z = Math.sin(state.clock.elapsedTime * .19) * .045
      body.current.position.y = Math.sin(state.clock.elapsedTime * .46) * .045
      const material = body.current.material as THREE.MeshPhysicalMaterial
      const uiPower = .65 + drive.reactor.intensity * .35
      material.emissiveIntensity = (.20 + stateCharge * 1.45 + drive.level * .48) * uiPower
      // It stays ghost-purple at every phase, but power brings the violet
      // through the black surface rather than merely enlarging the glow.
      material.emissive.setRGB(
        .105 + stateCharge * .19,
        .012 + stateCharge * .045,
        .145 + stateCharge * .32,
      )
      material.color.setRGB(
        .24 + stateCharge * .19,
        .075 + stateCharge * .09,
        .31 + stateCharge * .24,
      )
    }
    if (civilization.current && body.current) {
      // Surface detail appears gradually only after the viewer has committed
      // to approaching Nori. At regular framing she remains the polished orb;
      // close in, the city grid and power hubs resolve from the texture.
      civilization.current.rotation.copy(body.current.rotation)
      civilization.current.position.copy(body.current.position)
      civilization.current.scale.copy(body.current.scale).multiplyScalar(1.028)
      const distance = state.camera.position.distanceTo(body.current.position)
      // The satellite/civilization shell is only an orbital layer. Keeping it
      // at street distance turns it into an enormous, broken-looking texture.
      // StreetArrival owns the view after the visitor crosses this boundary.
      civilization.current.visible = distance > 2.4
      const reveal = 1 - THREE.MathUtils.smoothstep(distance, 2.15, 5.55)
      const opacity = THREE.MathUtils.clamp(reveal, 0, 1) * (.84 + stateCharge * .16)
      if (civilizationMaterial.current) {
        // Approximate the subsolar point from the current UTC date and time.
        // This is a live astronomical day/night boundary: not a timed loop.
        const now = new Date()
        const yearStart = Date.UTC(now.getUTCFullYear(), 0, 0)
        const dayOfYear = (now.getTime() - yearStart) / 86_400_000
        const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600
        civilizationMaterial.current.uniforms.sunLongitude.value = (12 - utcHours) * Math.PI / 12
        civilizationMaterial.current.uniforms.sunDeclination.value = -23.44 * Math.PI / 180 * Math.cos(2 * Math.PI * (dayOfYear + 10) / 365.2422)
        civilizationMaterial.current.uniforms.opacity.value = opacity
        // At close range the planet stops being a single satellite texture:
        // procedural districts resolve at every longitude/latitude, so there
        // is no one special destination or blank side of the world.
        civilizationMaterial.current.uniforms.detail.value = 0
      }
    }
    if (aura.current) {
      // Containment field counter-rotates at a different rate, creating the
      // slow orbital parallax of a contained energy source.
      aura.current.rotation.y -= dt * (.075 + level * .29) * drive.reactor.spin
      aura.current.rotation.z += dt * (.018 + level * .05)
      aura.current.rotation.x = Math.sin(state.clock.elapsedTime * .22) * .12
      aura.current.scale.setScalar(pulse * drive.reactor.scale)
      // From orbital distance the purple shell and containment field are
      // Nori's atmosphere. Once the viewer crosses that boundary, clear the
      // field from view so the civilization layer can read as a real surface.
      const distance = body.current
        ? state.camera.position.distanceTo(body.current.position)
        : Infinity
      aura.current.visible = distance > 3.35
    }
  })

  return (
    <group visible={drive.reactor.visible}>
      <ambientLight color="#331447" intensity={.82} />
      {/* Two hard key lights travel across the turning relief, so the finish
          reads as polished energy-glass instead of dull painted rock. */}
      <pointLight color="#edbaff" intensity={27} distance={8} position={[-3, 2.5, 4]} />
      <pointLight color="#9b3bdf" intensity={18} distance={7} position={[3, -2, -2]} />
      <pointLight color="#ffffff" intensity={10} distance={5} position={[0, 3.2, 2.8]} />
      <mesh ref={body} castShadow receiveShadow>
        <primitive object={forgedGeometry} attach="geometry" />
        <meshPhysicalMaterial
          map={surface}
          color="#6d3487"
          emissive="#3b074f"
          emissiveMap={surface}
          emissiveIntensity={.30}
          metalness={.68}
          roughness={.065}
          clearcoat={.82}
          clearcoatRoughness={.045}
          iridescence={.28}
          iridescenceIOR={1.45}
        />
      </mesh>
      <mesh ref={(mesh) => { civilization.current = mesh; if (surfaceRef) surfaceRef.current = mesh }} visible={drive.reactor.visible} renderOrder={2}>
        <primitive object={forgedGeometry} attach="geometry" />
        <shaderMaterial
          ref={civilizationMaterial}
          uniforms={planetUniforms}
          transparent
          depthWrite={false}
          vertexShader={`varying vec2 vUv; varying vec3 vNormal; void main() { vUv = uv; vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`}
          fragmentShader={`
            uniform sampler2D dayMap; uniform sampler2D nightMap;
            uniform float sunLongitude; uniform float sunDeclination;
            uniform float opacity; uniform float detail;
            varying vec2 vUv; varying vec3 vNormal;
            void main() {
              float lon = (vUv.x - 0.5) * 6.28318530718; float lat = (vUv.y - 0.5) * 3.14159265359;
              vec3 mapNormal = vec3(cos(lat) * cos(lon), sin(lat), cos(lat) * sin(lon));
              vec3 sun = vec3(cos(sunDeclination) * cos(sunLongitude), sin(sunDeclination), cos(sunDeclination) * sin(sunLongitude));
              float light = dot(mapNormal, sun); float dayFactor = smoothstep(-0.10, 0.16, light);
              vec3 day = texture2D(dayMap, vUv).rgb; vec3 night = texture2D(nightMap, vUv).rgb;
              vec3 color = mix(night, day, dayFactor);
              gl_FragColor = vec4(color, opacity);
            }`}
        />
      </mesh>
      <group ref={aura}>
        <mesh scale={1.075}>
          <sphereGeometry args={[1.52, 72, 72]} />
          <meshBasicMaterial color="#a743e2" transparent opacity={.075} side={THREE.BackSide} blending={THREE.AdditiveBlending} depthWrite={false} />
        </mesh>
        <ContainmentBand radius={1.80} rotation={[.86, .14, -.42]} color="#dda2ff" opacity={.82} dash={7} />
        <ContainmentBand radius={1.97} squash={.70} rotation={[-.42, 1.12, .32]} color="#8d36bc" opacity={.64} dash={5} />
        <ContainmentBand radius={2.08} squash={1.14} rotation={[1.48, -.28, .74]} color="#f0c7ff" opacity={.42} dash={9} />
      </group>
    </group>
  )
}
