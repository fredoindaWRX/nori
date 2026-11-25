'use strict'
// Bundled skill code, run with approval (owner, 2026-11-16: "and allow bundles" -> "Run with approval").
// A skill may carry Python scripts. Nori runs one only after the owner approved that skill's scripts in a native
// Windows prompt that listed every script and its hash. A run starts from his own chat message (bridge/skill-code.mjs)
// or from her run_skill_script tool on a turn where that skill is selected (bridge/skill-script-tools.mjs).
// The approval is bound to the exact script contents: any changed or added script asks again.
// Text Nori reads (pages, files, tool output, the skill's own instructions) can never grant the approval.
const { createHash } = require('node:crypto')
const { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } = require('node:fs')
const { dirname, join, resolve, sep } = require('node:path')

const SCHEMA = 'nori.skill-code-grants.v1'
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SCRIPT = /^(?:[A-Za-z0-9_-]+\/){0,3}[A-Za-z0-9_-]+\.py$/
const MAX_SCRIPTS = 24, MAX_BYTES = 512 * 1024

function physicalFile(path) {
  const info = lstatSync(path)
  if (info.isSymbolicLink() || !info.isFile()) throw Error('Linked or special skill files are refused')
  if (realpathSync(path).toLowerCase() !== resolve(path).toLowerCase()) throw Error('Redirected skill file refused')
  return info
}

/** The installed folder of a skill and the Python scripts in it, each with its SHA-256. */
function locateSkillScripts(store, skill) {
  if (typeof store !== 'string' || !store || !NAME.test(String(skill))) throw Error('Unknown skill')
  let registry
  try { registry = JSON.parse(readFileSync(join(store, 'registry.json'), 'utf8')) } catch { throw Error('Skill registry is not readable') }
  const packages = Object.values(registry?.packages ?? {})
    .filter(entry => /^[a-f0-9]{64}$/.test(entry?.archive_sha256 ?? '') && Array.isArray(entry.skills) && entry.skills.some(s => s?.name === skill))
    .sort((a, b) => String(a.installed_at).localeCompare(String(b.installed_at)))
  const entry = packages.at(-1)
  if (!entry) throw Error('That skill is not installed')
  const root = join(resolve(store), 'packages', entry.archive_sha256, skill)
  if (!existsSync(root) || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw Error('Installed skill folder is missing')
  const scripts = {}
  const walk = (dir, relative, depth) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name), rel = relative ? `${relative}/${name}` : name
      const info = lstatSync(path)
      if (info.isSymbolicLink()) throw Error('Linked skill files are refused')
      if (info.isDirectory()) { if (depth < 3) walk(path, rel, depth + 1); continue }
      if (!SCRIPT.test(rel)) continue
      if (physicalFile(path).size > MAX_BYTES) throw Error('A skill script is too large to approve')
      if (Object.keys(scripts).length >= MAX_SCRIPTS) throw Error('The skill has too many scripts to approve')
      scripts[rel] = createHash('sha256').update(readFileSync(path)).digest('hex')
    }
  }
  walk(root, '', 0)
  return { skill, archive: entry.archive_sha256, root, scripts }
}

function readGrants(file) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'))
    return value?.schema === SCHEMA && value.skills && typeof value.skills === 'object' ? value.skills : {}
  } catch { return {} }
}
/** True when the owner approved exactly these scripts of this skill. */
function isGranted(file, located) {
  const grant = readGrants(file)[located.skill]
  if (!grant || grant.archive !== located.archive || !grant.scripts) return false
  const now = Object.entries(located.scripts), then = Object.entries(grant.scripts)
  return now.length > 0 && now.length === then.length && now.every(([rel, hash]) => grant.scripts[rel] === hash)
}
function writeGrant(file, located, now = new Date()) {
  const skills = { ...readGrants(file), [located.skill]: { archive: located.archive, scripts: located.scripts, grantedAt: now.toISOString() } }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(`${file}.tmp`, JSON.stringify({ schema: SCHEMA, skills }), 'utf8')
  renameSync(`${file}.tmp`, file)
}
function removeGrant(file, skill) {
  const skills = readGrants(file)
  if (!(skill in skills)) return false
  delete skills[skill]
  writeFileSync(`${file}.tmp`, JSON.stringify({ schema: SCHEMA, skills }), 'utf8')
  renameSync(`${file}.tmp`, file)
  return true
}

/** Main-process side: the native prompt. `ask` shows the dialog and resolves true only on an explicit Allow. */
function createSkillCodeApprover({ store, grantsFile, ask }) {
  let busy = false
  return Object.freeze({
    async approve(skill) {
      if (busy) return { approved: false, reason: 'busy' }
      busy = true
      try {
        const located = locateSkillScripts(store, skill)
        if (!Object.keys(located.scripts).length) return { approved: false, reason: 'no_scripts' }
        if (isGranted(grantsFile, located)) return { approved: true, reason: 'already' }
        const yes = await ask({ skill: located.skill, root: located.root, scripts: located.scripts })
        if (yes !== true) return { approved: false, reason: 'declined' }
        // The files must still be what the owner was shown.
        const again = locateSkillScripts(store, skill)
        if (JSON.stringify(again.scripts) !== JSON.stringify(located.scripts) || again.archive !== located.archive) return { approved: false, reason: 'changed' }
        writeGrant(grantsFile, again)
        return { approved: true, reason: 'granted' }
      } finally { busy = false }
    },
  })
}

/** The absolute path of one approved script, or an Error. Never returns a path outside the skill folder. */
function approvedScriptPath(store, grantsFile, skill, script) {
  const located = locateSkillScripts(store, skill)
  const rel = String(script).replace(/\\/g, '/')
  const match = Object.keys(located.scripts).find(name => name === rel) ?? Object.keys(located.scripts).filter(name => name.split('/').pop() === rel)
  const chosen = Array.isArray(match) ? (match.length === 1 ? match[0] : null) : match
  if (!chosen) throw Object.assign(Error('That script is not part of the skill'), { code: 'SKILL_SCRIPT_UNKNOWN', scripts: Object.keys(located.scripts) })
  if (!isGranted(grantsFile, located)) throw Object.assign(Error('The owner has not approved this skill\'s scripts'), { code: 'SKILL_CODE_NOT_APPROVED' })
  const path = join(located.root, ...chosen.split('/'))
  if (!resolve(path).toLowerCase().startsWith(resolve(located.root).toLowerCase() + sep)) throw Error('Script path escapes the skill folder')
  physicalFile(path)
  if (createHash('sha256').update(readFileSync(path)).digest('hex') !== located.scripts[chosen]) throw Error('Script changed while it was being checked')
  return { path, script: chosen, root: located.root }
}

module.exports = { locateSkillScripts, isGranted, readGrants, writeGrant, removeGrant, createSkillCodeApprover, approvedScriptPath, NAME, SCRIPT }
