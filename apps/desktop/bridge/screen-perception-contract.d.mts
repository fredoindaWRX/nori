export type ScreenFindingKind = 'application' | 'window' | 'ui_element' | 'visible_text'
export type ScreenPerceptionFinding = {
  kind: ScreenFindingKind
  value: string
  confidence?: number
}
export type ScreenPerceptionResponse = {
  schemaVersion: 1
  requestId: string
  sampleId: string
  source: 'screen'
  capturedAt: number
  observedAt: number
  status: 'ok' | 'no_findings' | 'error'
  findings: ScreenPerceptionFinding[]
  backendId: 'ollama-json-screen-v1' | 'nori-windows-ocr-v1'
  modelId?: string
  errorCode?: string
}
export type ScreenPerceptionFailure = {
  ok: false
  error: { code: string }
}
export type ScreenPerceptionValidation =
  | { ok: true; response: ScreenPerceptionResponse }
  | ScreenPerceptionFailure
export type ScreenPerceptionRequestValidation =
  | {
      ok: true
      request: {
        id: string
        sampleId: string
        source: 'screen'
        capturedAt: number
        frame: { data: string; mimeType: string }
      }
    }
  | ScreenPerceptionFailure
export const SCREEN_PERCEPTION_SCHEMA_VERSION: 1
export const SCREEN_PERCEPTION_MAX_IMAGE_BYTES: number
export const SCREEN_PERCEPTION_MAX_RESPONSE_BYTES: number
export const SCREEN_PERCEPTION_MAX_FINDINGS: number
export const SCREEN_PERCEPTION_MAX_VALUE_LENGTH: number
export const SCREEN_PERCEPTION_MAX_CAPTURE_AGE_MS: number
export const SCREEN_PERCEPTION_MAX_RESULT_AGE_MS: number
export const SCREEN_PERCEPTION_FUTURE_SKEW_MS: number
export const SCREEN_PERCEPTION_FINDING_KINDS: readonly ScreenFindingKind[]
export const SCREEN_PERCEPTION_OUTPUT_SCHEMA: object
export function validateScreenPerceptionRequest(
  value: unknown,
  options?: { now?: number },
): ScreenPerceptionRequestValidation
export function validateScreenPerceptionResponse(
  value: unknown,
  expected: { requestId: string; sampleId: string; capturedAt: number; now?: number },
): ScreenPerceptionValidation
export function parseScreenPerceptionJson(
  raw: string,
  expected: { requestId: string; sampleId: string; capturedAt: number; now?: number },
): ScreenPerceptionValidation
