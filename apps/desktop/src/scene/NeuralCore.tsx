import { useEffect, useMemo, useRef, useState } from 'react'
import { Html } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { useStore } from '../store'
import type { Drive } from './Scene'
import { neuralActivity, NEURAL_REGIONS } from './neural-activity'
import { observedNeuralSignals, neuralSignalProgress, neuralSignalColor } from './neural-signals'
import { buildNeuralTopology } from './neural-topology'
import { NEURAL_FUNCTIONAL_MAP, NEURAL_REGION_INFO, neuralRegionAtPoint } from './neural-region-info'
import { NeuronDetail } from './NeuronDetail'
import { NeuralTissue } from './NeuralTissue'
import { NeuralAtmosphere } from './NeuralAtmosphere'
import { bidirectionalPulse, regionHighlight, solarFlareColor, sparseNeuralPulse } from './neural-visuals'

const REGION_COLORS = ['#04e8ff','#8cfd79','#ffc233','#ff6148','#00f3d4','#ff9d20','#a18cff','#ff4ad8','#318bff','#ff3d58','#3df2ff','#d1f449','#ffb56b'].map(value => new THREE.Color(value))
// The rendered axons are decorative hit targets: Three.js otherwise checks
// every one of their ~34k line segments on each pointer movement. Neurons keep
// the region hover/select interactions with a much smaller picking surface.
const skipAxonRaycast = () => {}

