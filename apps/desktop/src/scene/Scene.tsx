import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { NeuralCore } from './NeuralCore'
import { NEURAL_CAMERA, neuralFocusPose, neuralNavigationScale } from './neural-navigation'
import { neuralRenderQuality } from './neural-render-quality'
import { Orbits } from './Orbits'
import { type SurfaceDestination } from './StreetArrival'
import { useStore, phaseColor, accentFor, type Phase } from '../store'

const CesiumSurface = lazy(() => import('./CesiumSurface').then(module => ({ default: module.CesiumSurface })))

/** Rings spin harder while N.O.R.I. is working — reads as effort. */
const spinFor: Record<Phase, number> = {
  offline: 0.08, // barely turning — the machine is off
  boot: 3.2,
  dormant: 0.25,
  waking: 4.5,
  listening: 1.1,
  thinking: 2.8,
  tooling: 3.6,
  speaking: 1.4,
}

/**
 * Surface displacement amplitude. Both states where nothing is happening get
 * the calm figure: 'offline' is the quietest moment in the whole piece — the
 * reactor hasn't been powered on yet — so it must not be the most agitated
 * thing on screen.
 */
/*
 * Much lower than they were. At 0.13/0.26 on a unit sphere the displacement is
 * a quarter of the radius, which is not a reactor breathing — it is a potato.
 * The reference core is a clean circle whose surface only shimmers; the drama
 * belongs to the instrument rings around it, not to the silhouette.
 */
const AMP_CALM = 0.035
const AMP_LIVE = 0.085

/**
 * Everything the three children animate from, in one mutable object.
 *
 * These used to be render-time props, which had two consequences. The scene
 * subscribed to mic level, so the entire r3f tree reconciled sixty times a
 * second for numbers that never leave useFrame; and because they were only
 * delivered on a re-render, they were delivered late or — before the analyser
 * starts and `level` is a constant zero — not at all, which is why the ignition
 * screen never picked up its own spin rate.
 *
 * Nothing here belongs in React state. The scene is updated by mutation and
 * React only ever mounts it: Rig writes this object once per frame, the
 * children read it in their own useFrame. Children subscribe to the frame loop
 * before their parent does, so they are reading the previous frame's values —
 * one frame of lag on quantities that are all lerped anyway, and invisible.
 */
export type Drive = {
  /** Current assistant state, used for the core's visible charge level. */
  phase: Phase
  color: THREE.Color
  /** 0..1 smoothed loudness, with an idle breath under it. */
  level: number
  /** Rotation multiplier for the drifting dust. */
  spin: number
  /** Target displacement amplitude for the core surface. */
  amp: number
  /** 0..1 power-up reveal — the ring assembles outwards from the centre. */
  open: number
  /**
   * The reactor slice of the ui state, already resolved and smoothed.
   *
   * Everything here is a no-op at UI_DEFAULTS: colour follows the phase exactly
   * as it always did, and the three multipliers sit at one.
   */
  reactor: {
    /** ui.reactor.color if set, otherwise the accent. */
    color: THREE.Color
    scale: number
    intensity: number
    /** Multiplier on the ring's own rotation rate. */
    spin: number
    /** 0 ring, 1 sphere, 2 wire — a number because it ends up in a uniform. */
    style: number
    visible: boolean
  }
}

/**
 * A colour target that only re-parses when the string actually changes.
 *
 * The colours in the ui slice are arbitrary CSS written by N.O.R.I., and
 * THREE.Color.set logs a warning for anything it cannot parse. Setting one
 * unconditionally per frame turns a single typo into sixty console lines a
 * second, which drowns everything else out during a demo.
 */
type Tint = { key: string; color: THREE.Color }

function aim(tint: Tint, css: string): THREE.Color {
  if (tint.key !== css) {
    tint.key = css
    tint.color.set(css)
  }
  return tint.color
}

const STYLE_INDEX = { ring: 0, sphere: 1, wire: 2 } as const

