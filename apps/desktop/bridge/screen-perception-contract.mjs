export const SCREEN_PERCEPTION_SCHEMA_VERSION = 1
export const SCREEN_PERCEPTION_MAX_IMAGE_BYTES = 3_000_000
export const SCREEN_PERCEPTION_MAX_RESPONSE_BYTES = 32_768
export const SCREEN_PERCEPTION_MAX_FINDINGS = 24
export const SCREEN_PERCEPTION_MAX_VALUE_LENGTH = 1_000
export const SCREEN_PERCEPTION_MAX_CAPTURE_AGE_MS = 60_000
export const SCREEN_PERCEPTION_MAX_RESULT_AGE_MS = 30_000
export const SCREEN_PERCEPTION_FUTURE_SKEW_MS = 5_000
export const SCREEN_PERCEPTION_FINDING_KINDS = Object.freeze([
  'application',
  'window',
  'ui_element',
  'visible_text',
])

export const SCREEN_PERCEPTION_OUTPUT_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['status', 'findings'],
  properties: {
    status: { type: 'string', enum: ['ok', 'no_findings'] },
    findings: {
      type: 'array',
      maxItems: SCREEN_PERCEPTION_MAX_FINDINGS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'value'],
        properties: {
          kind: { type: 'string', enum: SCREEN_PERCEPTION_FINDING_KINDS },
          value: { type: 'string', minLength: 1, maxLength: SCREEN_PERCEPTION_MAX_VALUE_LENGTH },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
  },
})

const PRIVATE_CONTENT = /\b(?:password|passcode|one[- ]time code|verification code|recovery code|private message|direct message|email body|bank account|credit card|social security|medical record)\b/i
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function failure(code) {
  return { ok: false, error: { code } }
}

export function validateScreenPerceptionRequest(value, { now = Date.now() } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return failure('invalid_request')
  const allowedKeys = new Set(['type', 'id', 'sampleId', 'source', 'capturedAt', 'frame'])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))
    || (Object.hasOwn(value, 'type') && value.type !== 'screen-perception-frame')) return failure('invalid_request')
  const { id, sampleId, source, capturedAt, frame } = value
  if (typeof id !== 'string' || id.length < 1 || id.length > 128) return failure('invalid_request')
  if (typeof sampleId !== 'string' || sampleId.length < 1 || sampleId.length > 128) return failure('invalid_request')
  if (source !== 'screen') return failure('invalid_source')
  if (!Number.isFinite(capturedAt) || capturedAt <= 0 || capturedAt > now + SCREEN_PERCEPTION_FUTURE_SKEW_MS
    || now - capturedAt > SCREEN_PERCEPTION_MAX_CAPTURE_AGE_MS) return failure('invalid_timestamp')
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return failure('invalid_frame')
  if (Object.keys(frame).some((key) => !['data', 'mimeType'].includes(key))) return failure('invalid_frame')
  if (typeof frame.data !== 'string' || frame.data.length === 0
    || frame.data.length > SCREEN_PERCEPTION_MAX_IMAGE_BYTES || frame.data.length % 4 !== 0
    || !BASE64.test(frame.data)) return failure('invalid_frame')
  if (!MIME_TYPES.has(frame.mimeType)) return failure('invalid_frame')
  return {
    ok: true,
    request: { id, sampleId, source, capturedAt, frame: { data: frame.data, mimeType: frame.mimeType } },
  }
}

export function validateScreenPerceptionResponse(value, {
  requestId,
  sampleId,
  capturedAt,
  now = Date.now(),
} = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return failure('invalid_response')
  const allowedKeys = new Set([
    'schemaVersion', 'requestId', 'sampleId', 'source', 'capturedAt', 'observedAt',
    'status', 'findings', 'backendId', 'modelId', 'errorCode',
  ])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return failure('invalid_response')
  if (value.schemaVersion !== SCREEN_PERCEPTION_SCHEMA_VERSION) return failure('invalid_response')
  if (typeof value.requestId !== 'string' || value.requestId !== requestId) return failure('request_id_mismatch')
  if (typeof value.sampleId !== 'string' || value.sampleId !== sampleId) return failure('sample_id_mismatch')
  if (value.source !== 'screen') return failure('invalid_source')
  if (!Number.isFinite(capturedAt) || capturedAt <= 0
    || !Number.isFinite(value.capturedAt) || value.capturedAt !== capturedAt
    || !Number.isFinite(value.observedAt) || value.observedAt < capturedAt
    || value.observedAt > now + SCREEN_PERCEPTION_FUTURE_SKEW_MS
    || now - value.observedAt > SCREEN_PERCEPTION_MAX_RESULT_AGE_MS) return failure('invalid_timestamp')
  if (!['ok', 'no_findings', 'error'].includes(value.status)) return failure('invalid_status')
  if (!Array.isArray(value.findings) || value.findings.length > SCREEN_PERCEPTION_MAX_FINDINGS) {
    return failure('invalid_findings')
  }
  if (!['ollama-json-screen-v1', 'nori-local-gguf-screen-v1', 'nori-windows-ocr-v1'].includes(value.backendId)) {
    return failure('invalid_provenance')
  }
  // OCR reports literal text only; it must never inherit a model's scene authority.
  if (value.backendId === 'nori-windows-ocr-v1' && (value.modelId !== undefined
    || value.findings.some((finding) => !finding || finding.kind !== 'visible_text'
      || finding.confidence !== undefined))) return failure('invalid_provenance')
  if (value.modelId !== undefined
    && (typeof value.modelId !== 'string' || value.modelId.length < 1 || value.modelId.length > 128)) {
    return failure('invalid_provenance')
  }
  if (value.status === 'error') {
    if (value.findings.length !== 0 || typeof value.errorCode !== 'string'
      || !/^[a-z_]{1,48}$/.test(value.errorCode)) return failure('invalid_error')
    return { ok: true, response: { ...value, findings: [] } }
  }
  if (Object.hasOwn(value, 'errorCode')) return failure('invalid_response')
  if ((value.status === 'ok' && value.findings.length === 0)
    || (value.status === 'no_findings' && value.findings.length !== 0)) return failure('invalid_status')

  const findings = []
  for (const finding of value.findings) {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)
      || Object.keys(finding).some((key) => !['kind', 'value', 'confidence'].includes(key))) {
      return failure('invalid_finding')
    }
    if (!SCREEN_PERCEPTION_FINDING_KINDS.includes(finding.kind)) return failure('invalid_finding')
    if (typeof finding.value !== 'string' || finding.value.trim().length === 0
      || finding.value.length > SCREEN_PERCEPTION_MAX_VALUE_LENGTH
      || PRIVATE_CONTENT.test(finding.value)) return failure('invalid_finding')
    if (finding.confidence !== undefined
      && (!Number.isFinite(finding.confidence) || finding.confidence < 0 || finding.confidence > 1)) {
      return failure('invalid_finding')
    }
    findings.push({
      kind: finding.kind,
      value: finding.value.trim(),
      ...(finding.confidence === undefined ? {} : { confidence: finding.confidence }),
    })
  }
  return { ok: true, response: { ...value, findings } }
}

export function parseScreenPerceptionJson(raw, expected) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > SCREEN_PERCEPTION_MAX_RESPONSE_BYTES) {
    return failure('invalid_json')
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return failure('invalid_json')
  }
  return validateScreenPerceptionResponse(parsed, expected)
}
