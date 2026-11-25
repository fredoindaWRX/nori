function installationIntent(argv = []) {
  let pending = argv.includes('--manage-installation')
  return {
    request(args) { if (args.includes('--manage-installation')) pending = true },
    pending() { return pending },
    consume() { const value = pending; pending = false; return value },
  }
}
module.exports = { installationIntent }
