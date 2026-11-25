import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useStore } from '../store'
import { StartupFilm } from './StartupFilm'

/** A single cinematic opening selected by the user. No legacy boot panels, diagrams,
 * loading logs, or reactor graphics are layered over it. */
export function Boot() {
  const phase = useStore((s) => s.phase)
  const skipBoot = useStore((s) => s.skipBoot)
  const [landing, setLanding] = useState(false)

  // StartupFilm starts the reveal at 10.8 seconds and completes at 13 seconds.
  useEffect(() => {
    if (phase !== 'boot') {
      setLanding(false)
      return
    }
    setLanding(false)
  }, [phase])

  if (phase !== 'boot' || skipBoot) return null

  return (
    <motion.div
      className="boot boot-video-only"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.7 }}
    >
      <div className={landing ? 'boot-video is-landing' : 'boot-video'}>
        <StartupFilm onLanding={() => setLanding(true)} />
      </div>
      <div className={landing ? 'boot-video-vignette is-landing' : 'boot-video-vignette'} aria-hidden="true" />
    </motion.div>
  )
}
