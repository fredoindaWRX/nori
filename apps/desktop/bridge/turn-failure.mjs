const RESULT_FAILURES = Object.freeze({
  error_during_execution: 'The turn failed part way through.',
  error_max_turns: 'The turn ran too long and was stopped.',
  error_max_budget_usd: 'The budget for this turn ran out.',
  error_max_structured_output_retries: 'The answer could not be assembled.',
  default: 'The turn ended without an answer.',
})

function safeFailureDetail(errors) {
  if (!Array.isArray(errors)) return ''
  const value = errors.find((item) => typeof item === 'string' && item.trim())
  if (!value) return ''
  let line = value.split(/\r?\n/, 1)[0].replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  line = line
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|(?:api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*[^\s,;]+)/gi, '[credential redacted]')
    .replace(/[A-Za-z]:\\Users\\[^\\\s]+/g, '%USERPROFILE%')
  return line.slice(0, 280)
}

/** Convert an SDK result into a concise user-facing error without exposing a stack or credentials. */
export function turnFailureMessage(message) {
  if (message?.error_code === 'NORI_NATIVE_CORE_UNAVAILABLE') {
    return 'Own Nori Core/Knights tool routing is not connected yet. No legacy inference backend was invoked.'
  }
  if (message?.error_code === 'NORI_NATIVE_TOOLS_UNQUALIFIED') {
    return 'Own Core/Knights are running, but native task planning and tool execution have not passed qualification. No task was started.'
  }
  if (message?.error_code === 'NORI_LOCAL_IMAGE_FAILED') {
    return safeFailureDetail(message.errors) || 'Local image generation failed; no image was delivered.'
  }
  if (message?.error_code === 'NORI_NATIVE_CHAT_FAILED') {
    return safeFailureDetail(message.errors) || 'Native reply failed.'
  }
  if (message?.error_code === 'NORI_GPT_OSS_CHAT_FAILED') {
    return safeFailureDetail(message.errors) || 'Local GPT-OSS reply failed.'
  }
  if (message?.error_code === 'NORI_READ_ONLY') {
    return 'Nori is in read-only mode. Enable write access on this machine before starting durable work or learning tasks.'
  }
  if (message?.subtype === 'error_during_execution') {
    const detail = safeFailureDetail(message.errors)
    if (detail) return `The turn failed during local execution: ${detail}`
  }
  return RESULT_FAILURES[message?.subtype] ?? RESULT_FAILURES.default
}
