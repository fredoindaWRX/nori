/**
 * Executable dependency gate.
 *
 * Two invariants, both derived from the live source tree rather than from a
 * checked-in list:
 *
 *   1. Every package the manifest declares is classified in the registry, and
 *      its recorded import sites still match what the scanner finds.
 *   2. Every package a removed dependency would have provided has no import
 *      site anywhere. A removed package that creeps back into an import is a
 *      silent regression of the replacement work, so this fails loudly.
 *
 * Run directly for a human-readable report; the test suite consumes
 * `verifyRegistry()`.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { scanImports, packageNameOf, specifiersIn } from './inventory.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
export const NORI_ROOT = resolve(here, '..', '..')
const registryPath = resolve(here, 'registry.json')

export function loadRegistry() {
  return JSON.parse(readFileSync(registryPath, 'utf8'))
}

/** Declared dependency names from a package.json. */
export function declaredDesktopDependencies() {
  const manifest = JSON.parse(
    readFileSync(resolve(NORI_ROOT, 'apps', 'desktop', 'package.json'), 'utf8'),
  )
  return [...Object.keys(manifest.dependencies ?? {})].sort()
}

/** Declared dependency names from a Python requirements file. */
export function declaredPythonRequirements(manifestRelative) {
  const text = readFileSync(resolve(NORI_ROOT, manifestRelative), 'utf8')
  const names = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('-r ')) continue // handled by the caller if needed
    const match = /^([A-Za-z0-9._-]+)/.exec(line)
    if (match) names.push(match[1])
  }
  return names.sort()
}

/** Scan the desktop source roots named in the registry. */
export function scanDesktopSource() {
  const registry = loadRegistry()
  const desktop = registry.desktop
  return scanImports({
    base: resolve(NORI_ROOT, 'apps', 'desktop'),
    directories: desktop.sourceRoots,
  })
}

/**
 * @returns {{ok: boolean, errors: string[], warnings: string[], stats: object}}
 */
export function verifyRegistry() {
  const errors = []
  const warnings = []
  const registry = loadRegistry()
  const desktop = registry.desktop
  const { imports } = scanDesktopSource()

  // 1. Manifest and registry agree.
  const declared = declaredDesktopDependencies()
  const recorded = desktop.dependencies.map((entry) => entry.name).sort()
  for (const name of declared) {
    if (!recorded.includes(name)) {
      errors.push(`package.json declares ${name} but registry.json does not classify it`)
    }
  }
  for (const name of recorded) {
    if (!declared.includes(name)) {
      errors.push(`registry.json classifies ${name} but package.json does not declare it`)
    }
  }
  const duplicate = recorded.find((name, index) => recorded.indexOf(name) !== index)
  if (duplicate) errors.push(`registry.json lists ${duplicate} more than once`)

  // 2. A removed package has no import site. This is the regression guard.
  for (const entry of desktop.removed ?? []) {
    if (imports[entry.name]) {
      errors.push(
        `removed dependency ${entry.name} has import sites again: ${imports[entry.name].join(', ')}`,
      )
    }
  }

  // 3. Recorded import sites still reflect reality.
  for (const entry of desktop.dependencies) {
    const actual = imports[entry.name] ?? []
    const claimed = entry.importedBy ?? []
    const missing = claimed.filter((file) => !actual.includes(file))
    const extra = actual.filter((file) => !claimed.includes(file))
    for (const file of missing) {
      errors.push(`${entry.name} claims ${file} imports it, but the scanner finds no import site there`)
    }
    for (const file of extra) {
      warnings.push(`${entry.name} is imported by ${file}, which the registry does not record`)
    }
    if (actual.length === 0 && entry.classification !== 'required-standard-foundation') {
      errors.push(
        `${entry.name} is classified ${entry.classification} but nothing imports it; remove it or record why it stays`,
      )
    }
  }

  // 4. No vendor agent SDK or wake-word provider reappears anywhere.
  const forbidden = ['@anthropic-ai', '@picovoice', 'kokoro-js', 'crewai']
  for (const name of Object.keys(imports)) {
    if (forbidden.some((needle) => name === needle || name.startsWith(`${needle}/`))) {
      errors.push(`alternative provider ${name} is imported again`)
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      declaredDesktop: declared.length,
      classifiedDesktop: recorded.length,
      removedDesktop: (desktop.removed ?? []).length,
      scannedPackages: Object.keys(imports).length,
      scannedFiles: scanDesktopSource().files.length,
    },
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = verifyRegistry()
  for (const warning of result.warnings) console.warn(`warn  ${warning}`)
  for (const error of result.errors) console.error(`FAIL  ${error}`)
  console.log(JSON.stringify(result.stats))
  console.log(result.ok ? 'dependency registry OK' : `${result.errors.length} dependency registry error(s)`)
  process.exit(result.ok ? 0 : 1)
}

export { specifiersIn, packageNameOf, scanImports }