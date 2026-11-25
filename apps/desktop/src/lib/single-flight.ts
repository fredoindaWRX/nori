/** Coalesce overlapping startup attempts that own an exclusive device. */
export function createSingleFlight<T>() {
  let pending: Promise<T> | null = null
  return function run(start: () => Promise<T>): Promise<T> {
    if (pending) return pending
    const attempt = Promise.resolve().then(start)
    pending = attempt
    void attempt.finally(() => {
      if (pending === attempt) pending = null
    }).catch(() => { /* The original caller receives the startup error. */ })
    return attempt
  }
}
