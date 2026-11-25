const { spawn } = require('node:child_process')

// ChildProcess reports missing executables asynchronously. Always attach an
// error listener before handing the child to startup polling or shutdown.
function managedSpawn(command, args, options, spawnChild = spawn) {
  const child = spawnChild(command, args, options)
  child.startupError = null
  child.once('error', (error) => { child.startupError = error })
  return child
}

module.exports = { managedSpawn }
