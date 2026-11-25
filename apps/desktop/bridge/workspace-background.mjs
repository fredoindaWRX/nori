// The interface sends a short "workspace background" with each message: the list of open tabs and their
// addresses. A picture Nori has just put on the display is a tab whose address is the whole image as a data: URL,
// which made that text longer than the bridge's 16,000-character limit, so the owner's NEXT message was rejected
// with "Invalid workspace background." (seen twice on 2026-11-17, each time right after an image turn).
// This trims what cannot be useful to the model anyway instead of failing the turn.
export const MAX_BACKGROUND = 16000
const DATA_URL = /data:[a-z0-9.+/-]{0,80}(?:;[a-z0-9=.+-]{0,40}){0,4},[A-Za-z0-9+/=%_.~-]{64,}/gi
const LONG_TOKEN = /[^\s"'()\[\],;]{600,}/g

/** The same background with embedded images and other very long unbroken strings replaced, and a hard length cap. */
export function tidyWorkspaceBackground(context, limit = MAX_BACKGROUND) {
  if (typeof context !== 'string') return context
  let text = context
  if (text.length > 400) {
    text = text.replace(DATA_URL, 'embedded image, not shown')
      .replace(LONG_TOKEN, token => `${token.slice(0, 120)}…(shortened)`)
  }
  return text.length > limit ? `${text.slice(0, limit - 16)}…(shortened)` : text
}
