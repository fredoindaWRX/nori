const { mkdirSync, writeFileSync } = require('node:fs')
const { dirname } = require('node:path')

function formatStartupFailure(error, timestamp = new Date().toISOString()) {
  const detail = error instanceof Error
    ? `${error.name}: ${error.message}\n${error.stack || ''}`
    : String(error)
  return `[${timestamp}] N.O.R.I. startup failed\n${detail}`.slice(0, 8192)
}

function writeStartupFailure(logPath, error) {
  mkdirSync(dirname(logPath), { recursive: true })
  writeFileSync(logPath, `${formatStartupFailure(error)}\n`, 'utf8')
  return logPath
}

module.exports = { formatStartupFailure, writeStartupFailure }
