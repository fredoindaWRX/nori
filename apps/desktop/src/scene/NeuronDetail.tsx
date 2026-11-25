import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { detailedNeuron, organicSoma } from './neural-morphology'

export function NeuronDetail({ nodes, links, index, color }: { nodes: THREE.Vector3[]; links: number[]; index: number; color: THREE.Color }) {
  const anatomy = useMemo(() => detailedNeuron(nodes, links, index), [nodes, links, index])
  const soma = useMemo(() => organicSoma(), [])
  const membrane = useMemo(() => {
    const size = 256, pixels = new Uint8Array(size * size * 4)
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size * Math.PI * 2, v = y / size * Math.PI * 2
      const folds = Math.sin(u * 17 + Math.sin(v * 9) * 2) * .2
        + Math.sin(u * 41 + v * 31) * Math.sin(v * 37) * .12
        + Math.sin(u * 83 - v * 79) * .07
      const value = Math.round((.5 + folds) * 255), offset = (y * size + x) * 4
      pixels[offset] = pixels[offset+1] = pixels[offset+2] = value; pixels[offset+3] = 255
    }
    const texture = new THREE.DataTexture(pixels,size,size,THREE.RGBAFormat)
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter
    texture.generateMipmaps = true; texture.needsUpdate = true
    return texture
  }, [])
  const synapses = useRef<THREE.InstancedMesh>(null)
  useEffect(() => {
    if (!synapses.current) return
    const matrix = new THREE.Matrix4()
    anatomy.junctions.forEach((point, i) => { matrix.makeTranslation(point.x, point.y, point.z); synapses.current!.setMatrixAt(i,matrix) })
    synapses.current.instanceMatrix.needsUpdate = true
    synapses.current.computeBoundingSphere()
  }, [anatomy])
  useEffect(() => () => anatomy.fibers?.dispose(), [anatomy])
  useEffect(() => () => soma.dispose(), [soma])
  useEffect(() => () => membrane.dispose(), [membrane])
  return <group>
    <mesh position={nodes[index]} geometry={soma}>
      <meshPhysicalMaterial color={color} bumpMap={membrane} bumpScale={.0007} roughness={.58} metalness={.04} clearcoat={.14} clearcoatRoughness={.55} emissive={color} emissiveIntensity={.08} />
    </mesh>
    {anatomy.fibers && <mesh geometry={anatomy.fibers}>
      <meshStandardMaterial color={color} roughness={.52} metalness={.05} emissive={color} emissiveIntensity={.08}/>
    </mesh>}
    {anatomy.junctions.length > 0 && <instancedMesh ref={synapses} args={[undefined,undefined,anatomy.junctions.length]}>
      <sphereGeometry args={[.00065,10,8]}/>
      <meshStandardMaterial color={color.clone().lerp(new THREE.Color('#f3dfb7'),.4)} roughness={.5}/>
    </instancedMesh>}
  </group>
}
