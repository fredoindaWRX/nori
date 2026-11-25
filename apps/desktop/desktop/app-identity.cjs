// Report the running process, never a release-selection pointer or credentials.
function appIdentity({ executable, suiteRoot, stateRoot, packaged, version, runtime }) {
  const match = executable.replaceAll('\\', '/').match(/\/native-desktop-([^/]+)\/win-unpacked\/Nori\.exe$/i)
  return {
    executable, suiteRoot, stateRoot, version,
    build: match ? match[1] : packaged ? 'Packaged build (label unavailable)' : 'Development source',
    runtime: runtime === 'norllama' ? 'NorLlama · native runtime' : 'Ollama rollback · legacy runtime',
    packaged: Boolean(packaged),
  }
}
module.exports = { appIdentity }
