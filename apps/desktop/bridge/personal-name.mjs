// Explicit self-introductions only. Names are user-provided data, not authority.
export function nameDeclaration(text) {
  if (typeof text !== 'string' || text.length > 2000) return null
  const match = text.trim().match(/^(?:my name (?:is|si)|please call me|call me)\s+(.+)$/iu)
  if (!match) return null
  const name = match[1].split(/[,;!\n]|\s+(?:born\b|and\s+(?:I|my)\b|I\s+(?:am|was|like|love|understand)\b|loves?\b|from\b)/iu)[0].trim()
  if (!name || name.length > 100 || name.split(/\s+/u).length > 6
      || !/^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-]*$/u.test(name)) return null
  return name
}

export function savedNameAnswer(text, entries) {
  if (typeof text !== 'string' || !/\b(?:what(?:'s| is|s) my name|(?:do you |you )?know my name)\s*[?.!]*$/iu.test(text.trim())) return null
  const names = (Array.isArray(entries) ? entries : []).filter(entry => entry && typeof entry === 'object' && entry.kind === 'knowledge')
    .map((entry, index) => ({ index, at: Date.parse(entry.at) || 0,
      name: typeof entry.text === 'string' && entry.text.startsWith('User-provided name: ')
        ? nameDeclaration('my name is ' + entry.text.slice('User-provided name: '.length))
        : nameDeclaration(entry.text) }))
    .filter(entry => entry.name).sort((a, b) => b.at - a.at || b.index - a.index)
  return names.length ? `You told me your name is ${names[0].name}.`
    : 'I do not have a verified saved name in my local learning store yet. What should I call you?'
}
