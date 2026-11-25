export type AudioTrackLike = Pick<MediaStreamTrack, 'readyState' | 'addEventListener' | 'removeEventListener'>

/** A shared capture stream is usable only when it has audio and every track is live. */
export function hasUsableAudioTracks(tracks: readonly Pick<MediaStreamTrack, 'readyState'>[]): boolean {
  return tracks.length > 0 && tracks.every(track => track.readyState === 'live')
}

/** Release every track in a stale shared stream before requesting a replacement. */
export function stopAudioTracks(tracks: readonly Pick<MediaStreamTrack, 'stop'>[]): void {
  for (const track of tracks) track.stop()
}

/** Observe device loss without polling or reopening the microphone. */
export function onAudioTrackEnded(track: AudioTrackLike, onEnded: () => void): () => void {
  let active = true
  const ended = () => {
    if (!active) return
    active = false
    track.removeEventListener('ended', ended)
    onEnded()
  }

  if (track.readyState === 'ended') {
    ended()
    return () => { active = false }
  }

  track.addEventListener('ended', ended, { once: true })
  return () => {
    active = false
    track.removeEventListener('ended', ended)
  }
}
