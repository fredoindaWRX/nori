/** Standard allows barge-in; Strict refuses input during assistant playback. */
export function blockDuringPlayback(strict: boolean, playbackActive: boolean): boolean {
  return strict && playbackActive
}
