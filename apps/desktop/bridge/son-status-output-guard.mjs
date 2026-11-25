import { NORI_PERSONA } from './nori-identity.mjs'

const MENTIONS_NORI_OR_SON = /\b(?:nori|son)\b/i
const MODEL_STATUS_TERMS = /\b(?:model|brain|train(?:ed|ing)?|fine[- ]tun(?:e|ed|ing)|checkpoint|built|building|creating|retired|retirement|serving|target)\b/i
const SON_SUBJECT = String.raw`(?:Nori[- ]?20B(?:\s+SoN)?|SoN|her own(?:\W+\w+){0,5}\W+model|Nori['’]s own model)`
const ACTIVE_TRAINING_CLAIM = new RegExp(
  String.raw`\b${SON_SUBJECT}[^.!?]{0,120}?\b(?:is|are|was|were|has been|have been)\s+(?:(?:currently|already|actively)\s+)?(?:being\s+)?(?:trained|training|fine[- ]tuned|fine[- ]tuning|serving)\b|\b${SON_SUBJECT}[^.!?]{0,120}?\b(?:training|fine[- ]tuning)\s+(?:has started|is underway|is ongoing|is in progress)\b`,
  'i',
)

function lastUserText(messages) {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === 'user' && typeof message.content === 'string') return message.content
  }
  return ''
}

export function needsSonStatusFactCheck(messages) {
  const latest = lastUserText(messages)
  if (/\b(?:fictional|imagine|story|hypothetical|roleplay|pretend)\b/i.test(latest)) return false
  return MENTIONS_NORI_OR_SON.test(latest) && MODEL_STATUS_TERMS.test(latest)
}

/** Return a grounded replacement only when a status answer contradicts Nori's canonical identity facts. */
export function correctUnsupportedSonStatusClaim(messages, response) {
  if (!needsSonStatusFactCheck(messages) || typeof response !== 'string') return null
  if (!/custom SoN training project has been retired/i.test(NORI_PERSONA)) return null
  if (!ACTIVE_TRAINING_CLAIM.test(response) && !/\b(?:Nori[- ]?20B(?:\s+SoN)?|SoN)\b[^.!?]{0,120}\b(?:is|remains)\s+(?:the |a |our )?(?:target|goal|future model)\b/i.test(response)) return null
  return 'The custom SoN training project has been retired. Nori uses imported local models; this conversation does not train their weights.'
}
