type EarthClock<T> = { currentTime: T; shouldAnimate: boolean; multiplier: number }
type Events = { addEventListener: (name: string, callback: () => void) => void; removeEventListener: (name: string, callback: () => void) => void }

export function keepEarthClockCurrent<T>(clock: EarthClock<T>, now: () => T, redraw: () => void, events: Events,
  schedule: (callback: () => void, ms: number) => ReturnType<typeof setInterval> = setInterval,
  cancel: (timer: ReturnType<typeof setInterval>) => void = clearInterval) {
  const sync = () => { clock.currentTime = now(); clock.shouldAnimate = true; clock.multiplier = 1; redraw() }
  sync()
  const timer = schedule(sync, 60000)
  events.addEventListener('visibilitychange', sync)
  return () => { cancel(timer); events.removeEventListener('visibilitychange', sync) }
}
