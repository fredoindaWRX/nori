import {lstatSync, readdirSync, readFileSync} from 'node:fs'
import {resolve, dirname, join} from 'node:path'
import {createHash} from 'node:crypto'

const excluded = new Set(['node_modules', 'site-packages', '__pycache__', 'deps', 'Assets', 'data', 'models'])
function checkedPath(path) {
  const absolute = resolve(path)
  let cursor = absolute
  while (true) {
    const stat = lstatSync(cursor)
    if (stat.isSymbolicLink()) throw Error('Linked comparison path refused')
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  return absolute
}
function digest(path) {
  checkedPath(path)
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.size > 4 * 1024 * 1024) throw Error('Unsupported source file')
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

// Compares only authored-looking source; never imports or modifies either tree.
export function compareLegacySourceTree(legacyRoot, canonicalRoot) {
  const legacy = checkedPath(legacyRoot)
  const canonical = checkedPath(canonicalRoot)
  if (!lstatSync(legacy).isDirectory() || !lstatSync(canonical).isDirectory()) throw Error('Directory required')
  const results = []
  const skipped = []
  let visited = 0
  function walk(relative = '') {
    for (const entry of readdirSync(join(legacy, relative), {withFileTypes: true})) {
      if (++visited > 100000) throw Error('Comparison entry limit exceeded')
      const path = relative ? `${relative}/${entry.name}` : entry.name
      const absolute = join(legacy, path)
      if (lstatSync(absolute).isSymbolicLink()) throw Error('Linked legacy entry refused')
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || excluded.has(entry.name) || (path.startsWith('knights/architect/') && entry.name === 'lib')) {
          skipped.push(path)
        } else walk(path)
      } else if (/\.(py|mjs|cjs|js|ts|tsx|cpp|hpp|h)$/.test(entry.name)) {
        const legacyHash = digest(absolute)
        let canonicalHash
        try { canonicalHash = digest(join(canonical, path)) } catch (error) {
          if (error.code !== 'ENOENT') throw error
          results.push({path, status: 'canonical-missing', legacyHash})
          continue
        }
        results.push({path, status: canonicalHash === legacyHash ? 'identical' : 'different', legacyHash, canonicalHash})
      }
    }
  }
  walk()
  return {legacy, canonical, results, skipped, cleanupQualified: false,
    scope: 'Source extensions only; excludes hidden directories, dependencies, assets, data, models and historical Architect lib. Snapshot hashes do not establish quiescence.'}
}
