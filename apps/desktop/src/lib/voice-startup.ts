import type { Capabilities } from './capabilities'

/** Never wait for microphone permission when no local recognizer can use it. */
export async function prepareVoiceInput({ probe, startAnalyser, onAnalyserFailure }: {
  probe: () => Promise<Capabilities>
  startAnalyser: () => Promise<void>
  onAnalyserFailure: () => void
}): Promise<Capabilities> {
  const available = await probe()
  if (available.stt) {
    try { await startAnalyser() }
    catch { onAnalyserFailure() }
  }
  return available
}
