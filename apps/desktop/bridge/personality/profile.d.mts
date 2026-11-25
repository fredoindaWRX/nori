/** Renderer contract for the pure shared module shipped with the bridge. */
export type PersonalityTrait = 'humor' | 'honesty' | 'warmth' | 'enthusiasm' | 'sarcasm' | 'curiosity'
  | 'directness' | 'patience' | 'discretion' | 'playfulness' | 'empathy' | 'formality'
export type AffectTrait = 'joy' | 'amusement' | 'frustration' | 'irritation' | 'anger' | 'concern'
  | 'excitement' | 'confidence' | 'uncertainty' | 'curiosity' | 'urgency'
export type PersonalityProfile = Record<PersonalityTrait, number>
export type AffectState = Record<AffectTrait, number>
export type PersonalitySnapshot = {
  schema: 'nori.personality.v2'
  kind: 'context-driven-expression'
  profile: PersonalityProfile
  appliedProfile: PersonalityProfile
  affect: AffectState
  mode: 'ready' | 'playful' | 'celebrating' | 'focused' | 'supportive' | 'recovering' | 'paused'
  reason: string
  active: boolean
  saved: boolean | null
}
export const PERSONALITY_SCHEMA: 'nori.personality.v2'
export const PERSONALITY_TRAITS: readonly PersonalityTrait[]
export const DEFAULT_PERSONALITY: Readonly<PersonalityProfile>
export const AFFECT_TRAITS: readonly AffectTrait[]
export const DEFAULT_AFFECT: Readonly<AffectState>
export function validatePersonalityPatch(patch: unknown): Partial<PersonalityProfile>
export function restorePersonality(saved: unknown): PersonalityProfile
export function validPersonalitySnapshot(value: unknown): value is PersonalitySnapshot
export function personalityInstruction(snapshot: unknown): string
