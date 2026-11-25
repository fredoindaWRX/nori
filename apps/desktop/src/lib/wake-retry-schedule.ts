type WakeTimer = ReturnType<typeof setTimeout>
type TimerFactory = (callback: () => void, delayMs: number) => WakeTimer
type TimerCancel = (timer: WakeTimer) => void
export type WakeStartupFailure = 'permission-denied' | 'unavailable' | 'transient'

/** Bounded-backoff retries for transient wake startup failures only. */
export function createWakeRetrySchedule({
  schedule = setTimeout,
  cancel = clearTimeout,
  delays = [2_000, 5_000, 15_000, 30_000],
}: {
  schedule?: TimerFactory
  cancel?: TimerCancel
  delays?: number[]
} = {}) {
  if (!Array.isArray(delays) || delays.length === 0 ||
      delays.some(delay => !Number.isInteger(delay) || delay < 1)) {
    throw new TypeError('wake retry delays must be positive integers')
  }
  let timer: WakeTimer | null = null
  let attempt = 0
  let stopped = false

  return {
    scheduleRetry(failure: WakeStartupFailure, run: () => void) {
      if (failure === 'permission-denied' || stopped || timer !== null) return false
      const delay = delays[Math.min(attempt, delays.length - 1)]
      attempt++
      timer = schedule(() => {
        timer = null
        if (!stopped) run()
      }, delay)
      return true
    },
    reset() {
      attempt = 0
    },
    stop() {
      stopped = true
      if (timer !== null) cancel(timer)
      timer = null
    },
  }
}
