'use strict'
// Projects the owner has allowed Nori to code in (owner, 2026-11-16: "fix her coding panel to work like yours").
// The native consent dialog is shown once per project; after that the project is remembered here until the owner
// stops allowing it. Only the project folder paths are stored. Choosing a project never adds it: only an
// approved consent dialog does (coding-session.cjs).
const { mkdirSync, readFileSync, renameSync, writeFileSync } = require('node:fs')
const { dirname } = require('node:path')

const SCHEMA = 'nori.coding-grants.v1', MAX = 32
const key = project => String(project).toLowerCase()

function createCodingGrants({ file, log = () => {} } = {}) {
  if (typeof file !== 'string' || !file) throw new TypeError('Coding grants need a settings file')
  const read = () => {
    try {
      const value = JSON.parse(readFileSync(file, 'utf8'))
      if (value?.schema !== SCHEMA || !Array.isArray(value.projects)) return []
      return value.projects.filter(p => typeof p === 'string' && p.length > 2 && p.length <= 2048).slice(-MAX)
    } catch { return [] }
  }
  const write = projects => {
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(`${file}.tmp`, JSON.stringify({ schema: SCHEMA, projects: projects.slice(-MAX) }), 'utf8')
      renameSync(`${file}.tmp`, file)
      return true
    } catch (error) { log(`Could not save coding grants: ${error.code || 'unknown'}`); return false }
  }
  return Object.freeze({
    has: project => typeof project === 'string' && read().some(p => key(p) === key(project)),
    add: project => typeof project === 'string' && project.length > 2 && project.length <= 2048
      && write([...read().filter(p => key(p) !== key(project)), project]),
    remove: project => typeof project === 'string' && write(read().filter(p => key(p) !== key(project))),
    list: read,
  })
}
module.exports = { createCodingGrants }
