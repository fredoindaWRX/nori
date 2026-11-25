import { useEffect, useRef, useState } from 'react'
import type { Viewer } from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'
import { EarthSurface } from './EarthSurface'
import { keepEarthClockCurrent } from './earth-clock'
import { earthTileError } from './earth-detail'
import { providerFailureGate } from './earth-provider-policy'
import { parseEarthDestination } from './earth-coordinates'
import type { SurfaceDestination } from './StreetArrival'

const TOKEN_KEY = 'nori.cesium.ion-token'
function savedToken() { try { return localStorage.getItem(TOKEN_KEY) || '' } catch { return '' } }

/** Cesium owns the real Earth navigation; Nori's purple shell is only the
 * outer presentation. All camera destinations are geographic coordinates. */
export function CesiumSurface({ destination, onCenterChange, onExit }: {
  destination: SurfaceDestination; onCenterChange: (location: SurfaceDestination) => void; onExit: () => void;
}) {
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<Viewer | null>(null)
  const api = useRef<typeof import('cesium') | null>(null)
  const detailTiles = useRef<import('cesium').Cesium3DTileset | null>(null)
  const current = useRef(destination)
  const update = useRef(onCenterChange)
  update.current = onCenterChange
  const [location, setLocation] = useState(destination)
  const [height, setHeight] = useState(2000000)
  const [status, setStatus] = useState('Loading the Earth globe…')
  const [connection, setConnection] = useState<'osm' | 'esri' | 'ion'>('osm')
  const [terrainName, setTerrainName] = useState('ellipsoid')
  const [liveLight, setLiveLight] = useState(true)
  const [terrainNotice, setTerrainNotice] = useState('')
  const baseProvider = useRef<'esri' | 'osm'>('osm')
  const [settings, setSettings] = useState(false)
  const [navigation, setNavigation] = useState(false)
  const [token, setToken] = useState(savedToken)
  const [tokenInput, setTokenInput] = useState(savedToken)
  const [flat, setFlat] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [santa, setSanta] = useState(false)
  useEffect(() => {
    const v = viewer.current, C = api.current
    if (!ready || !santa || !v || !C) return
    const start = performance.now()
    const origin = { ...current.current }
    const position = (seconds: number) => C.Cartesian3.fromDegrees(
      origin.longitude + seconds * .48,
      Math.max(-75, Math.min(75, origin.latitude + 9 * Math.sin(seconds / 36))),
      18000 + 1200 * Math.sin(seconds / 3),
    )
    const visitor = v.entities.add({
      name: 'Santa · fictional holiday flight',
      position: new C.CallbackPositionProperty(() => position((performance.now() - start) / 1000), false),
      billboard: { image: '/images/visitors/santa.png', width: 210, height: 140 },
      label: { text: 'SANTA · HOLIDAY ROUTE', font: '12px sans-serif', pixelOffset: new C.Cartesian2(0, 77), fillColor: C.Color.WHITE, showBackground: true },
    })
    const trail = v.entities.add({ polyline: {
      positions: new C.CallbackProperty(() => {
        const seconds = (performance.now() - start) / 1000
        return Array.from({ length: 40 }, (_, i) => position(Math.max(0, seconds - (39-i) * 1.5)))
      }, false), width: 3, material: new C.PolylineGlowMaterialProperty({ color: C.Color.GOLD, glowPower: .25 }),
    } })
    v.camera.flyTo({ destination: C.Cartesian3.fromDegrees(origin.longitude, origin.latitude, 1200000), duration: 1.5 })
    const redraw = setInterval(() => v.scene.requestRender(), 33)
    return () => { clearInterval(redraw); if (!v.isDestroyed()) { v.entities.remove(visitor); v.entities.remove(trail); v.scene.requestRender() } }
  }, [ready, santa, flat])
  useEffect(() => {
    if (flat || !host.current) return
    let cancelled = false
    let instance: Viewer | undefined
    let stopClock: (() => void) | undefined
    const observer = new ResizeObserver(() => { instance?.resize(); instance?.scene.requestRender() })
    observer.observe(host.current)
    async function setup() {
      try {
        ;(window as Window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = '/cesium/'
        const C = await import('cesium')
        if (cancelled || !host.current) return
        api.current = C
        // Explicitly disable Cesium's demonstration token. No account-backed
        // request is made until this user connects their own access token.
        C.Ion.defaultAccessToken = ''
        instance = new C.Viewer(host.current, {
          baseLayer: false, terrainProvider: new C.EllipsoidTerrainProvider(),
          animation: false, timeline: false, geocoder: false, homeButton: false,
          fullscreenButton: false, baseLayerPicker: false, sceneModePicker: false,
          navigationHelpButton: false, selectionIndicator: false, infoBox: false,
          requestRenderMode: true, maximumRenderTimeChange: Infinity,
          contextOptions: { webgl: { alpha: false, antialias: true } },
        })
        viewer.current = instance
        instance.imageryLayers.addImageryProvider(new C.OpenStreetMapImageryProvider({
          url: 'https://tile.openstreetmap.org/', maximumLevel: 19,
          credit: new C.Credit('© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>', true),
        }))
        instance.scene.globe.baseColor = C.Color.fromCssColorString('#07101d')
        instance.scene.globe.maximumScreenSpaceError = 1.5
        instance.scene.screenSpaceCameraController.minimumZoomDistance = 3
        instance.scene.screenSpaceCameraController.maximumZoomDistance = 25000000
        instance.scene.screenSpaceCameraController.enableCollisionDetection = true
        instance.scene.globe.enableLighting = true
        const clockViewer = instance
        stopClock = keepEarthClockCurrent(instance.clock, () => C.JulianDate.now(), () => clockViewer.scene.requestRender(), document)
        instance.scene.maximumRenderTimeChange = 60
        instance.resolutionScale = 1
        instance.useBrowserRecommendedResolution = false
        instance.camera.percentageChanged = .015
        instance.camera.setView({ destination: C.Cartesian3.fromDegrees(current.current.longitude, current.current.latitude, 2000000) })
        instance.camera.changed.addEventListener(() => {
          if (!instance || instance.isDestroyed()) return
          const ray = instance.camera.getPickRay(new C.Cartesian2(instance.canvas.clientWidth / 2, instance.canvas.clientHeight / 2))
          const screenCenter = new C.Cartesian2(instance.canvas.clientWidth / 2, instance.canvas.clientHeight / 2)
          const tilePoint = !instance.scene.globe.show && instance.scene.pickPositionSupported ? instance.scene.pickPosition(screenCenter) : undefined
          const point = tilePoint || (ray && instance.scene.globe.pick(ray, instance.scene))
          const cartographic = point ? C.Cartographic.fromCartesian(point) : instance.camera.positionCartographic
          const next = { latitude: C.Math.toDegrees(cartographic.latitude), longitude: C.Math.toDegrees(cartographic.longitude) }
          current.current = next; update.current(next); setLocation(next)
          setHeight(instance.camera.positionCartographic.height)
          if (detailTiles.current && !detailTiles.current.isDestroyed()) detailTiles.current.maximumScreenSpaceError = earthTileError(instance.camera.positionCartographic.height)
        })
        instance.scene.globe.tileLoadProgressEvent.addEventListener((remaining: number) => {
          if (!cancelled) setStatus(remaining ? 'Loading geographic detail…' : 'Drag to explore · Scroll to zoom · Middle-drag to tilt')
        })
        instance.camera.flyTo({ destination: C.Cartesian3.fromDegrees(current.current.longitude, current.current.latitude, 65000), duration: 2.4 })
        setReady(true); setError('')
        // God's Eye View's keyless provider ladder. Third-party tiles are
        // fetched only for the visible view; attribution remains on screen.
        const live = instance
        void C.ArcGisMapServerImageryProvider.fromUrl('https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer', {
          enablePickFeatures: false,
          credit: new C.Credit('Powered by <a href="https://www.esri.com" target="_blank">Esri</a> — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community', true),
        }).then(imagery => {
          if (cancelled || live.isDestroyed()) return
          const imageryFallback = providerFailureGate(8)
          imagery.errorEvent.addEventListener(() => {
            if (cancelled || live.isDestroyed()) return
            if (!imageryFallback(live.imageryLayers.length === 1 &&
              live.imageryLayers.get(0).imageryProvider === imagery)) return
            live.imageryLayers.removeAll()
            live.imageryLayers.addImageryProvider(new C.OpenStreetMapImageryProvider({
              url: 'https://tile.openstreetmap.org/', maximumLevel: 19,
              credit: new C.Credit('© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>', true),
            }))
            baseProvider.current = 'osm'
            setConnection(previous => previous === 'ion' ? previous : 'osm')
            live.scene.requestRender()
          })
          live.imageryLayers.removeAll(); live.imageryLayers.addImageryProvider(imagery)
          baseProvider.current = 'esri'
          setConnection(previous => previous === 'ion' ? previous : 'esri'); live.scene.requestRender()
        }).catch(() => { if (!cancelled) setStatus('Satellite unavailable — showing OpenStreetMap') })
        void C.CesiumTerrainProvider.fromUrl('https://terrain.reearth.land/cesium-mesh/ellipsoid', {
          requestVertexNormals: true, requestWaterMask: false,
          credit: new C.Credit('<a href="https://terrain.reearth.land" target="_blank">Re:Earth Terrain</a> · <a href="https://mapterhorn.com" target="_blank">Mapterhorn</a> (CC BY 4.0)', true),
        }).then(terrain => {
          if (cancelled || live.isDestroyed()) return
          const terrainFallback = providerFailureGate(3)
          terrain.errorEvent.addEventListener(() => {
            if (cancelled || live.isDestroyed() || !terrainFallback(live.terrainProvider === terrain)) return
            // Missing/CORS-blocked terrain tiles must never strand navigation.
            live.terrainProvider = new C.EllipsoidTerrainProvider()
            setTerrainName('ellipsoid'); setTerrainNotice('Terrain service unavailable — satellite remains usable.')
            live.scene.requestRender()
          })
          live.terrainProvider = terrain; setTerrainName('Re:Earth'); setTerrainNotice(''); live.scene.requestRender()
        }).catch(() => { if (!cancelled) { setTerrainName('ellipsoid'); setTerrainNotice('Terrain service unavailable — satellite remains usable.') } })
      } catch (failure) { if (!cancelled) setError(failure instanceof Error ? failure.message : 'The globe could not be loaded.') }
    }
    void setup()
    return () => { cancelled = true; stopClock?.(); observer.disconnect(); setReady(false); instance?.destroy(); viewer.current = null }
  }, [flat])
  useEffect(() => {
    const instance = viewer.current, C = api.current
    if (!ready || !instance || !C) return
    let cancelled = false
    if (!token) return
    let tileset: import('cesium').Cesium3DTileset | undefined
    setStatus('Connecting optional photorealistic 3D buildings…')
    void (async () => {
      try {
        const resource = await C.IonResource.fromAssetId(2275207, { accessToken: token })
        const loaded = await C.Cesium3DTileset.fromUrl(resource, {
          maximumScreenSpaceError: earthTileError(instance.camera.positionCartographic.height), cacheBytes: 384 * 1024 * 1024,
          maximumCacheOverflowBytes: 256 * 1024 * 1024, enableCollision: true,
        })
        if (cancelled || instance.isDestroyed()) { loaded.destroy(); return }
        tileset = loaded
        detailTiles.current = loaded
        instance.scene.primitives.add(tileset)
        instance.scene.globe.show = false
        instance.scene.requestRender()
        setConnection('ion'); setError(''); setStatus('Google photorealistic 3D connected · Coverage varies by place')
      } catch {
        if (!cancelled) setError('Photorealistic 3D is unavailable with this token. Enable Google Photorealistic 3D Tiles in your ion account. The keyless Earth view remains available.')
      }
    })()
    return () => {
      cancelled = true
      if (detailTiles.current === tileset) detailTiles.current = null
      if (!instance.isDestroyed()) {
        if (tileset) instance.scene.primitives.remove(tileset)
        instance.scene.globe.show = true
        setConnection(baseProvider.current)
        instance.scene.requestRender()
      }
    }
  }, [ready, token])
  useEffect(() => {
    const instance = viewer.current
    if (ready && instance) { instance.scene.globe.enableLighting = liveLight; instance.scene.requestRender() }
  }, [liveLight, ready])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !(event.target instanceof HTMLInputElement)) onExit() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onExit])
  const connect = () => {
    const value = tokenInput.trim()
    if (!value) return
    try { localStorage.setItem(TOKEN_KEY, value) } catch { /* Session access still works. */ }
    setToken(value); setSettings(false)
  }
  const zoomBy = (direction: 1 | -1) => {
    const instance = viewer.current
    if (!instance) return
    const amount = Math.max(5, instance.camera.positionCartographic.height * .55)
    if (direction === 1) instance.camera.zoomIn(amount); else instance.camera.zoomOut(amount)
    instance.scene.requestRender()
  }
  const flatCenter = (next: SurfaceDestination) => { current.current = next; setLocation(next); update.current(next) }
  if (flat) return <>
    <EarthSurface destination={current.current} onCenterChange={flatCenter} onExit={onExit} />
    <button className="earth-back-to-globe" onClick={() => setFlat(false)}>3D Earth</button>
  </>
  return <section className="earth-surface cesium-earth" aria-label="Cesium real Earth globe" data-latitude={destination.latitude} data-longitude={destination.longitude} data-current-latitude={location.latitude} data-current-longitude={location.longitude} data-provider={connection} data-terrain={terrainName} data-height={height} data-ready={ready}>
    <div ref={host} className="earth-surface-map" />
    <div className="earth-surface-toolbar">
      <div><strong>EARTH · CESIUM</strong><span>{location.latitude.toFixed(5)}°, {location.longitude.toFixed(5)}° · {height >= 1000 ? `${(height / 1000).toFixed(1)} km` : `${Math.round(height)} m`}</span></div>
      <button aria-expanded={settings} onClick={() => { setSettings(!settings); setNavigation(false) }}>{connection === 'ion' ? 'Photorealistic 3D connected' : 'Optional 3D buildings'}</button>
      <button aria-expanded={navigation} onClick={() => { setNavigation(!navigation); setSettings(false) }}>Go to coordinates</button>
      <button className="earth-lighting" aria-pressed={liveLight} onClick={() => setLiveLight(!liveLight)}>{liveLight ? 'Lighting: real time' : 'Lighting: clear imagery'}</button>
      <button onClick={() => setFlat(true)}>Flat map</button>
      <button aria-pressed={santa} onClick={() => setSanta(!santa)}>{santa ? 'Santa: flying' : 'Santa route'}</button>
      <button className="earth-return" onClick={onExit}>Return to orbit ↗</button>
    </div>
    <div className="earth-zoom-controls"><button aria-label="Zoom in" onClick={() => zoomBy(1)}>+</button><button aria-label="Zoom out" onClick={() => zoomBy(-1)}>−</button></div>
    {navigation && <form className="earth-provider-settings" aria-label="Earth coordinate navigation" onSubmit={event => {
      event.preventDefault()
      const data=new FormData(event.currentTarget)
      const next=parseEarthDestination(String(data.get('latitude')??''),String(data.get('longitude')??''))
      const instance=viewer.current,C=api.current
      if(!next){setError('Enter latitude from −90 to 90 and longitude from −180 to 180.');return}
      if(!instance||!C||instance.isDestroyed())return
      current.current=next;setLocation(next);update.current(next);setError('');setNavigation(false)
      instance.camera.flyTo({destination:C.Cartesian3.fromDegrees(next.longitude,next.latitude,10000),duration:1.2})
      instance.scene.requestRender()
    }}>
      <strong>Navigate to a real Earth location</strong>
      <label>Latitude<input name="latitude" aria-label="Earth latitude" inputMode="decimal" defaultValue={location.latitude.toFixed(5)} /></label>
      <label>Longitude<input name="longitude" aria-label="Earth longitude" inputMode="decimal" defaultValue={location.longitude.toFixed(5)} /></label>
      <button type="submit">Go to location</button>
      <p>Imagery detail and 3D coverage vary by location. Coordinates are not a Street View guarantee.</p>
    </form>}
    {settings && <div className="earth-provider-settings">
      <strong>Connect your Cesium ion account</strong>
      <p>Satellite imagery and terrain work without a key. An authorized ion token can add Google Photorealistic 3D Tiles; enable that asset in your account. Provider quotas and terms apply.</p>
      <label>Cesium ion access token<input type="password" autoComplete="off" value={tokenInput} onChange={event => setTokenInput(event.target.value)} placeholder="Paste your access token" /></label>
      <button onClick={connect} disabled={!tokenInput.trim()}>Connect</button>
      {token && <button onClick={() => { try { localStorage.removeItem(TOKEN_KEY) } catch { /* Session only. */ }; setToken(''); setTokenInput(''); setConnection(baseProvider.current); setError('') }}>Disconnect</button>}
      <p>The token is stored on this device. Use a restricted, read-only token.</p>
      <p>Street-level photos need an authorized Street View provider key and coverage at the selected place.</p>
    </div>}
    <div className="earth-surface-status" role="status">{error || `${terrainNotice ? `${terrainNotice} · ` : ''}${height < 150 ? 'Native imagery detail varies — this is not Street View.' : status}`}</div>
  </section>
}
