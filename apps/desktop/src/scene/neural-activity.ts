import type { Phase } from '../store'

export const NEURAL_REGIONS = ['language', 'project', 'memory', 'voice', 'vision', 'tools', 'connections', 'auditory', 'planning', 'protection', 'spatial', 'lifecycle', 'working_memory'] as const

/** Stable functional regions, not biological neurons or learned swarm labels. */
export const NEURAL_CENTERS: readonly (readonly [number, number, number])[] = [
  [0, .65, 0], [-.8, .15, .2], [.8, .15, .2], [-.5, -.6, .4],
  [.5, -.6, .4], [0, 0, -.8], [0, -.85, -.2], [0, .1, .9],
  [.7, .6, -.4], [-.7, .6, -.4], [.8, -.5, -.2], [-.8, -.5, -.2],
  [0, -.15, 0],
]

export type NeuralActivityInput = {
  phase: Phase
  level: number
  muted: boolean
  activeTool: string | null
  looking: string | null
  connected: readonly string[]
}

/** Map only observed processing state to activity, not enabled capabilities. */
export function neuralActivity(state: NeuralActivityInput, receivingText = false): number[] {
  const rawTool = state.activeTool ?? ''
  const tool = rawTool.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/[_:-]+/g, ' ')
  const project = /\b(file|files|filesystem|code|project|directory|directories|workspace|repository)\b/.test(tool)
    || /^(read|edit|write|glob|grep)$/i.test(rawTool)
  const memory = /\b(memory|recall|remember)\b/.test(tool)
  const vision = Boolean(state.looking) || /\b(vision|screen|camera|screenshot)\b/.test(tool)
  const voice = state.phase === 'speaking'
  const auditory = state.phase === 'listening' && !state.muted
  const planning = /\b(plan|planning|architect|council|delegate|delegation)\b/.test(tool)
  const protection = /\b(sentinel|watchman|permission|safety|authorization)\b/.test(tool)
  const spatial = /\b(spatial|presence|room|rooms|localization)\b/.test(tool)
  const level = Number.isFinite(state.level) ? Math.min(1, Math.max(0, state.level)) : 0
  return [
    state.phase === 'thinking' || receivingText ? 1 : 0,
    project ? 1 : 0,
    memory ? 1 : 0,
    voice ? Math.max(.25, level) : 0,
    vision ? 1 : 0,
    state.activeTool ? 1 : 0,
    // Being connected is availability; signal traffic needs its own telemetry.
    0,
    auditory ? Math.max(.25, level) : 0,
    planning ? 1 : 0,
    protection ? 1 : 0,
    spatial ? 1 : 0,
    state.phase === 'boot' || state.phase === 'waking' ? 1 : 0,
    // Dedicated context-update telemetry supplies working-memory activity.
    0,
  ]
}
