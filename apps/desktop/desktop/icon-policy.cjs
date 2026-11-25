const { existsSync } = require('node:fs')

function shouldAnimateIconFrames(iconPath, exists = existsSync) {
  return !(typeof iconPath === 'string' && iconPath.toLowerCase().endsWith('.ico') && exists(iconPath))
}

module.exports = { shouldAnimateIconFrames }
