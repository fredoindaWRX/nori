import { localChat } from './local-chat.mjs'

const PRIVATE_CONTENT = /\b(?:password|passcode|one[- ]time code|verification code|recovery code|private message|direct message|email body|bank account|credit card|social security|medical record)\b/i

/** Turn the local vision model's response into a deliberately narrow alert. */
export function parseScreenAlert(value) {
  const text = String(value ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  if (/^(?:NO_ALERT|NONE|NO ISSUES?)(?:[.!\s]*)$/i.test(text)) return null
  const match = text.match(/^ALERT:\s*(.{1,320})$/is)
  if (!match) return null
  const alert = match[1].replace(/\s+/g, ' ').trim()
  if (!alert || alert.split(/\s+/).length > 34 || PRIVATE_CONTENT.test(alert)) return null
  return alert
}

/** Analyze only a frame explicitly shared by the user; local Ollama only. */
export async function inspectSharedScreen(data, { signal } = {}) {
  if (typeof data !== 'string' || data.length > 3_000_000) throw new Error('Invalid screen frame.')
  let output = ''
  for await (const chunk of localChat({
    goal: [
      'You are Nori Vision, a privacy-conscious screen monitor.',
      'Inspect this one user-shared screenshot only for a clear, actionable software error, crash, security warning, or obvious task blocker that the user may want to know about immediately.',
      'Do not transcribe, summarize, or mention ordinary screen contents, people, messages, documents, notifications, account details, or personal data.',
      'Do not recommend clicking, sending, deleting, purchasing, or changing settings.',
      'If no clear blocker/error exists, reply exactly NO_ALERT.',
      'Otherwise reply exactly ALERT: followed by one brief sentence under 25 words. Do not include secrets or quote screen text.',
    ].join(' '),
    turns: [],
    profile: 'lightning-fast',
    images: [data],
    signal,
  })) {
    output += chunk
    if (output.length > 1200) break
  }
  return parseScreenAlert(output)
}
