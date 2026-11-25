import type { Subsystem } from '../store'

/**
 * Subsystem attribution for text Nori shows.
 *
 * The rule is ownership of the subject: "what system is this line about?"
 * decides the colour. Never the sender, the receiver, or which bridge carried
 * it — a reply that came back through Core while reporting on the camera is
 * `vision`.
 *
 * Explicit metadata is always preferred. Path and tool-name inference exists
 * only as a fallback for callers that have nothing better to hand, because a
 * substring rule will eventually be wrong and a wrong guess is worse than no
 * guess: `undefined` renders as ordinary Nori text, which is always safe.
 */

/** Ordered so the most specific reading of a path wins over a generic one. */
const PATH_RULES: ReadonlyArray<{ subsystem: Subsystem; test: RegExp }> = [
  { subsystem: 'vision', test: /(?:^|[\\/])(?:vision|camera|screen|cv)(?:[\\/._-]|$)/i },
  { subsystem: 'hal', test: /(?:^|[\\/])(?:hal|hardware|vehicle|device|serial|probe)(?:[\\/._-]|$)/i },
  { subsystem: 'core', test: /(?:^|[\\/])(?:core|orchestration|council|bridge|brain|bus)(?:[\\/._-]|$)/i },
]

const TOOL_RULES: ReadonlyArray<{ subsystem: Subsystem; test: RegExp }> = [
  { subsystem: 'vision', test: /^(?:look|see|watch|screen|camera|gesture|hand)/i },
  { subsystem: 'hal', test: /^(?:device|probe|drive|motor|serial|vacuum|hal)/i },
  { subsystem: 'core', test: /^(?:think|plan|recall|remember|route|delegate|council)/i },
]

/** Best-effort subsystem for a file path or feature name. Returns undefined when unsure. */
export function subsystemFromPath(path: string): Subsystem | undefined {
  for (const rule of PATH_RULES) if (rule.test.test(path)) return rule.subsystem
  return undefined
}

/** Best-effort subsystem for a tool name. Returns undefined when unsure. */
export function subsystemFromTool(tool: string): Subsystem | undefined {
  for (const rule of TOOL_RULES) if (rule.test.test(tool)) return rule.subsystem
  return undefined
}

/**
 * The subsystem a turn should be painted when the caller did not say.
 *
 * Prefers an explicit subsystem, then a tool the turn actually invoked, then a
 * path. Anything still unresolved stays unclassified rather than being forced
 * into Core — most turns genuinely are not about one system.
 */
export function resolveSubsystem(input: {
  explicit?: Subsystem
  tools?: readonly string[]
  path?: string
}): Subsystem | undefined {
  if (input.explicit) return input.explicit
  for (const tool of input.tools ?? []) {
    const s = subsystemFromTool(tool)
    if (s) return s
  }
  if (input.path) return subsystemFromPath(input.path)
  return undefined
}