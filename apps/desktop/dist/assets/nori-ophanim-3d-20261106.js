// Nori's welcome emblem: a photoreal Ophanim, path-traced in Blender Cycles and played as a seamless
// transparent animated WebP loop. The CSS 3D Ophanim is built underneath as the fallback and is hidden once the
// video plays. Idempotent: an emblem that already holds them is left alone.
(() => {
  const LOOP = '/assets/nori-ophanim-20261106.webp'
  const POSTER = '/assets/nori-ophanim-20261106.png'
  const WHEELS = [
    { cls: 'oph-gold', axis: 'rotateY(0deg)', eyes: 12, radius: 48 },
    { cls: 'oph-teal', axis: 'rotateY(90deg)', eyes: 8, radius: 37 },
    { cls: 'oph-violet', axis: 'rotateX(90deg)', eyes: 8, radius: 37 },
  ]
  function fallback(host) {
    const body = document.createElement('div')
    body.className = 'ophanim3d'
    for (const wheel of WHEELS) {
      const axis = document.createElement('div')
      axis.className = 'oph-axis'
      axis.style.transform = wheel.axis
      const ring = document.createElement('div')
      ring.className = `oph-wheel ${wheel.cls}`
      for (let index = 0; index < wheel.eyes; index++) {
        const eye = document.createElement('i')
        eye.className = 'oph-eye'
        eye.style.transform = `rotate(${(360 / wheel.eyes) * index}deg) translateY(-${wheel.radius - 4}px)`
        ring.appendChild(eye)
      }
      axis.appendChild(ring)
      body.appendChild(axis)
    }
    const core = document.createElement('div')
    core.className = 'oph-core'
    host.append(body, core)
  }
  function build(host) {
    if (host.querySelector('.ophanim3d')) return
    fallback(host)
    const image = document.createElement('img')
    image.className = 'oph-video'
    image.alt = ''
    image.decoding = 'async'
    image.addEventListener('load', () => host.classList.add('oph-real'), { once: true })
    // Reduced motion: show the still render instead of the spinning loop.
    image.src = matchMedia('(prefers-reduced-motion: reduce)').matches ? POSTER : LOOP
    host.appendChild(image)
  }
  const scan = () => { for (const host of document.querySelectorAll('.workspace-emblem')) build(host) }
  const start = () => { scan(); new MutationObserver(scan).observe(document.body, { childList: true, subtree: true }) }
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true })
})()
