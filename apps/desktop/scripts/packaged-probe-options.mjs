// Candidate names only: never accept arbitrary executable/profile/output paths.
export function packagedProbeOptions(argumentsList, kind) {
  if (!['launcher', 'integrity'].includes(kind)) throw Error('Unsupported packaged probe kind')
  if (argumentsList.length === 0) return {
    candidate: 'launcher-cachebinding-20261005',
    evidence: kind === 'launcher' ? 'nori-cache-packaged-launcher-2026-10-05.json' : 'nori-cache-package-integrity-2026-10-05.json',
  }
  const match = argumentsList.length === 1 && /^--candidate=([a-z0-9][a-z0-9-]{0,63})$/.exec(argumentsList[0])
  if (!match) throw Error('Expected one safe --candidate= argument; no arbitrary paths permitted')
  return {candidate: match[1], evidence: `nori-packaged-${kind}-${match[1]}.json`}
}
