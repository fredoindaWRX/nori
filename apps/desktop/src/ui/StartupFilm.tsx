import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { entityFragment, entityVertex } from './entityIntroShader'

/** Continuous facial rig: textures provide skin/eye materials, never timed frames. */
export function StartupFilm({ onLanding, previewTime }: { onLanding: () => void; previewTime?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const landing = useRef(onLanding)
  landing.current = onLanding
  useEffect(() => {
    const node = canvas.current
    if (!node) return
    let cancelled = false
    let frame = 0
    let landed = false
    let ended = false
    let started = 0
    let renderer: THREE.WebGLRenderer | undefined
    let material: THREE.ShaderMaterial | undefined
    const textures: THREE.Texture[] = []
    const geometry = new THREE.PlaneGeometry(2, 2)
    const scene = new THREE.Scene()
    const camera = new THREE.Camera()
    const finish = () => {
      if (ended || cancelled || previewTime !== undefined) return
      ended = true
      window.dispatchEvent(new Event('nori-entrance-ended'))
    }
    const fallback = window.setTimeout(finish, 18000)
    const resize = () => {
      if (!renderer || !material) return
      const { width, height } = node.getBoundingClientRect()
      // Target 4K detail at the canvas aspect ratio, but respect the GPU's
      // texture limit and avoid oversampling an already-large display.
      const context = renderer.getContext()
      const limit = Math.min(context.getParameter(context.MAX_TEXTURE_SIZE), context.getParameter(context.MAX_RENDERBUFFER_SIZE))
      const target = Math.min(3840 / Math.max(1, width), 2160 / Math.max(1, height))
      renderer.setPixelRatio(Math.max(1, Math.min(target, limit / Math.max(1, width), limit / Math.max(1, height))))
      renderer.setSize(Math.max(1, width), Math.max(1, height), false)
      material.uniforms.uAspect.value = width / Math.max(1, height)
      renderer.getDrawingBufferSize(material.uniforms.uResolution.value)
      if (previewTime !== undefined) renderer.render(scene, camera)
    }
    const observer = new ResizeObserver(resize)
    observer.observe(node)
    const animate = (now: number) => {
      if (cancelled || !renderer || !material) return
      if (!started) started = now
      const seconds = previewTime ?? (now - started) / 1000
      material.uniforms.uTime.value = seconds
      renderer.render(scene, camera)
      node.dataset.frameReady = 'true'
      if (previewTime === undefined && seconds >= 10.8 && !landed) { landed = true; landing.current() }
      if (seconds >= 13) finish()
      if (!ended && previewTime === undefined) frame = requestAnimationFrame(animate)
    }
    async function setup() {
      try {
        renderer = new THREE.WebGLRenderer({ canvas: node!, antialias: false, alpha: false, preserveDrawingBuffer: previewTime !== undefined, powerPreference: 'high-performance' })
        const loader = new THREE.TextureLoader()
        const images = await Promise.all([
          loader.loadAsync('/images/nori-entity-startup.png'),
          loader.loadAsync('/images/nori-entity-eye-closed.png'),
        ])
        textures.push(...images)
        if (cancelled) { textures.forEach((texture) => texture.dispose()); return }
        textures.forEach((texture) => {
          texture.minFilter = THREE.LinearFilter
          texture.magFilter = THREE.LinearFilter
          texture.generateMipmaps = false
        })
        material = new THREE.ShaderMaterial({
          vertexShader: entityVertex, fragmentShader: entityFragment,
          uniforms: { uOpen: { value: textures[0] }, uSkin: { value: textures[1] }, uTime: { value: 0 }, uAspect: { value: 16 / 9 }, uResolution: { value: new THREE.Vector2(1920, 1080) } },
          depthTest: false, depthWrite: false,
        })
        scene.add(new THREE.Mesh(geometry, material))
        resize()
        frame = requestAnimationFrame(animate)
      } catch (error) {
        console.error('[nori] Entity introduction could not render', error)
        finish()
      }
    }
    void setup()
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      clearTimeout(fallback)
      observer.disconnect()
      textures.forEach((texture) => texture.dispose())
      material?.dispose()
      geometry.dispose()
      renderer?.dispose()
    }
  }, [previewTime])
  return <canvas ref={canvas} className="startup-film" role="img" aria-label="Nori awakens and blinks; the camera travels into the moving galaxy within her eye" />
}
