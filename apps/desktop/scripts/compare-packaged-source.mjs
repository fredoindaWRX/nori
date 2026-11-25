import {lstatSync, readFileSync} from 'node:fs'
import {join} from 'node:path'
import {createHash} from 'node:crypto'

function sourcePath(path) {
  return typeof path === 'string'
    && /^(nori\/|runtime\/norllama\/|apps\/desktop\/(bridge|desktop)\/)/.test(path)
    && /\.(py|mjs|cjs|js|ts)$/.test(path)
    && !path.startsWith('nori/knights/architect/lib/')
    && !path.split('/').some(part => part.startsWith('.') || ['site-packages', 'node_modules'].includes(part))
}

function hashFile(root, path) {
  if (!/^([a-zA-Z0-9_-]+[a-zA-Z0-9_.-]*\/)*[a-zA-Z0-9_-]+[a-zA-Z0-9_.-]*$/.test(path)) throw Error('Invalid source path')
  let target = root
  if (lstatSync(root).isSymbolicLink()) throw Error('Linked source root refused')
  for (const part of path.split('/')) {
    target = join(target, part)
    if (lstatSync(target).isSymbolicLink()) throw Error('Linked source path refused')
  }
  const info = lstatSync(target)
  if (!info.isFile() || info.size > 4 * 1024 * 1024) throw Error('Unsupported source file')
  return createHash('sha256').update(readFileSync(target)).digest('hex')
}

export function comparePackagedSource(canonicalRoot, suiteRoot, manifest) {
  if (!Array.isArray(manifest?.files) || manifest.files.length > 100000) throw Error('Invalid source manifest')
  const results = []
  const seen = new Set()
  for (const file of manifest.files) {
    if (!sourcePath(file.path)) continue
    if (seen.has(file.path) || !/^[a-f0-9]{64}$/i.test(file.sha256 ?? '')) throw Error('Invalid source receipt')
    seen.add(file.path)
    const packagedHash = hashFile(suiteRoot, file.path)
    if (packagedHash !== file.sha256.toLowerCase()) {
      results.push({path: file.path, status: 'packaged-receipt-mismatch'})
      continue
    }
    let canonicalHash
    try { canonicalHash = hashFile(canonicalRoot, file.path) } catch (error) {
      if (error.code !== 'ENOENT') throw error
      results.push({path: file.path, status: 'canonical-missing'})
      continue
    }
    results.push({path: file.path, status: canonicalHash === packagedHash ? 'identical' : 'different'})
  }
  return {results, fullBuildCompared: false, cleanupQualified: false,
    scope: 'Receipt-listed Python/JS in Nori Core, NorLlama and desktop bridge/desktop; vendor environments including historical Architect lib, renderer archives, assets and unlisted files excluded'}
}
