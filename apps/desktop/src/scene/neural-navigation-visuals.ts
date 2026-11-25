/** Keep the visual layers that are expensive to rasterize off during camera movement. */
export function showFineNeuralDetail(navigating: boolean): boolean {
  return !navigating
}

export function showNeuralAtmosphere(navigating: boolean, visibility: number): boolean {
  return !navigating && Number.isFinite(visibility) && visibility >= 0.01
}
