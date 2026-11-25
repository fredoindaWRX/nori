import {
  SCREEN_PERCEPTION_SCHEMA_VERSION,
  SCREEN_PERCEPTION_OUTPUT_SCHEMA,
  SCREEN_PERCEPTION_MAX_FINDINGS,
  SCREEN_PERCEPTION_MAX_VALUE_LENGTH,
  parseScreenPerceptionJson,
  validateScreenPerceptionRequest,
  validateScreenPerceptionResponse,
} from './screen-perception-contract.mjs'
import { structuredScreenFindings, resolveScreenVisionConfig } from './local-chat.mjs'
import {perceiveNativeScreenText} from './native-screen-text.mjs'
import { LOCAL_SCREEN_VISION_BACKEND_ID, LOCAL_VISION_MODEL_ID } from './local-vision.mjs'

const OLLAMA_BACKEND_ID = 'ollama-json-screen-v1'
const PRIVATE_CONTENT = /\b(?:password|passcode|one[- ]time code|verification code|recovery code|private message|direct message|email body|bank account|credit card|social security|medical record)\b/i
const UI_FINDING_STOPWORDS = new Set(['button', 'control', 'element', 'field', 'icon', 'input', 'screen', 'ui', 'window'])

function normalizeGroundingText(value) {
  return String(value).normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ')
}

function findingHasOcrGrounding(finding, ocrLines) {
  const candidate = normalizeGroundingText(finding.value)
  if (!candidate) return false
  if (finding.kind === 'application' || finding.kind === 'window') {
    // Windows OCR returns lines in reading order. Restrict identity claims to
    // the first line (the visible title/header), not menu labels such as File.
    return ` ${normalizeGroundingText(ocrLines[0] ?? '')} `.includes(` ${candidate} `)
  }
  if (finding.kind === 'visible_text') {
    return ocrLines.some((line) => ` ${normalizeGroundingText(line)} `.includes(` ${candidate} `))
  }
  const anchors = candidate.split(' ').filter((word) => word.length >= 3 && !UI_FINDING_STOPWORDS.has(word))
  return anchors.length > 0 && ocrLines.some((line) => {
    const source = ` ${normalizeGroundingText(line)} `
    return anchors.some((word) => source.includes(` ${word} `))
  })
}

function validateModelOutput(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 32_768) {
    return { ok: false }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || Object.keys(parsed).some((key) => !['status', 'findings'].includes(key))
    || !['ok', 'no_findings'].includes(parsed.status)
    || !Array.isArray(parsed.findings)
    || parsed.findings.length > SCREEN_PERCEPTION_MAX_FINDINGS) return { ok: false }

  const findings = []
  for (const finding of parsed.findings) {
    if (!finding || typeof finding !== 'object' || Array.isArray(finding)
      || Object.keys(finding).some((key) => !['kind', 'value', 'confidence'].includes(key))
      || !['application', 'window', 'ui_element', 'visible_text'].includes(finding.kind)
      || typeof finding.value !== 'string'
      || finding.value.trim().length === 0
      || finding.value.length > SCREEN_PERCEPTION_MAX_VALUE_LENGTH
      || PRIVATE_CONTENT.test(finding.value)) return { ok: false }
    if (finding.confidence !== undefined
      && (!Number.isFinite(finding.confidence) || finding.confidence < 0 || finding.confidence > 1)) {
      return { ok: false }
    }
    findings.push({
      kind: finding.kind,
      value: finding.value.trim(),
      ...(finding.confidence === undefined ? {} : { confidence: finding.confidence }),
    })
  }
  if ((parsed.status === 'ok' && findings.length === 0)
    || (parsed.status === 'no_findings' && findings.length !== 0)) return { ok: false }
  return { ok: true, status: parsed.status, findings }
}

