/** Nori-only wake names; possessive mentions are not direct addresses. */
const NAME = '(?:nori|norrie|norry|norri)'
export const WAKE = new RegExp(`\\b(?:hey|hi|ok|okay|yo)?\\s*${NAME}\\b(?!['’]s\\b)`, 'i')
export const BARE_NAME = new RegExp(`^(?:hey|hi|ok|okay|yo)?\\s*${NAME}[\\s,.!?]*$`, 'i')
export const LEADING_NAME = new RegExp(`^(?:hey|hi|ok|okay|yo)?\\s*${NAME}\\b(?!['’]s\\b)[\\s,.:!?-]*`, 'i')

export function afterWake(text: string): string {
  const match = WAKE.exec(text)
  return match ? text.slice(match.index + match[0].length).replace(/^[\s,.:;!?-]+/, '').trim() : ''
}
