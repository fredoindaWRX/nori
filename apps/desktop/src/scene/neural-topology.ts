import * as THREE from 'three'
import { NEURAL_CENTERS, NEURAL_REGIONS } from './neural-activity.ts'
import { NEURAL_TRANSPORT_DESTINATIONS } from './neural-signals.ts'

/** The renderer's deterministic node/fiber graph, inspectable without WebGL. */
export function buildNeuralTopology() {
  let seed = 7319
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  const positions: number[] = [], regions: number[] = [], links: number[] = []
  const centers = NEURAL_CENTERS.map(center => new THREE.Vector3(...center))
  const nodesPerRegion = Math.floor(1680 / NEURAL_REGIONS.length)
  const nodes: THREE.Vector3[] = []
  for (let region = 0; region < centers.length; region++) {
    for (let i = 0; i < nodesPerRegion; i++) {
      const theta = random() * Math.PI * 2, z = random() * 2 - 1
      const radius = Math.cbrt(random()) * .63, planar = Math.sqrt(1 - z * z)
      const p = centers[region].clone().add(new THREE.Vector3(Math.cos(theta) * planar, z, Math.sin(theta) * planar).multiplyScalar(radius))
      if (p.length() > 1.48) p.setLength(1.48)
      nodes.push(p); positions.push(p.x, p.y, p.z); regions.push(region)
    }
  }
  for (let i = 0; i < nodes.length; i++) {
    const nearby = nodes.map((p, j) => ({ j, d: p.distanceToSquared(nodes[i]) })).filter(p => p.j !== i && p.d < .22).sort((a, b) => a.d - b.d).slice(0, 5)
    for (const { j } of nearby) if (j > i) links.push(i, j)
    if (i % 30 === 0) links.push(i, ((Math.floor(i / nodesPerRegion) + 1) % centers.length) * nodesPerRegion + i % nodesPerRegion)
  }
  for (const destination of NEURAL_TRANSPORT_DESTINATIONS) {
    links.push(NEURAL_REGIONS.indexOf('connections') * nodesPerRegion, NEURAL_REGIONS.indexOf(destination) * nodesPerRegion)
  }
  return {positions, regions, links, nodes}
}
