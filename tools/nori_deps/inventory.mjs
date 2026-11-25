/**
 * Nori dependency inventory.
 *
 * Answers one question honestly: for every package this project declares,
 * what actually imports it, and what is it standing in for?
 *
 * This exists because the previous state of the repository declared five
 * packages that no source file imported -- including a vendor agent SDK, two
 * Picovoice wake-word packages, and kokoro-js -- while the real wake path ran
 * Nori's own regular expressions over local Whisper output. A declared
 * dependency is a claim about what the product needs. When the claim is
 * wrong, it survives review, inflates the shipped tree, and misleads the next
 * person about what is actually running.
 *
 * The scanner is deliberately dependency-free (node stdlib only) so that
 * auditing the dependency tree never itself requires the dependency tree.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { extname, join, relative, resolve, sep } from 'node:path'

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.cjs', '.js', '.jsx'])
const SKIP_DIRECTORIES = new Set([
  'node_modules', 'dist', 'release', 'coverage', '.git', '.vite', '.cache',
])

/** Bare specifier: not relative, not absolute, not a node: builtin, not a URL. */
export function isBareSpecifier(specifier) {
  if (typeof specifier !== 'string') return false
  if (specifier.length === 0) return false
  if (specifier.startsWith('.') || specifier.startsWith('/')) return false
  if (specifier.startsWith('node:')) return false
  if (specifier.includes('://')) return false
  if (/^[a-zA-Z]:[\\/]/.test(specifier)) return false
  return true
}

/**
 * Reduce an import specifier to the package that provides it.
 * Scoped packages keep both segments; everything else keeps the first.
 */
export function packageNameOf(specifier) {
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/')
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : specifier
  }
  const parts = specifier.split('/')
  return parts[0]
}

// Static `import ... from 'x'`, `export ... from 'x'`, `import 'x'`,
// `require('x')`, and the dynamic `import('x')` form.
const IMPORT_PATTERNS = [
  /(?:^|[\s;}])(?:import|export)\s[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
  /(?:^|[\s;}])import\s*['"]([^'"]+)['"]/g,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

/** Every bare specifier imported by one source text, de-duplicated and sorted. */
export function specifiersIn(source) {
  const found = new Set()
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(source)) !== null) {
      if (isBareSpecifier(match[1])) found.add(match[1])
    }
  }
  return [...found].sort()
}

/** Recursively list source files under a root, skipping build/vendor trees. */
export function listSourceFiles(root) {
  const results = []
  const walk = (directory) => {
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch {
      return // unreadable directory: report nothing rather than pretend it is empty
    }
    for (const entry of entries) {
      const full = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue // never follow links out of the tree
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) walk(full)
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name))) {
        results.push(full)
      }
    }
  }
  try {
    if (!statSync(root).isDirectory()) return results
  } catch {
    return results
  }
  walk(root)
  return results.sort()
}

/**
 * Build the import inventory for a set of roots.
 * @param {{base?: string, directories?: string[]}} roots
 * @returns {{imports: Record<string, string[]>, files: string[], roots: string[]}}
 *   `imports` maps a package name to the repository-relative files importing it.
 */
export function scanImports({ base = process.cwd(), directories = [] } = {}) {
  const basePath = resolve(base)
  const searchRoots = Array.isArray(directories) ? directories : [directories]
  const imports = new Map()
  const files = []
  for (const directory of searchRoots) {
    for (const file of listSourceFiles(join(basePath, directory))) {
      let source
      try {
        source = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      files.push(relative(basePath, file).split(sep).join('/'))
      for (const specifier of specifiersIn(source)) {
        const name = packageNameOf(specifier)
        if (!imports.has(name)) imports.set(name, [])
        imports.get(name).push(relative(basePath, file).split(sep).join('/'))
      }
    }
  }
  const sortedImports = {}
  for (const name of [...imports.keys()].sort()) {
    sortedImports[name] = [...new Set(imports.get(name))].sort()
  }
  return { imports: sortedImports, files, roots: searchRoots }
}