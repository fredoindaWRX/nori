import { useEffect, useState } from 'react'
import './astral-detail.css'

// Decorative, deterministic star field. No inference, sensor access, timers,
// WebGL context or per-frame React updates are involved.
const stars = Array.from({ length: 2600 }, (_, i) => {
  const noise = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }
  const radius = 7 + Math.sqrt(noise(i + 1)) * 207
  const arm = i % 4
  const angle = arm * Math.PI / 2 + radius * .035 + (noise(i + 600) - .5) * (.24 + radius * .0018)
  return { x: 240 + Math.cos(angle) * radius, y: 240 + Math.sin(angle) * radius * .72,
    r: i % 151 === 0 ? 1.95 : .18 + noise(i + 1100) * .82,
    opacity: .2 + noise(i + 1600) * .75,
    color: i % 23 === 0 ? '#f7bd9b' : i % 5 === 0 ? '#8ce9ee' : '#e5f2ff' }
})
const glints = stars.filter((_, i) => i % 151 === 0)

export function NoriAstral() {
  const [hidden, setHidden] = useState(document.hidden)
  useEffect(() => {
    const update = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return <div className={`nori-astral${hidden ? ' nori-astral-paused' : ''}`} aria-hidden="true">
    <div className="nori-astral-halo nori-astral-halo-detailed" />
    <svg viewBox="0 0 480 480" focusable="false">
      <defs><radialGradient id="nori-astral-core"><stop stopColor="#f8ffff" stopOpacity=".65" /><stop offset=".18" stopColor="#a9dffc" stopOpacity=".22" /><stop offset="1" stopColor="#18374f" stopOpacity="0" /></radialGradient></defs>
      <g className="nori-astral-orbit-detailed">
        <circle cx="240" cy="240" r="80" fill="url(#nori-astral-core)" />
        {stars.map((star, i) => <circle key={i} cx={star.x} cy={star.y} r={star.r} fill={star.color} opacity={star.opacity} />)}
        {glints.map((star, i) => <path key={`glint-${i}`} d={`M${star.x - 2.6} ${star.y}h5.2m-2.6 -2.6v5.2`} stroke={star.color} strokeWidth=".36" opacity={star.opacity * .62} />)}
      </g>
      <circle cx="240" cy="240" r="3.4" fill="#f5ffff" opacity=".92" />
      <path d="M240 217v46m-23-23h46" stroke="#b5fff0" strokeWidth=".6" opacity=".5" />
    </svg>
  </div>
}