function errorResponse(request, errorCode, observedAt, backendId, modelId) {
  return {
    schemaVersion: SCREEN_PERCEPTION_SCHEMA_VERSION,
    requestId: request.id,
    sampleId: request.sampleId,
    source: 'screen',
    capturedAt: request.capturedAt,
    observedAt,
    status: 'error',
    findings: [],
    backendId,
    ...(modelId ? { modelId } : {}),
    errorCode,
  }
}

/** Run a separate schema-constrained screen perception request; alert scanning remains independent. */
export async function perceiveScreenRequest(value, {
  analyze = structuredScreenFindings,
  readGroundingText = perceiveNativeScreenText,
  now = Date.now,
  signal,
  environment = process.env,
} = {}) {
  if (environment.NORI_VISION_BACKEND === 'windows-ocr') {
    return perceiveNativeScreenText(value, {signal,now,environment})
  }
  const validation = validateScreenPerceptionRequest(value, { now: now() })
  if (!validation.ok) return validation
  const request = validation.request
  const config = resolveScreenVisionConfig(environment)
  const requestedBackend = config.backend === 'nori-local-gguf'
    ? LOCAL_SCREEN_VISION_BACKEND_ID : OLLAMA_BACKEND_ID
  const requestedModel = config.backend === 'nori-local-gguf' ? LOCAL_VISION_MODEL_ID : config.modelId
  let ocrLines = null
  if (config.backend === 'nori-local-gguf') {
    try {
      const grounding = await readGroundingText(value, { signal, now, environment })
      if (!grounding?.ok || grounding.response?.status === 'error') throw new Error('Screen text grounding unavailable')
      ocrLines = grounding.response.findings
        .filter((finding) => finding.kind === 'visible_text')
        .map((finding) => finding.value)
      if (!ocrLines.length) return grounding
    } catch {
      return { ok: true, response: errorResponse(request, signal?.aborted ? 'request_aborted' : 'screen_text_grounding_unavailable',
        now(), requestedBackend, requestedModel) }
    }
  }
  let output
  try {
    output = await analyze({
      image: request.frame.data,
      schema: SCREEN_PERCEPTION_OUTPUT_SCHEMA,
      signal,
    })
  } catch {
    const observedAt = now()
    const response = errorResponse(request, signal?.aborted ? 'request_aborted' : 'perception_unavailable', observedAt,
      requestedBackend, requestedModel)
    return { ok: true, response }
  }

  const parsed = validateModelOutput(output?.raw)
  const observedAt = now()
  if (!parsed.ok) {
    const response = errorResponse(request, 'invalid_model_result', observedAt,
      output?.backendId || requestedBackend, output?.modelId || requestedModel)
    return { ok: true, response }
  }

  const groundedFindings = ocrLines === null
    ? parsed.findings
    : parsed.findings.filter((finding) => findingHasOcrGrounding(finding, ocrLines))
  const response = {
    schemaVersion: SCREEN_PERCEPTION_SCHEMA_VERSION,
    requestId: request.id,
    sampleId: request.sampleId,
    source: 'screen',
    capturedAt: request.capturedAt,
    observedAt,
    status: groundedFindings.length ? 'ok' : 'no_findings',
    findings: groundedFindings,
    backendId: output.backendId || requestedBackend,
    ...(typeof (output.modelId || requestedModel) === 'string' && (output.modelId || requestedModel).length <= 128
      ? { modelId: output.modelId || requestedModel }
      : {}),
  }
  const checked = validateScreenPerceptionResponse(response, {
    requestId: request.id,
    sampleId: request.sampleId,
    capturedAt: request.capturedAt,
    now: now(),
  })
  return checked.ok ? checked : { ok: true, response: errorResponse(request, 'invalid_model_result', now(),
    output.backendId || requestedBackend, output.modelId || requestedModel) }
}

/** Parse the complete raw JSON response without prose/fence extraction. */
export function parseScreenPerceptionResponse(raw, expected) {
  return parseScreenPerceptionJson(raw, expected)
}
