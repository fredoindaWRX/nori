function captureSize(size, maxWidth = 1280, maxHeight = 720) {
  const width = Number(size.width)
  const height = Number(size.height)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Invalid display dimensions')
  }
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
function displayImages(displays, sources) {
  return displays.map((display, index) => {
    const source = sources.find(candidate => String(candidate.display_id) === String(display.id))
    if (!source || source.thumbnail.isEmpty()) throw new Error(`Screen ${index + 1} could not be captured; all-screen monitoring is incomplete.`)
    const image = source.thumbnail.resize({ ...captureSize(display.size), quality: 'good' }).toDataURL()
    if (!image) throw new Error(`Screen ${index + 1} returned an empty capture.`)
    return { id: `screen-${index + 1}`, image }
  })
}
module.exports = { captureSize, displayImages }
