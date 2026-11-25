const PROJECT_TOOL_INTENT = /\b(?:read[_ ]file|list[_ ]dir|file|folder|directory|repo|repository|codebase|source code|project tree|roadmap|journal|skills?|capabilities|abilities)\b/i
const PROJECT_INSPECTION = /\b(?:check|inspect|review|scan|look\s+(?:at|through)|go\s+through)\b.{0,60}\b(?:(?:your|nori'?s?|my|the|this|our)\s+)?project\b/i
const SELF_CODE_INSPECTION = /\b(?:check|inspect|review|scan|look\s+(?:at|through)|go\s+through)\b.{0,60}\b(?:(?:your|nori'?s?|our)\s+)?(?:code|source\s+code)\b/i
const NEGATED_INSPECTION = /\b(?:do not|don't|dont|never|stop|cancel)\b.{0,60}\b(?:inspect|review|check|read|scan|look|browse|go\s+through)\b/i
const REVIEW_ACTION = /\b(?:check|inspect|review|scan|look\s+(?:at|through)|go\s+through)\b/i
const REVIEW_FINDING = /\b(?:fix(?:ing)?|issues?|problems?|wrong|anything|bugs?|errors?|health|needs?|improv(?:e|ement|ements))\b/i

function normalize(goal) {
  return String(goal ?? '').replace(/\byou\s+rproject\b/gi, 'your project')
    .replace(/\bthru\b/gi, 'through').replace(/\bloiok\b/gi, 'look')
}

export function requestsNoriProjectRead(goal) {
  const text = normalize(goal)
  const instruction = text.split(/\b(?:text|passage|draft)\s*:/i, 1)[0]
  if (/\b(?:no\s+tools|without\s+(?:using\s+)?tools|do\s+not\s+use\s+tools|don['’]t\s+use\s+tools)\b/i.test(instruction)) return false
  if (NEGATED_INSPECTION.test(text)) return false
  return PROJECT_TOOL_INTENT.test(text) || PROJECT_INSPECTION.test(text) || SELF_CODE_INSPECTION.test(text)
}

export function requestsNoriProjectReview(goal) {
  const text = normalize(goal)
  const projectOrOwnCode = /\b(?:project|repo(?:sitory)?|codebase)\b/i.test(text) || SELF_CODE_INSPECTION.test(text)
  return requestsNoriProjectRead(text) && REVIEW_ACTION.test(text) && projectOrOwnCode
    && (SELF_CODE_INSPECTION.test(text) || REVIEW_FINDING.test(text))
}

/** Inspection/recommendation only; an actual change verb keeps the coding approval path. */
export function requestsReadOnlyProjectReview(goal) {
  const text = normalize(goal).trim()
  if (!/^(?:please\s+)?(?:(?:can|could|would)\s+you\s+)?(?:check|inspect|review|scan|look\s+(?:at|through)|go\s+through)\b/i.test(text)) return false
  if (!requestsNoriProjectReview(text)) return false
  const instructions = text.replace(/\b(?:ways?|opportunities)\s+to\s+(?:improve|fix|repair|enhance)\b/gi, '')
    .replace(/\b(?:tell|show)\s+me\s+(?:what|how)\s+to\s+improve\b/gi, '')
  return !/\b(?:patch|rewrite|optimi[sz]e|install|uninstall|apply|execute|run|make|build|create|write|implement|fix|debug|refactor|edit|modify|update|change|add|remove|delete|repair|improve|enhanc\w*)\b/i.test(instructions)
}
