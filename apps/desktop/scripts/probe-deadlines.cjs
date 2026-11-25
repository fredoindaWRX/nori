// Packaged cold start may use the full NorLlama load deadline; reserve time
// afterward for the original Electron process and owned workers to drain.
module.exports = Object.freeze({
  readinessMs: 120_000,
  totalMs: 180_000,
  cleanupMs: 40_000,
})