function Rig({ surface, onFocus, overview, navigating }: { surface: boolean; surfaceRef: RefObject<THREE.Mesh | null>; onFocus: (point: THREE.Vector3) => void; overview: number; navigating: boolean }) {
  const drive = useMemo<Drive>(
    () => ({
      phase: 'offline',
      color: new THREE.Color(phaseColor.offline),
      level: 0,
      spin: spinFor.offline,
      amp: AMP_CALM,
      open: 0,
      reactor: {
        color: new THREE.Color(phaseColor.offline),
        scale: 1,
        intensity: 1,
        spin: 1,
        style: STYLE_INDEX.ring,
        visible: true,
      },
    }),
    [],
  )
  const target = useMemo<Tint>(() => ({ key: '', color: new THREE.Color() }), [])
  const reactorTarget = useMemo<Tint>(
    () => ({ key: '', color: new THREE.Color() }),
    [],
  )

  useFrame((state, dt) => {
    // Read imperatively rather than subscribing — see the note on Drive.
    const { phase, level, ui } = useStore.getState()
    drive.phase = phase

    // accentFor owns the accent -> palette -> phase resolution order. The scene
    // asking the store for the answer rather than working it out again is what
    // keeps the orb and the HUD from ever disagreeing about the colour.
    const accent = accentFor(phase, ui)
    drive.color.lerp(aim(target, accent), Math.min(1, dt * 2.5))

    const r = ui.reactor
    drive.reactor.color.lerp(
      aim(reactorTarget, r.color ?? accent),
      Math.min(1, dt * 2.5),
    )
    // Smoothed rather than assigned, so "make it twice the size" grows into
    // place instead of snapping. The style is the exception: it is a mode, and
    // easing between two of them would drag the picture through the third.
    const k = Math.min(1, dt * 5)
    drive.reactor.scale += (r.scale - drive.reactor.scale) * k
    drive.reactor.intensity += (r.intensity - drive.reactor.intensity) * k
    drive.reactor.spin += (r.spin - drive.reactor.spin) * k
    drive.reactor.style = STYLE_INDEX[r.style] ?? STYLE_INDEX.ring
    drive.reactor.visible = r.visible

    drive.spin += (spinFor[phase] - drive.spin) * Math.min(1, dt * 2)
    drive.amp = phase === 'dormant' || phase === 'offline' ? AMP_CALM : AMP_LIVE
    // Held shut until the reactor is powered on, so the ring builds itself out
    // of the centre on the ignition click rather than simply appearing.
    drive.open = phase === 'offline' ? 0.28 : phase === 'boot' ? 0.7 : 1.6

    // Idle breathing so the orb is never completely still.
    const idle = phase === 'offline' ? 0.02 : phase === 'dormant' ? 0.05 : 0.12
    const breathe =
      (Math.sin(state.clock.elapsedTime * 0.9) * 0.5 + 0.5) * idle
    const want = Math.max(level, breathe)
    drive.level += (want - drive.level) * Math.min(1, dt * 9)

    // The camera is owned by the orbit navigator below. It makes the orb feel
    // like a planet you can approach, inspect and circle instead of a free-fly
    // camera that can easily roll into a confusing or glitchy angle.
  })

  // Nothing in here is lit: both the core and the dust are raw ShaderMaterials,
  // which do not read the light list. The scene therefore has no lights at all.
  //
  // The tilted gyro rings that used to sit here are gone. Steeply tilted arcs
  // crossing in front of a complete circle do not read as depth — they read as
  // scratches on the lens, and as broken circles in a design whose whole
  // subject is one unbroken one.
  return (
    <group visible={!surface}>
      <ambientLight intensity={1.4} />
      <directionalLight position={[3,4,5]} intensity={2.4} />
      <directionalLight position={[-3,-1,2]} intensity={.7} color="#91b9d4" />
      <NeuralCore drive={drive} onFocus={onFocus} overview={overview} navigating={navigating} />
      <Orbits />
    </group>
  )
}

function NeuralRenderQuality({ highDetail, navigating, report }: { highDetail: boolean; navigating: boolean; report: (dpr: number, label: string) => void }) {
  const { gl, size } = useThree()
  useEffect(() => {
    const context = gl.getContext()
    const maximum = Math.min(context.getParameter(context.MAX_TEXTURE_SIZE), context.getParameter(context.MAX_RENDERBUFFER_SIZE))
    const quality = neuralRenderQuality(size.width, size.height, window.devicePixelRatio || 1, maximum, highDetail, navigating)
    report(quality.dpr, `${quality.width} × ${quality.height}${navigating ? ' · smooth navigation' : quality.hardwareLimited ? ' · hardware limit' : ''}`)
  }, [gl, size.width, size.height, highDetail, navigating, report])
  return null
}

function NeuralNavigator({ controls, goal }: { controls: RefObject<any>; goal: RefObject<{ target: THREE.Vector3; position: THREE.Vector3 } | null> }) {
  useFrame(({ camera }, dt) => {
    const orbit = controls.current
    if (!orbit) return
    if (goal.current) {
      const blend = 1 - Math.exp(-Math.min(dt, .1) * 7)
      camera.position.lerp(goal.current.position, blend)
      orbit.target.lerp(goal.current.target, blend)
      if (camera.position.distanceTo(goal.current.position) < .0005 && orbit.target.distanceTo(goal.current.target) < .0005) {
        camera.position.copy(goal.current.position); orbit.target.copy(goal.current.target); goal.current = null
      }
      orbit.update()
    }
    Object.assign(orbit, neuralNavigationScale(camera.position.distanceTo(orbit.target)))
  })
  return null
}

