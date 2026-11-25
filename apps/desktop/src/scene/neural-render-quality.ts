export function neuralRenderQuality(width: number, height: number, nativeDpr: number, maximumTextureSize: number, highDetail: boolean, navigating = false) {
  if (![width, height, nativeDpr, maximumTextureSize].every(value => Number.isFinite(value) && value > 0)) throw new Error('Positive render dimensions required')
  const landscape = width >= height
  const wanted = highDetail ? Math.min((landscape ? 3840 : 2160) / width, (landscape ? 2160 : 3840) / height) : Math.min(nativeDpr, 2)
  // 4K pixel budget, aspect preserved, bounded by the actual GL limit.
  // During orbit/zoom, render at native density for responsive controls. The
  // full requested detail returns as soon as the camera settles.
  const responsiveWanted = navigating ? Math.min(wanted, 1) : wanted
  const dpr = Math.min(responsiveWanted, maximumTextureSize / width, maximumTextureSize / height, Math.sqrt(8_294_400 / (width * height)))
  return { dpr, width: Math.floor(width * dpr), height: Math.floor(height * dpr), hardwareLimited: dpr < wanted - 1e-6 }
}
