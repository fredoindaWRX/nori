import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { organicSoma } from './neural-morphology'
import { NeuronDetail } from './NeuronDetail'
import { NEURAL_REGIONS } from './neural-activity'
import { regionHighlight, sparseNeuralPulse } from './neural-visuals'
import { showFineNeuralDetail } from './neural-navigation-visuals'

export function NeuralTissue({ nodes, links, regions, colors, energy, focused, highlighted, navigating = false }: { nodes: THREE.Vector3[]; links: number[]; regions: number[]; colors: THREE.Color[]; energy: Float32Array; focused: number | null; highlighted: string | null; navigating?: boolean }) {
  const group = useRef<THREE.Group>(null)
  const bodies = useRef<THREE.InstancedMesh>(null), fibers = useRef<THREE.InstancedMesh>(null)
  const [nearby, setNearby] = useState<number[]>([])
  const lastSelection = useRef(''), checkedAt = useRef(-1)
  const soma = useMemo(() => organicSoma(.014,16,12), [])
  const paths = useMemo(() => {
    const segments: { matrix: THREE.Matrix4; region: number }[] = []
    const up = new THREE.Vector3(0,1,0)
    const append = (a: THREE.Vector3,b: THREE.Vector3,radius: number,region: number) => {
      const delta = b.clone().sub(a), length = delta.length()
      if (length < 1e-8) return
      const rotation = new THREE.Quaternion().setFromUnitVectors(up,delta.normalize())
      segments.push({matrix:new THREE.Matrix4().compose(a.clone().lerp(b,.5),rotation,new THREE.Vector3(radius,length,radius)),region})
    }
    for (let i = 0; i < links.length; i += 2) {
      const a=nodes[links[i]],b=nodes[links[i+1]],middle=a.clone().lerp(b,.5)
      middle.add(new THREE.Vector3(-middle.y,middle.x,.2).normalize().multiplyScalar(a.distanceTo(b)*.22))
      const curve=new THREE.QuadraticBezierCurve3(a,middle,b)
      for(let j=0;j<8;j++)append(curve.getPoint(j/8),curve.getPoint((j+1)/8),.0011,regions[links[i]])
    }
    // Fine local arborization is visual anatomy, not additional functional routes.
    nodes.forEach((node,index) => {
      for(let branch=0;branch<3;branch++) {
        const phase=index*2.399+branch*2.094
        const direction=new THREE.Vector3(Math.cos(phase),Math.sin(phase*1.7),Math.sin(phase)).normalize()
        const end=node.clone().addScaledVector(direction,.045)
        const curve=new THREE.QuadraticBezierCurve3(node,node.clone().lerp(end,.5).add(new THREE.Vector3(0,.015,0)),end)
        for(let j=0;j<4;j++)append(curve.getPoint(j/4),curve.getPoint((j+1)/4),.001*(1-j/5),regions[index])
      }
    })
    return segments
  },[nodes,links,regions])
  useEffect(() => {
    const matrix=new THREE.Matrix4()
    nodes.forEach((node,index) => {
      matrix.makeRotationFromEuler(new THREE.Euler(index*.73,index*1.31,index*.21));matrix.setPosition(node)
      bodies.current!.setMatrixAt(index,matrix);bodies.current!.setColorAt(index,colors[regions[index]])
    })
    paths.forEach((segment,index) => { fibers.current!.setMatrixAt(index,segment.matrix);fibers.current!.setColorAt(index,colors[segment.region].clone().multiplyScalar(.65)) })
    for(const mesh of [bodies.current!,fibers.current!]){mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor!.needsUpdate=true;mesh.computeBoundingSphere()}
  },[nodes,paths,regions,colors])
  useEffect(() => () => soma.dispose(),[soma])
  const localCamera = useMemo(() => new THREE.Vector3(),[])
  const liveColor = useMemo(() => new THREE.Color(),[])
  const lastColorUpdate = useRef(-1)
  useFrame(({camera,clock}) => {
    // Fine arborization is presentation detail; dropping its instanced draw
    // during orbit/zoom keeps the neurons and main signal paths interactive.
    if (fibers.current) fibers.current.visible = showFineNeuralDetail(navigating)
    const updateColors = !navigating && (lastColorUpdate.current < 0 || clock.elapsedTime - lastColorUpdate.current >= 1 / 24)
    if (updateColors) {
    lastColorUpdate.current = clock.elapsedTime
    if(bodies.current){for(let i=0;i<nodes.length;i++){const active=energy[regions[i]], firing=sparseNeuralPulse(i,clock.elapsedTime,active);liveColor.copy(colors[regions[i]]).multiplyScalar((.035+firing*.95)*regionHighlight(NEURAL_REGIONS[regions[i]],highlighted));bodies.current.setColorAt(i,liveColor)}bodies.current.instanceColor!.needsUpdate=true}
    if(fibers.current){for(let i=0;i<paths.length;i++){const region=paths[i].region,firing=sparseNeuralPulse(i+nodes.length,clock.elapsedTime,energy[region]);liveColor.copy(colors[region]).multiplyScalar((.018+firing*.9)*regionHighlight(NEURAL_REGIONS[region],highlighted));fibers.current.setColorAt(i,liveColor)}fibers.current.instanceColor!.needsUpdate=true}
    }
    if (navigating) return
    if(clock.elapsedTime-checkedAt.current<.4||!group.current)return
    checkedAt.current=clock.elapsedTime;group.current.updateWorldMatrix(true,false)
    localCamera.copy(camera.position);group.current.worldToLocal(localCamera)
    const selected=localCamera.length()<2.5?nodes.map((node,index)=>({index,distance:node.distanceToSquared(localCamera)})).filter(item=>item.index!==focused&&item.distance<.7*.7).sort((a,b)=>a.distance-b.distance).slice(0,10).map(item=>item.index):[]
    const key=selected.join(',');if(key!==lastSelection.current){lastSelection.current=key;setNearby(selected)}
  })
  return <group ref={group}>
    <instancedMesh ref={bodies} args={[soma,undefined,nodes.length]}><meshStandardMaterial roughness={.62} metalness={.03}/></instancedMesh>
    <instancedMesh ref={fibers} args={[undefined,undefined,paths.length]}><cylinderGeometry args={[1,1,1,5,1]}/><meshStandardMaterial roughness={.65}/></instancedMesh>
    {nearby.map(index=><NeuronDetail key={index} nodes={nodes} links={links} index={index} color={colors[regions[index]]}/>)}
  </group>
}
