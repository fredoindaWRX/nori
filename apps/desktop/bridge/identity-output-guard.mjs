/** Keep direct identity answers grounded in Nori's canonical persona context. */
import { isModelQuestion } from './host-facts.mjs'
const DIRECT_IDENTITY_QUESTION = /\b(?:who\s+am\s+i|do\s+you\s+know\s+who\s+i\s+am|what\s+is\s+my\s+name)\b/i
const NORI_SELF_IDENTITY_QUESTION = /\b(?:who\s+are\s+you|identify\s+yourself|what\s+is\s+your\s+(?:name|role|job|title)|what'?s\s+your\s+(?:name|role|job|title)|are\s+you\s+online|are\s+you\s+running)\b/i

function latestUserText(messages) {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === 'user' && typeof message.content === 'string') return message.content
  }
  return ''
}

export function needsIdentityFactCheck(messages) {
  const text = latestUserText(messages)
  if (isModelQuestion(text)) return false
  return DIRECT_IDENTITY_QUESTION.test(text) || NORI_SELF_IDENTITY_QUESTION.test(text)
}

/** Answer only the identity fact established by Nori's canonical system context. */
export function groundedIdentityAnswer(messages) {
  const text = latestUserText(messages)
  // "what model are you running" is a runtime fact answered by host-facts.mjs, not an identity question.
  if (isModelQuestion(text)) return null
  if (DIRECT_IDENTITY_QUESTION.test(text)) {
    return "I don't have a confirmed name for you in the active profile. I know you're building Nori, but I won't guess your name or other personal details."
  }
  if (NORI_SELF_IDENTITY_QUESTION.test(text)) {
    const online = /\b(?:are\s+you\s+online|are\s+you\s+running)\b/i.test(text)
    return `${online ? "I'm online in this response through Nori's local chat runtime. " : ''}I'm N.O.R.I., one continuous local desktop intelligence. I'm your COO: you set the vision and I run operations.`
  }
  return null
}
