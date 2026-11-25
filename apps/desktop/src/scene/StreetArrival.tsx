import { useEffect, useMemo, useRef, type RefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import {earthLocationFromUV,earthDirection} from './earth-coordinates'

export type SurfaceDestination = { latitude: number; longitude: number }

/** Capture the actual UV hit on the displayed Earth mesh. Those coordinates
 * are handed unchanged to the detailed geographic map. */
export function StreetArrival({ controlsRef, surfaceRef, destination, returnLocation, onEnter, transitioning }: {
  controlsRef: RefObject<any>; surfaceRef: RefObject<THREE.Mesh | null>;
  destination: SurfaceDestination | null; returnLocation: RefObject<SurfaceDestination | null>;
  onEnter: (destination: SurfaceDestination) => void; transitioning: boolean;
}) {
  const { camera, gl } = useThree()
  const entered = useRef(false)
  const savedPosition = useRef(new THREE.Vector3(0, 0, 6.2))
  const ray = useMemo(() => new THREE.Raycaster(), [])
  const selected = useRef<SurfaceDestination | null>(null)
  useEffect(() => {
    const canvas = gl.domElement
    const point = (event: MouseEvent) => {
      if (destination || transitioning || !surfaceRef.current) return null
      const rect = canvas.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return null
      ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), camera)
      const hit = ray.intersectObject(surfaceRef.current, false)[0]
      return hit?.uv ? earthLocationFromUV(hit.uv.x,hit.uv.y) : null
    }
    const select = (event: WheelEvent) => { selected.current = point(event) }
    const enter = (event: MouseEvent) => { const location = point(event); if (location) { savedPosition.current.copy(camera.position); onEnter(location) } }
    canvas.addEventListener('wheel', select, { capture: true, passive: true })
    canvas.addEventListener('dblclick', enter)
    return () => { canvas.removeEventListener('wheel', select, true); canvas.removeEventListener('dblclick', enter) }
  }, [camera, destination, gl, onEnter, ray, surfaceRef, transitioning])
  useEffect(() => {
    if (destination) entered.current = true
    else if (entered.current) {
      const location = returnLocation.current
      if (location && surfaceRef.current) {
        const outward = new THREE.Vector3(...earthDirection(location.latitude,location.longitude))
        outward.applyQuaternion(surfaceRef.current.getWorldQuaternion(new THREE.Quaternion()))
        camera.position.copy(outward).multiplyScalar(5.8)
      } else camera.position.copy(savedPosition.current).normalize().multiplyScalar(5.8)
      controlsRef.current?.target.set(0, 0, 0)
      controlsRef.current?.update()
      entered.current = false
      selected.current = null
    }
  }, [destination, camera, controlsRef, returnLocation, surfaceRef])
  useFrame(() => {
    if (destination || transitioning || !surfaceRef.current || camera.position.length() >= 2.65) return
    savedPosition.current.copy(camera.position)
    ray.setFromCamera(new THREE.Vector2(0, 0), camera)
    const hit = ray.intersectObject(surfaceRef.current, false)[0]
    if (!hit?.uv) return
    const location = selected.current ?? earthLocationFromUV(hit.uv.x,hit.uv.y)
    if (location) onEnter(location)
  })
  return null
}
