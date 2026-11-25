/** Screen-space geometric error, not a promise of source imagery resolution. */
export function earthTileError(height: number): number {
  if (!Number.isFinite(height) || height < 0) return 8
  if (height <= 10000) return 2
  if (height >= 100000) return 8
  return 2 + 6 * (height - 10000) / 90000
}
