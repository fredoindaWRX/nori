/** One fallback per provider lifetime; stale callbacks cannot count failures. */
export function providerFailureGate(limit: number): (active: boolean) => boolean {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid provider failure limit')
  let failures = 0, tripped = false
  return active => {
    if (!active || tripped) return false
    if (++failures < limit) return false
    tripped = true
    return true
  }
}
