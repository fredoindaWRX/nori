import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { neuralIncidentEdges } from './neural-navigation.ts'

/** Geometry detail illustrates fibers; only graph edges represent actual routes. */
export function organicSoma(radius = .009, segments = 48, rings = 32) {
  const geometry = new THREE.SphereGeometry(radius, segments, rings)
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < positions.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(positions, i)
    const n = p.clone().normalize()
    const fold = 1 + .13 * Math.sin(n.x * 7 + n.z * 3) * Math.sin(n.y * 6)
      + .045 * Math.sin(n.z * 19 + n.y * 11)
    p.multiplyScalar(fold); p.y *= 1.35; p.x *= .88
    positions.setXYZ(i, p.x, p.y, p.z)
  }
  geometry.computeVertexNormals()
  return geometry
}

function taperedFiber(curve: THREE.Curve<THREE.Vector3>, startRadius: number, endRadius: number, segments = 36) {
  const geometry = new THREE.TubeGeometry(curve, segments, 1, 8, false)
  const positions = geometry.getAttribute('position') as THREE.BufferAttribute
  for (let ring = 0; ring <= segments; ring++) {
    const t = ring / segments, center = curve.getPointAt(t)
    const radius = THREE.MathUtils.lerp(startRadius, endRadius, Math.pow(t, .6))
    for (let side = 0; side <= 8; side++) {
      const index = ring * 9 + side
      const p = new THREE.Vector3().fromBufferAttribute(positions, index).sub(center).multiplyScalar(radius).add(center)
      positions.setXYZ(index, p.x, p.y, p.z)
    }
  }
  geometry.computeVertexNormals()
  return geometry
}

export function detailedNeuron(nodes: THREE.Vector3[], links: number[], index: number) {
  const origin = nodes[index]
  if (!origin) throw new Error('Unknown neuron')
  const geometries: THREE.BufferGeometry[] = [], junctions: THREE.Vector3[] = []
  const edges = neuralIncidentEdges(links, index)
  let seed = index + 1709
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  for (const edge of edges) {
    const other = nodes[links[edge] === index ? links[edge + 1] : links[edge]]
    const middle = origin.clone().lerp(other, .5)
    middle.add(new THREE.Vector3(-middle.y, middle.x, .2).normalize().multiplyScalar(origin.distanceTo(other) * .22))
    const curve = new THREE.QuadraticBezierCurve3(origin, middle, other)
    geometries.push(taperedFiber(curve, .0031, .0005, 64))
    for (let j = 1; j <= 6; j++) {
      const t = j / 8, base = curve.getPoint(t)
      const direction = new THREE.Vector3(random() - .5, random() - .5, random() - .5).normalize()
      const tip = base.clone().addScaledVector(direction, .025 + random() * .045)
      const branch = new THREE.QuadraticBezierCurve3(base, base.clone().lerp(tip,.45).add(new THREE.Vector3(0,.007,0)), tip)
      geometries.push(taperedFiber(branch, .0008, .00013, 16))
      for (let k = 1; k <= 4; k++) {
        const stalk = branch.getPoint(k / 5)
        const end = stalk.clone().add(new THREE.Vector3(random()-.5,random()-.5,random()-.5).normalize().multiplyScalar(.003 + random()*.004))
        geometries.push(taperedFiber(new THREE.LineCurve3(stalk,end),.00022,.0001,3))
        junctions.push(end)
      }
      const fork = tip.clone().addScaledVector(new THREE.Vector3(direction.y,-direction.x,direction.z).normalize(),.012)
      geometries.push(taperedFiber(new THREE.LineCurve3(branch.getPoint(.7),fork),.00035,.00008,8))
    }
  }
  const fibers = geometries.length ? mergeGeometries(geometries) : new THREE.BufferGeometry()
  geometries.forEach(geometry => geometry.dispose())
  return { fibers, junctions, edges }
}
