export function renderProfile(gl, {floating=false, scale=2, maxFps=0, pixelRatio=1, reduced=false}={}) {
  let name=''
  try { const ext=gl.getExtension('WEBGL_debug_renderer_info'); name=String(gl.getParameter(ext?ext.UNMASKED_RENDERER_WEBGL:gl.RENDERER)||'') } catch {}
  const software=/swiftshader|llvmpipe|softpipe|software|swrast|lavapipe/i.test(name)
  return {software, dpr:software?0.75:floating?scale:Math.min(pixelRatio||1,2),
    fps:software?(maxFps?Math.min(maxFps,15):15):maxFps,
    density:software?0.08:reduced?0.4:floating?1.4:0.75,postprocessing:!software}
}
export function scheduleSceneStart({scheduleFrame,scheduleTask,compile,start,isDisposed,onError}) {
  scheduleFrame(()=>scheduleFrame(()=>scheduleTask(async()=>{
    if(isDisposed())return
    try { await compile(); if(!isDisposed())start() } catch(error) { if(!isDisposed())onError(error) }
  })))
}
