// Free-memory and free-space figures in a reply must match what check_pc
// measured in the same turn. The host does not rewrite the reply; when a
// stated free figure matches no measurement it appends the measured values.

const round = value => Math.round(value * 10) / 10

/** Free/total figures (GB) from one successful check_pc result. */
export function measuredPcFigures(result) {
  let value
  try { value = typeof result === 'string' ? JSON.parse(result) : result } catch { return [] }
  if (!value || typeof value !== 'object') return []
  const figures = []
  for (const gpu of Array.isArray(value.gpus) ? value.gpus : []) {
    const total = Number(gpu?.memory_total_mb), used = Number(gpu?.memory_used_mb)
    const free = Number.isFinite(Number(gpu?.memory_free_mb)) ? Number(gpu.memory_free_mb) : total - used
    if (Number.isFinite(free) && Number.isFinite(total) && total > 0) {
      figures.push({ label: `GPU ${String(gpu.name || '').slice(0, 60)} VRAM`.replace(/\s+/g, ' '), freeGb: round(free / 1024), totalGb: round(total / 1024) })
    }
  }
  if (Number.isFinite(value.memory_free_gb) && Number.isFinite(value.memory_total_gb)) {
    figures.push({ label: 'RAM', freeGb: value.memory_free_gb, totalGb: value.memory_total_gb })
  }
  for (const disk of [...(Array.isArray(value.disks) ? value.disks : []), ...(Array.isArray(value.storage) ? value.storage : [])]) {
    if (Number.isFinite(disk?.free_gb) && Number.isFinite(disk?.size_gb)) figures.push({ label: `drive ${String(disk.drive || '').slice(0, 8)}`, freeGb: disk.free_gb, totalGb: disk.size_gb })
  }
  return figures
}

const UNIT = { tb: 1024, tib: 1024, gb: 1, gib: 1, mb: 1 / 1024, mib: 1 / 1024 }
// "9.9 GB of VRAM free", "just under 2 GB left"; requirements ("needs 16 GB free") are not claims about this PC.
const CLAIM = /(\d{1,6}(?:[.,]\d{1,3})?)\s*(TB|TiB|GB|GiB|MB|MiB)\b([^.\n;:!?]{0,32})/gi
const FREE_WORD = /\b(?:free|available|left|remaining|unused|spare)\b/i
const REQUIREMENT = /\b(?:need|needs|needed|require|requires|required|take|takes|using|uses|use|in use|occupied|consum\w*)\b[^.\n]{0,24}$/i

/** Stated free figures that match no measurement, as text like "9.9 GB". */
export function unsupportedFreeFigures(text, figures) {
  if (!figures.length) return []
  const plain = String(text ?? '').replace(/[*_`]/g, '')
  const wrong = []
  for (const match of plain.matchAll(CLAIM)) {
    const after = match[3].split(/\b(?:and|but|with|while)\b/i)[0]
    if (!FREE_WORD.test(after) || /\b(?:in use|used)\b/i.test(after)) continue
    if (REQUIREMENT.test(plain.slice(Math.max(0, match.index - 40), match.index))) continue
    const gb = Number(match[1].replace(',', '.')) * UNIT[match[2].toLowerCase()]
    if (!figures.some(figure => Math.abs(figure.freeGb - gb) <= Math.max(0.25, figure.freeGb * 0.12))) wrong.push(`${match[1]} ${match[2]}`)
  }
  return [...new Set(wrong)]
}

/** Host note appended to a reply whose free figures contradict this turn's check_pc results; '' otherwise. */
export function pcFigureCorrection(text, figures) {
  const wrong = unsupportedFreeFigures(text, figures)
  if (!wrong.length) return ''
  const measured = figures.slice(0, 6).map(figure => `${figure.label}: ${figure.freeGb} GB free of ${figure.totalGb} GB`).join('; ')
  return `\n\n[Nori host check: the free figure${wrong.length === 1 ? '' : 's'} ${wrong.join(', ')} above ${wrong.length === 1 ? 'does' : 'do'} not match what check_pc measured in this turn. Measured: ${measured}. Any conclusion above that relied on ${wrong.length === 1 ? 'that figure' : 'those figures'} should be rechecked against these numbers.]`
}
