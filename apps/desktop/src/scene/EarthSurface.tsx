import { useEffect, useRef, useState } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { SurfaceDestination } from './StreetArrival'

/** Real geographic tile navigation. Coordinate-preserving detail comes from
 * new source tiles at each zoom, never from stretching the orbital bitmap. */
export function EarthSurface({ destination, onCenterChange, onExit }: {
  destination: SurfaceDestination; onCenterChange: (location: SurfaceDestination) => void; onExit: () => void;
}) {
  const host = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  // Parent center updates are navigation feedback, not a request to recreate
  // the map on every pan. Capture only the entry destination for this mount.
  const entryDestination = useRef(destination)
  const [position, setPosition] = useState(destination)
  const [zoom, setZoom] = useState(6)
  const [loading, setLoading] = useState(true)
  const [tileError, setTileError] = useState(false)
  const update = useRef(onCenterChange)
  update.current = onCenterChange
  useEffect(() => {
    if (!host.current) return
    const container = host.current
    const entry = entryDestination.current
    const location: L.LatLngExpression = [Math.max(-85.0511, Math.min(85.0511, entry.latitude)), entry.longitude]
    const instance = L.map(container, { zoomControl: false, attributionControl: true, minZoom: 2, maxZoom: 19, zoomSnap: 1, wheelPxPerZoomLevel: 90, preferCanvas: true })
    map.current = instance
    instance.attributionControl.setPrefix(false)
    const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>', keepBuffer: 2,
    })
    for (const layer of [streets]) {
      layer.on('loading', () => { setLoading(true); setTileError(false) })
      layer.on('load', () => setLoading(false))
      layer.on('tileerror', () => setTileError(true))
    }
    streets.addTo(instance)
    instance.setView(location, 6, { animate: false })
    L.control.zoom({ position: 'topright' }).addTo(instance)
    L.control.scale({ position: 'bottomleft', imperial: true }).addTo(instance)
    const sync = () => {
      const center = instance.getCenter().wrap()
      const next = { latitude: center.lat, longitude: center.lng }
      setPosition(next); setZoom(instance.getZoom()); update.current(next)
    }
    instance.on('moveend zoomend', sync)
    sync()
    const observer = new ResizeObserver(() => instance.invalidateSize({ pan: false }))
    observer.observe(host.current)
    const initialFlight = window.setTimeout(() => instance.flyTo(location, 11, { duration: 2.4 }), 700)
    const stopInitial = () => { clearTimeout(initialFlight); instance.stop() }
    instance.once('mousedown', stopInitial)
    container.addEventListener('wheel', stopInitial, { once: true, passive: true })
    return () => {
      clearTimeout(initialFlight)
      container.removeEventListener('wheel', stopInitial)
      observer.disconnect(); instance.remove(); map.current = null
    }
  }, [])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onExit() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onExit])
  return <section className="earth-surface" aria-label="Explore real Earth imagery" data-latitude={destination.latitude} data-longitude={destination.longitude} data-current-latitude={position.latitude} data-current-longitude={position.longitude} data-zoom={zoom}>
    <div ref={host} className="earth-surface-map" />
    <div className="earth-surface-crosshair" aria-hidden="true" />
    <div className="earth-surface-toolbar">
      <div><strong>EARTH · SURFACE</strong><span>{position.latitude.toFixed(5)}°, {position.longitude.toFixed(5)}° · Zoom {zoom}</span></div>
      <div className="earth-surface-style"><button aria-pressed="true" disabled>Street map</button></div>
      <button className="earth-return" onClick={onExit}>Return to orbit ↗</button>
    </div>
    <div className="earth-surface-status" role="status">{tileError ? 'Some map tiles are unavailable here. Try zooming out.' : loading ? 'Loading Earth map…' : 'Drag to explore · Scroll to zoom · Street map, not satellite imagery'}</div>
  </section>
}
