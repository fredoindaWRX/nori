import { useEffect, useRef } from 'react'

/** Enter the same Nori workspace without an introduction or audio. */
export function Ignition({ onSkip }: { onStart: () => void; onSkip: () => void }) {
  const open = useRef(onSkip)
  open.current = onSkip
  useEffect(() => { open.current() }, [])
  return null
}
