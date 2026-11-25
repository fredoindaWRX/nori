export type SpeechExpression = Readonly<{
  speed: number
  sentencePause: number
  clausePause: number
  pitch: number
}>
export type PersonalitySnapshot = {
  mode: string
  appliedProfile: { enthusiasm: number }
  affect: {
    joy: number; amusement: number; excitement: number; concern: number
    frustration: number; urgency: number; uncertainty: number
  }
}
export const DEFAULT_SPEECH_EXPRESSION: SpeechExpression
export function speechExpression(snapshot: PersonalitySnapshot | null): SpeechExpression
export function validateSpeechExpression(value?: unknown): SpeechExpression
