/** @param {HTMLVideoElement} element @param {MediaProvider} source */
export async function attachCameraPreview(element, source) {
  element.srcObject = source
  await element.play()
}
