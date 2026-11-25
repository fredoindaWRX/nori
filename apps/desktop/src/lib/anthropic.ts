/** Shared streaming types retained under the historical module name so the UI
 * and bridge remain source-compatible. Nori v2 never calls a provider from the
 * browser; all reasoning is routed through the local bridge and Council. */
export type Msg = {
  role: 'user' | 'assistant'
  content: string
}

export type VideoProgress = {
  stage: 'preparing' | 'generating' | 'assembling' | 'verifying'
  completedShots: number
  totalShots: number
  durationSeconds: number
  elapsedMs: number
}

export type AskHandlers = {
  onText: (delta: string) => void
  onTool: (name: string) => void
  onProgress?: (progress: VideoProgress | null) => void
}
