function createWorkspaceProjectReader({ root, owns, loadTools }) {
  if (typeof root !== 'string' || !root || typeof owns !== 'function' || typeof loadTools !== 'function') {
    throw new TypeError('A Nori project root, owner check, and project-reader loader are required')
  }
  let toolsPromise
  const tools = () => toolsPromise ??= Promise.resolve().then(loadTools).then(module => {
    if (typeof module?.createNoriProjectTools !== 'function') throw new Error('The Nori project reader is unavailable')
    return module.createNoriProjectTools(root)
  })
  const call = async (event, name, args) => {
    if (!owns(event)) return null
    const instance = await tools()
    return JSON.parse(await instance.call(name, args))
  }
  return Object.freeze({
    list: (event, args) => call(event, 'list_dir', args),
    read: (event, args) => call(event, 'read_file', args),
  })
}

module.exports = { createWorkspaceProjectReader }
