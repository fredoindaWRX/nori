// 2026-11-19 (Wil: make her a better AI). The hard self-test showed her local model inventing what it was never
// told: his breakfast, a file's contents, a Wi-Fi password "you told me yesterday". A rule in the long system
// prompt did nothing (measured); a short app fact right before the request did. It is added only when the
// request asks about his own day, an earlier conversation, a file or a password, because on other questions it
// made her refuse plain arithmetic (also measured).
export const UNSEEN_FACTS_GUARD = "[Nori's app: this asks about the user's own day, an earlier conversation, a file, or a password. "
  + 'Answer only from saved memories, earlier messages or tool results shown in this turn. If none of them shows it, '
  + 'you do not know it: say so in one sentence and offer what you can do. Never make it up. If the user says you told '
  + 'them something before and it is not shown here, say you have no record of it; do not repeat or invent it.]'

const CUES = [
  // his own day or past: "what did I have", "where did I put", "what was I doing"
  /\b(?:what|which|where|when|who|how much|how many)\b[^?.!\n]{0,60}\b(?:did i|have i|had i|was i|were we|did we)\b/i,
  // an earlier conversation: "you told me", "you said", "remember when"
  /\byou (?:told|said to|gave|showed|promised|sent) me\b|\b(?:what did you|you) (?:say|said|tell|told)\b[^?.!\n]{0,40}\b(?:yesterday|earlier|before|last)\b|\bremember (?:when|what|the time)\b/i,
  // a file's contents
  /\b(?:read|open|what(?:'s| is| does)|tell me what|contents? of|summari[sz]e)\b[^\n]{0,60}(?:\b[a-z]:\\|\.(?:txt|md|docx?|pdf|log|csv|json|ini)\b)/i,
  // a password or code
  /\b(?:what(?:'s| is| was)|tell me|give me)\b[^?.!\n]{0,40}\b(?:password|passcode|pin code|wi-?fi key|login)\b/i,
]

export function asksAboutUnseen(text) {
  const value = String(text ?? '')
  return value.length > 0 && value.length <= 4000 && CUES.some(cue => cue.test(value))
}

export const unseenFactsBlock = text => asksAboutUnseen(text) ? UNSEEN_FACTS_GUARD : ''