export function Scene() {
  const [highDetail, setHighDetail] = useState(true)
  const [renderDpr, setRenderDpr] = useState(1)
  const [renderSize, setRenderSize] = useState('')
  const [navigationOpen, setNavigationOpen] = useState(false)
  const [navigating, setNavigating] = useState(false)
  const reportQuality = useCallback((dpr: number, label: string) => { setRenderDpr(dpr); setRenderSize(label) }, [])
  const controls = useRef<any>(null)
  const navigationTimer = useRef<number | null>(null)
  const navigationGoal = useRef<{ target: THREE.Vector3; position: THREE.Vector3 } | null>(null)
  const [overview, setOverview] = useState(0)
  const focusNeuron = useCallback((point: THREE.Vector3) => {
    const orbit = controls.current
    if (orbit) navigationGoal.current = neuralFocusPose(orbit.object.position, orbit.target, point)
  }, [])
  const returnToOverview = useCallback(() => {
    navigationGoal.current = { target: new THREE.Vector3(), position: new THREE.Vector3(0, 0, NEURAL_CAMERA.overviewDistance) }
    setOverview(value => value + 1)
  }, [])
  const surfaceMesh = useRef<THREE.Mesh>(null)
  const returnLocation = useRef<SurfaceDestination | null>(null)
  const [surface, setSurface] = useState<SurfaceDestination | null>(null)
  const [transitioning, setTransitioning] = useState(false)
  const [covered, setCovered] = useState(false)
  const busy = useRef(false)
  const timers = useRef(new Set<number>())
  useEffect(() => () => {
    timers.current.forEach(clearTimeout); timers.current.clear()
    if (navigationTimer.current !== null) clearTimeout(navigationTimer.current)
  }, [])
  const markNavigating = useCallback(() => {
    setNavigating(true)
    if (navigationTimer.current !== null) clearTimeout(navigationTimer.current)
    navigationTimer.current = window.setTimeout(() => { navigationTimer.current = null; setNavigating(false) }, 360)
  }, [])
  const travel = useCallback((destination: SurfaceDestination | null) => {
    if (busy.current) return
    busy.current = true
    if (destination) returnLocation.current = { ...destination }
    const later = (callback: () => void, delay: number) => {
      const timer = window.setTimeout(() => { timers.current.delete(timer); callback() }, delay)
      timers.current.add(timer)
    }
    setTransitioning(true)
    setCovered(true)
    later(() => {
      setSurface(destination)
      later(() => setCovered(false), 180)
      later(() => { busy.current = false; setTransitioning(false) }, 700)
    }, 450)
  }, [])
  const leaveSurface = useCallback(() => travel(null), [travel])
  const updateLocation = useCallback((location: SurfaceDestination) => { returnLocation.current = location }, [])
  return (
    <>
    <Canvas
      className="scene"
      frameloop={surface ? 'never' : 'always'}
      camera={{ position: [0, 0, NEURAL_CAMERA.overviewDistance], fov: 45, near: NEURAL_CAMERA.near, far: NEURAL_CAMERA.far }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      dpr={renderDpr}
      onCreated={({ gl }) => {
        // Under GPU pressure (a screen recorder plus many tabs) the browser can
        // drop the WebGL context. Without a handler the canvas goes black for
        // good. Calling preventDefault on the loss lets the browser restore the
        // context, and three re-uploads its resources on the restore event, so
        // the reactor comes back instead of dying.
        const canvas = gl.domElement
        canvas.addEventListener(
          'webglcontextlost',
          (e) => {
            e.preventDefault()
            console.warn('[nori] WebGL context lost; awaiting restore')
          },
          false,
        )
        canvas.addEventListener('webglcontextrestored', () => {
          console.info('[nori] WebGL context restored')
        })
      }}
    >
      <Rig surface={surface !== null} surfaceRef={surfaceMesh} onFocus={focusNeuron} overview={overview} navigating={navigating} />
      
      <OrbitControls
        ref={controls}
        makeDefault
        enabled={!surface && !transitioning}
        enableDamping
        dampingFactor={0.075}
        enablePan
        panSpeed={0.42}
        rotateSpeed={0.46}
        zoomSpeed={0.72}
        minDistance={NEURAL_CAMERA.minimumDistance}
        maxDistance={NEURAL_CAMERA.maximumDistance}
        minPolarAngle={0.08}
        maxPolarAngle={Math.PI - 0.08}
        zoomToCursor
        onChange={markNavigating}
        onStart={() => { navigationGoal.current = null }}
      />
      <NeuralNavigator controls={controls} goal={navigationGoal} />
      <NeuralRenderQuality highDetail={highDetail} navigating={navigating} report={reportQuality} />
    </Canvas>
    {surface && <Suspense fallback={<section className="earth-surface" aria-label="Loading Earth surface"><p role="status">Loading Earth navigation…</p><button onClick={leaveSurface}>Return to orbit</button></section>}><CesiumSurface destination={surface} onCenterChange={updateLocation} onExit={leaveSurface} /></Suspense>}
    <div className={`surface-travel-cover${covered ? ' is-covered' : ''}`} aria-hidden="true" />
    {!surface && <aside className="surface-navigation" aria-label="Surface navigation" onMouseEnter={() => setNavigationOpen(true)} onMouseLeave={() => setNavigationOpen(false)}>
      {navigationOpen && <>
      <span className="surface-navigation-hint">Scroll into the brain · Double-click a neuron to approach · Right-drag to move</span><button aria-pressed={highDetail} onClick={() => setHighDetail(value => !value)}>4K detail: {highDetail ? 'on' : 'off'}</button><span>{renderSize}</span><button onClick={returnToOverview}>Return to brain overview</button>
      </>}
    </aside>}

    </>
  )
}
