const IMAGE_WORDS = /\b(images?|pictures?|photos?|art|illustrations?|portraits?|wallpapers?|renders?)\b/i
const IMAGE_ACTION = /\b(generate|create|make|draw|render|design)\b/i
const SKILL_WORK = /\b(skill|github|repository|repo|install|integrat(?:e|ion)|implement|capabilit(?:y|ies)|plugin|tool|code|app|website|function|module)\b/i
const CRAFT_APP = /\b(?:photo|vector|film|light|pdf|effect|design|fig|word|sound|deck|cad|grid)[\s-]?craft\b/i
const NON_IMAGE_ARTIFACT = /\b(?:documents?|reports?|spreadsheets?|workbooks?|presentations?|slides?|pdfs?|essays?|letters?|resumes?|invoices?|databases?|scripts?|programs?|prompts?|songs?|music|audio|videos?)\b/i
const OTHER_TOOL_DOMAIN = /\b(?:rea|reverse[- ]engineering|aider|blueprints?|wireframes?|prototypes?|brochures?|magazines?|page\s+layout|motion\s+graphics?|photo\s+library|raw\s+photo|svg|logos?|vector|retouch|crop|annotate|redact)\b/i
const NEGATED_ACTION = /\b(?:do\s+not|don't|dont|never)\s+(?:generate|create|make|draw|render|design)\b/i

export function isNoriSelfPortraitRequest(goal) {
  const text = userCreativeRoutingText(goal).trim()
  const directed = /^(?:hey\s+nori[,!]?\s*)?(?:(?:please|can\s+you|could\s+you|would\s+you|will\s+you)\s+)?(?:show|send|sned|give|generate|create|make|draw|paint|render)\b/i.test(text)
  if (!directed) return false
  return /\b(?:images?|pictures?|pics?|photos?|photographs?|portraits?|illustrations?|drawings?)\s+of\s+(?:you(?:rself)?|nori)\b/i.test(text)
    || /\byour\s+(?:portrait|avatar)\b/i.test(text)
    || /\b(?:draw|paint|render)\s+yourself\b/i.test(text)
    || /\bshow\b.{0,40}\bwhat\s+you\s+(?:would\s+)?look\s+like\b/i.test(text)
}

export function isImageCapabilityQuestion(goal) {
  goal = userCreativeRoutingText(goal)
  return IMAGE_WORDS.test(goal) && IMAGE_ACTION.test(goal) &&
    /^(?:hey\s+nori[,!]?\s*)?(?:can|could|do|are)\s+you\b/i.test(goal.trim()) &&
    !/\b(?:of|showing|depicting|with|for me|a cat|a dog)\b/i.test(goal) && !SKILL_WORK.test(goal)
}

function directImageRequest(goal) {
  goal = userCreativeRoutingText(goal)
  // Artifact selection is shared with the app broker. The broad conversational
  // image shortcut must not steal CAD/XLSX/UI work or resolve an ambiguous task.
  if (hasNoriArtCraftNonImageIntent(goal)) return false
  if (isImageCapabilityQuestion(goal) || SKILL_WORK.test(goal) || CRAFT_APP.test(goal)
    || NON_IMAGE_ARTIFACT.test(goal) || OTHER_TOOL_DOMAIN.test(goal) || NEGATED_ACTION.test(goal)) return false
  if (isNoriSelfPortraitRequest(goal)) return true
  if (IMAGE_ACTION.test(goal) && IMAGE_WORDS.test(goal)) return true
  if (!IMAGE_ACTION.test(goal)) return false
  // Concrete visual subjects may omit "picture" in a conversational follow-up.
  if (/\b(?:create|make|draw|render|design)\s+(?:me\s+)?(?:a|an|the)\s+.{3,}/i.test(goal)) return true
  return false
}

function imageRefinement(text) {
  return /^(?:(?:please|can you|could you|would you)\s+)?(?:(?:make|render|draw|show|change)\s+(?:it|that|this|her|him|them|yourself|the\s+(?:image|picture|portrait))\b|(?:have|has)\s+to\s+(?:show|include)\b|(?:more|less|higher|lower)\s+(?:realistic|detail(?:ed)?|resolution|contrast)\b)/i.test(text.trim())
}

/** Resolve bounded user-authored image refinements without borrowing unrelated tasks. */
export function resolveImageRequest(goal, turns = []) {
  const raw = String(goal ?? '').trim()
  const text = userCreativeRoutingText(raw).trim()
  if (!IMAGE_WORDS.test(text) && /^(?:(?:please|can you)\s+)?(?:make|set|change|turn|reset|restore|clear|show|hide)\s+(?:(?:the|your|nori(?:'s)?)\s+)*(?:hud|interface|theme|accent|orb|entity|systems?|rails?)\b/i.test(text)) return null
  if (!text || hasNoriArtCraftNonImageIntent(text) || isImageCapabilityQuestion(text)
      || SKILL_WORK.test(text) || CRAFT_APP.test(text) || NON_IMAGE_ARTIFACT.test(text)
      || OTHER_TOOL_DOMAIN.test(text) || NEGATED_ACTION.test(text)) return null
  if (isNoriSelfPortraitRequest(text)) return raw
  if (!imageRefinement(text)) return directImageRequest(text) ? raw : null
  const refinements = [raw]
  const users = Array.isArray(turns) ? turns.filter(turn => turn?.role === 'user' && typeof turn.text === 'string').slice(-8) : []
  for (let index = users.length - 1; index >= 0; index--) {
    const previousRaw = users[index].text.trim()
    const previous = userCreativeRoutingText(previousRaw).trim()
    if (directImageRequest(previous) && !imageRefinement(previous)) {
      const request = [previousRaw, ...refinements.reverse().map(value => `Requested image refinement: ${value}`)].join('\n')
      return request.length <= 4000 ? request : null
    }
    if (/^(?:did|have|are)\s+you\b.{0,50}\b(?:finish|finished|done|complete|completed)\b.{0,50}\b(?:it|that|picture|image|portrait)\b/i.test(previous)) continue
    if (!imageRefinement(previous)) return null
    refinements.push(previousRaw)
  }
  return null
}

export function isImageRequest(goal, turns = []) {
  return resolveImageRequest(goal, turns) !== null
}

export function imageCapabilityAnswer(providerReachable) {
  return providerReachable
    ? 'I have a local image-generation tool, and a local provider is responding. Tell me what to draw and I can attempt it. A successful image still needs to be generated and displayed; I won’t claim it worked before that happens.'
    : 'I have a local image-generation tool, but its image provider is not responding right now. My conversation model does not draw images by itself. The image runtime needs to be connected and tested before I can create and display pictures. I haven’t installed anything or generated an image.'
}

import { hasNoriArtCraftNonImageIntent, userCreativeRoutingText } from './artcraft-tools.mjs'

