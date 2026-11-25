// Asks the desktop app to start (or keep alive) its owned image/video runtime. The runtime is
// no longer started at boot; every image or video request calls this first. Fixed message, no
// arguments: the bridge can only ask for the app's own runtime, never name a program or path.
export function imageRuntimeManaged() {
  return process.env.NORI_COMFY_RUNTIME_MANAGED === '1' && typeof process.send === 'function' && process.connected === true
}

export function requestImageRuntime() {
  if (!imageRuntimeManaged()) return false
  try { process.send({ kind: 'nori-image-runtime-start' }); return true } catch { return false }
}
