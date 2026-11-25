/** A delayed transcription cannot authorize itself using an old listening mode. */
export function canDeliverTranscription(startedMode: string, currentMode: string): boolean {
  return ['wake', 'command', 'guard'].includes(startedMode) && startedMode === currentMode
}

/** One owner per voice loop; stopping one loop never cancels its replacement. */
export function createVoiceLifetime() {
  const controller = new AbortController()
  return {
    signal: controller.signal,
    active: () => !controller.signal.aborted,
    stop: () => controller.abort(),
  }
}

/**
 * Separates microphone segments captured before and after a typed turn.
 * A segment carries the epoch from its VAD onset; advancing the epoch makes
 * queued and in-flight pre-boundary speech non-deliverable without disabling
 * fresh post-boundary barge-in.
 */
export function createVoiceInputEpoch() {
  let epoch = 0
  return {
    current: () => epoch,
    advance: () => ++epoch,
    isCurrent: (captured: number) => captured === epoch,
  }
}
