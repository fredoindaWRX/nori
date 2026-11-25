/** Pure visual helpers so region emphasis and pulse travel are testable. */
export function regionHighlight(region: string, highlighted: string | null): number {
  if (!highlighted) return 1
  return region === highlighted ? 2.15 : 0.13
}

function wrappedDistance(a: number, b: number): number {
  const difference = Math.abs(a - b) % 1
  return Math.min(difference, 1 - difference)
}

/** Two bright sparks move in opposite directions on an active local fiber. */
export function bidirectionalPulse(progress: number, seconds: number, phase: number, energy: number): number {
  if (![progress, seconds, phase, energy].every(Number.isFinite) || energy <= 0) return 0
  const forwardCenter = ((seconds * .48 + phase) % 1 + 1) % 1
  const reverseCenter = (1 - forwardCenter) % 1
  const forward = Math.exp(-Math.pow(wrappedDistance(progress, forwardCenter) / .035, 2))
  const reverse = Math.exp(-Math.pow(wrappedDistance(progress, reverseCenter) / .035, 2))
  return Math.max(forward, reverse) * Math.min(1, energy) * 1.5
}

/** Sparse UI firing for observed functional-region activity, not model internals. */
export function sparseNeuralPulse(index: number, seconds: number, energy: number): number {
  if (!Number.isSafeInteger(index) || index < 0 || !Number.isFinite(seconds)
    || !Number.isFinite(energy) || energy <= 0) return 0
  const hash = (value: number) => {
    const sample = Math.sin(value * 12.9898 + 78.233) * 43758.5453
    return sample - Math.floor(sample)
  }
  // Keep only a stable minority of cells eligible, then pulse them at
  // different phases so a busy region never appears uniformly illuminated.
  if (hash(index + 1) > .14) return 0
  const pulse = Math.max(0, Math.sin(seconds * 3.2 + hash(index + 9) * Math.PI * 2))
  return Math.pow(pulse, 12) * Math.min(1, energy)
}

const SOLAR_SPECTRUM: readonly (readonly [number, number, number])[] = [
  [.12, .27, 1], [.02, .91, 1], [.43, .2, 1], [1, .13, .5], [1, .31, .055], [1, .88, .34],
]

/** Electric blue through ultraviolet, coral and gold for active plasma sparks. */
export function solarFlareColor(progress: number): readonly [number, number, number] {
  const t = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) * (SOLAR_SPECTRUM.length - 1) : 0
  const left = Math.floor(t), right = Math.min(SOLAR_SPECTRUM.length - 1, left + 1), blend = t - left
  return SOLAR_SPECTRUM[left].map((value, channel) => value + (SOLAR_SPECTRUM[right][channel] - value) * blend) as [number, number, number]
}
