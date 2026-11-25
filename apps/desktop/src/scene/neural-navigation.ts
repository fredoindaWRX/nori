import * as THREE from 'three'

export const NEURAL_CAMERA = Object.freeze({ near: .001, far: 80, minimumDistance: .035, maximumDistance: 13, inspectionDistance: .14, overviewDistance: 6.2 })

export function neuralFocusPose(camera: THREE.Vector3, previousTarget: THREE.Vector3, point: THREE.Vector3) {
  if (![...camera.toArray(), ...previousTarget.toArray(), ...point.toArray()].every(Number.isFinite)) throw new Error('Finite neural camera coordinates required')
  const direction = camera.clone().sub(previousTarget)
  if (direction.lengthSq() < 1e-12) direction.set(0, 0, 1)
  return { target: point.clone(), position: point.clone().add(direction.normalize().multiplyScalar(NEURAL_CAMERA.inspectionDistance)) }
}

export function neuralNavigationScale(distance: number) {
  const approach = THREE.MathUtils.clamp(distance / 2.5, .12, 1)
  return { rotateSpeed: .46 * approach, zoomSpeed: .48, panSpeed: .42 * approach }
}

// Close inspection follows the same graph edges as the overview.
export function neuralIncidentEdges(links: readonly number[], node: number) {
  if (!Number.isInteger(node) || node < 0 || links.length % 2) throw new Error('Valid neural graph node and edge pairs required')
  const result: number[] = []
  for (let edge = 0; edge < links.length; edge += 2) if (links[edge] === node || links[edge + 1] === node) result.push(edge)
  return result
}