/** Observable subsystem activity, never a claim about hidden model reasoning. */
export function NeuralCore({ drive, interactive = true, onFocus, overview = 0, navigating = false }: { drive: Drive; interactive?: boolean; onFocus?: (point: THREE.Vector3) => void; overview?: number; navigating?: boolean }) {
  const reactorVisible = useStore(state => state.ui.reactor.visible)
  const regionControlsVisible = interactive && reactorVisible
  const [selected, setSelected] = useState<typeof NEURAL_REGIONS[number] | null>(null)
  const [hoveredRegion, setHoveredRegion] = useState<typeof NEURAL_REGIONS[number] | null>(null)
  const [nearInterior, setNearInterior] = useState(false)
  const nearInteriorRef = useRef(false)
  const [focusedNode, setFocusedNode] = useState<number | null>(null)
  useEffect(() => { setFocusedNode(null) }, [overview])
  const restoreExploreFocus = useRef(false)
  const closeRegion = () => { restoreExploreFocus.current = true; setSelected(null) }
  useEffect(() => {
    if(!regionControlsVisible) {
      restoreExploreFocus.current = false
      setSelected(null)
    }
  }, [regionControlsVisible])
  const root = useRef<THREE.Group>(null)
  const points = useRef<THREE.Points>(null)
  const paths = useRef<THREE.LineSegments>(null)
  const lastText = useRef('')
  const streamedAt = useRef(-100)
  const lastVisualUpdate = useRef(-1)
  const data = useMemo(() => {
    const {positions, regions, links, nodes} = buildNeuralTopology()
    // Curved axons keep the interior organic and give signals a real path.
    const linePositions: number[] = [], lineNodes: number[] = [], progress: number[] = []
    for (let i = 0; i < links.length; i += 2) {
      const a = nodes[links[i]], b = nodes[links[i + 1]]
      const midpoint = a.clone().lerp(b, .5)
      const bend = new THREE.Vector3(-midpoint.y, midpoint.x, .2).normalize().multiplyScalar(a.distanceTo(b) * .22)
      const curve = new THREE.QuadraticBezierCurve3(a, midpoint.add(bend), b)
      for (let segment = 0; segment < 8; segment++) {
        for (const t of [segment / 8, (segment + 1) / 8]) {
          const p = curve.getPoint(t)
          linePositions.push(p.x, p.y, p.z); lineNodes.push(i); progress.push(t)
        }
      }
    }
    const nodeGeometry = new THREE.BufferGeometry()
    nodeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    nodeGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(positions.length), 3))
    const lineGeometry = new THREE.BufferGeometry()
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3))
    lineGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(linePositions.length), 3))
    // A soft radial sprite gives each neuron a bright core and a faint halo.
    // DataTexture avoids external image requests and works offline on the USB.
    const spriteSize = 128, spriteBytes = new Uint8Array(spriteSize * spriteSize * 4)
    for (let y = 0; y < spriteSize; y++) for (let x = 0; x < spriteSize; x++) {
      const radius = Math.hypot((x + .5) / spriteSize * 2 - 1, (y + .5) / spriteSize * 2 - 1)
      const offset = (y * spriteSize + x) * 4
      spriteBytes[offset] = spriteBytes[offset + 1] = spriteBytes[offset + 2] = 255
      // A defined small core and faint falloff, rather than a large fuzzy disc.
      const core = 1 - THREE.MathUtils.smoothstep(radius, .09, .15)
      spriteBytes[offset + 3] = Math.round(Math.min(1, core + Math.exp(-radius * radius * 20) * .12) * 255)
    }
    const sprite = new THREE.DataTexture(spriteBytes, spriteSize, spriteSize, THREE.RGBAFormat)
    sprite.needsUpdate = true
    sprite.magFilter = THREE.LinearFilter
    return { nodeGeometry, lineGeometry, regions, links, nodes, lineNodes, progress, sprite }
  }, [])
  const focus = (index: number) => {
    if (!onFocus || !root.current || !data.nodes[index]) return
    root.current.updateWorldMatrix(true, false)
    onFocus(root.current.localToWorld(data.nodes[index].clone()))
    setFocusedNode(index); setSelected(null)
  }
  useEffect(() => () => { data.nodeGeometry.dispose(); data.lineGeometry.dispose(); data.sprite.dispose() }, [data])
  const energy = useMemo(() => new Float32Array(NEURAL_REGIONS.length), [])
  useFrame(({ clock, camera }, dt) => {
    const isNear = camera.position.length() < 2.3
    if (isNear !== nearInteriorRef.current) { nearInteriorRef.current = isNear; setNearInterior(isNear) }
    const state = useStore.getState(), time = clock.elapsedTime
    const text = state.turns.at(-1)?.text ?? ''
    if (text !== lastText.current && state.turns.at(-1)?.role === 'nori') streamedAt.current = time
    lastText.current = text
    const targets = neuralActivity(state, time - streamedAt.current < .7)
    const signalNow = performance.now()
    const signals = observedNeuralSignals(signalNow)
    for (const signal of signals) {
      targets[NEURAL_REGIONS.indexOf(signal.from)] = 1
      targets[NEURAL_REGIONS.indexOf(signal.to)] = 1
    }
    for (let i = 0; i < energy.length; i++) energy[i] += (targets[i] - energy[i]) * Math.min(1, dt * 7)
    const power = Math.max(0, drive.reactor.intensity) * 2
    // The vertex colors are a large, CPU-written GPU buffer. Keep activity
    // animation responsive but update that buffer at a controlled cadence.
    const updateVisuals = !navigating && (lastVisualUpdate.current < 0 || time - lastVisualUpdate.current >= 1 / 24)
    if (updateVisuals) {
    lastVisualUpdate.current = time
    const colors = data.nodeGeometry.getAttribute('color') as THREE.BufferAttribute
    for (let i = 0; i < data.regions.length; i++) {
      const active = energy[data.regions[i]]
      const pulse = sparseNeuralPulse(i, time, active)
      const base = REGION_COLORS[data.regions[i]]
      const highlight = regionHighlight(NEURAL_REGIONS[data.regions[i]], hoveredRegion ?? selected)
      const brightness = (.035 + pulse * 1.2) * power * highlight
      colors.setXYZ(i, base.r * brightness, base.g * brightness, base.b * brightness)
    }
    colors.needsUpdate = true
    const lineColors = data.lineGeometry.getAttribute('color') as THREE.BufferAttribute
    const routes = new Map(signals.map(signal => [`${signal.from}->${signal.to}`, signal]))
    for (let i = 0; i < data.lineNodes.length; i++) {
      const edge = data.lineNodes[i]
      const node = data.links[edge], other = data.links[edge + 1]
      const sameRegion = data.regions[node] === data.regions[other]
      const route = routes.get(`${NEURAL_REGIONS[data.regions[node]]}->${NEURAL_REGIONS[data.regions[other]]}`)
      // Cross-region pulses show accepted bridge transport, not inferred thought.
      const signal = sameRegion
        ? bidirectionalPulse(data.progress[i], time, edge * .071, energy[data.regions[node]])
          * sparseNeuralPulse(edge, time, energy[data.regions[node]])
        : route ? Math.exp(-Math.pow((data.progress[i] - neuralSignalProgress(route, signalNow)) * 12, 2)) : 0
      const base = REGION_COLORS[data.regions[node]]
      const outcomeColor = route ? neuralSignalColor(route) : sameRegion ? solarFlareColor(data.progress[i]) : [base.r,base.g,base.b]
      const highlight = regionHighlight(NEURAL_REGIONS[data.regions[node]], hoveredRegion ?? selected)
      lineColors.setXYZ(i, (base.r * .025 + signal * outcomeColor[0] * 2.2) * power * highlight, (base.g * .025 + signal * outcomeColor[1] * 2.2) * power * highlight, (base.b * .025 + signal * outcomeColor[2] * 2.2) * power * highlight)
    }
    lineColors.needsUpdate = true
    }
    if (root.current) {
      root.current.visible = drive.reactor.visible
      root.current.scale.setScalar(drive.reactor.scale * (1 + drive.level * .035))
      // Hold the graph still when inspecting a neuron or moving inside it.
      if (!navigating && focusedNode === null && camera.position.length() > 2.3) root.current.rotation.y += dt * .045 * drive.reactor.spin
    }

  })
  return <group ref={root}>
    <NeuralTissue nodes={data.nodes} links={data.links} regions={data.regions} colors={REGION_COLORS} energy={energy} focused={focusedNode} highlighted={hoveredRegion ?? selected ?? (focusedNode === null ? null : NEURAL_REGIONS[data.regions[focusedNode]])} navigating={navigating} />
    <points ref={points} geometry={data.nodeGeometry} onClick={event => {
      if (!interactive) return
      const region = neuralRegionAtPoint(data.regions,event.index)
      if(region) { event.stopPropagation(); setSelected(region) }
    }} onPointerMove={event => {
      if (!interactive || event.index === undefined) return
      const region = neuralRegionAtPoint(data.regions,event.index)
      if (region) setHoveredRegion(region)
    }} onPointerOut={() => setHoveredRegion(null)} onPointerMissed={() => setHoveredRegion(null)} onDoubleClick={event => {
      if (!interactive || event.index === undefined) return
      event.stopPropagation(); focus(event.index)
    }}>
      <pointsMaterial map={data.sprite} vertexColors size={focusedNode === null ? .065 : .012} transparent alphaTest={.015} opacity={.95} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
    {focusedNode !== null && <NeuronDetail nodes={data.nodes} links={data.links} index={focusedNode} color={REGION_COLORS[data.regions[focusedNode]]} />}
    {regionControlsVisible && !selected && focusedNode === null && !nearInterior && <Html center position={[0,0,0]}>
      <button ref={element => {
        if(element && restoreExploreFocus.current) {
          restoreExploreFocus.current = false
          element.focus()
        }
      }} type="button" aria-label="Explore brain regions" onClick={() => setSelected('language')}
        style={{padding:'7px 12px',border:'1px solid #a56bff',borderRadius:8,background:'rgba(12,8,22,.9)',color:'#eee',cursor:'pointer'}}>Explore brain</button>
    </Html>}
    {regionControlsVisible && selected && <Html center position={[0,0,0]} portal={{current:document.getElementById('root')!}} wrapperClass="neural-region-overlay" zIndexRange={[101,100]}>
      <section aria-label="Brain region" onKeyDown={event => { if(event.key==='Escape') { event.stopPropagation(); closeRegion() } }} style={{width:'min(288px, calc(100vw - 32px))',maxHeight:'calc(100dvh - 48px)',overflowY:'auto',boxSizing:'border-box',padding:14,border:'1px solid #a56bff',borderRadius:10,background:'rgba(12,8,22,.95)',color:'#eee',font:'13px/1.5 system-ui'}}>
        <label htmlFor="nori-brain-region">Brain region</label>
        <select id="nori-brain-region" autoFocus value={selected}
          onChange={event => setSelected(NEURAL_REGIONS.find(region => region===event.target.value) ?? null)}
          style={{display:'block',width:'100%',margin:'8px 0',padding:6,background:'#181024',color:'#eee',border:'1px solid #a56bff',borderRadius:5}}>
          {NEURAL_REGIONS.map(region => <option key={region} value={region}>{NEURAL_REGION_INFO[region].label}</option>)}
        </select>
        <strong>{NEURAL_REGION_INFO[selected].label}</strong>
        <p>Functional role: {NEURAL_FUNCTIONAL_MAP[selected]}</p>
        <p>{NEURAL_REGION_INFO[selected].description}</p>
        {onFocus && <button onClick={() => {
          const region = NEURAL_REGIONS.indexOf(selected)
          const indices = data.regions.map((value, index) => value === region ? index : -1).filter(index => index >= 0)
          focus(indices[Math.floor(indices.length / 2)])
        }}>Inspect this region up close</button>}
        <p>Hover or select a neuron or fiber to light its whole region. Paired bright sparks show activity moving both ways along local connections; cross-region flashes mark observed bridge traffic. Green = completed or allowed; red = failed or denied; amber = cancelled.</p>
        <button type="button" onClick={closeRegion}>Close</button>
      </section>
    </Html>}
    <lineSegments ref={paths} geometry={data.lineGeometry} raycast={skipAxonRaycast}>
      <lineBasicMaterial vertexColors transparent opacity={.72} blending={THREE.AdditiveBlending} depthWrite={false} />
    </lineSegments>
    <NeuralAtmosphere inspecting={focusedNode !== null} navigating={navigating} />
  </group>
}
