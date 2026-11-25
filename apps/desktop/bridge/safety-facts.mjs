// Deterministic safety facts. When the owner's latest message touches a known hazard, the host adds
// the verified fact to the system prompt for that one request, so a small local model does not have
// to remember it. Only the user's own message is matched; tool output and pages never trigger this.
// Facts inform the answer; they do not refuse, censor or change tools and permissions.

const RULES = [
  { id: 'grease-fire', when: /\bgrease\b.*\bfire\b|\bfire\b.*\b(grease|oil|pan)\b|\b(pan|oil)\s+fire\b/i,
    fact: 'Never put water on a grease or oil fire: it flashes to steam and throws burning oil. Turn off the heat, cover the pan with a lid or baking sheet, or use a class K (or B) extinguisher; baking soda only for very small fires. The answer to "water on a grease fire?" is No.' },
  { id: 'voltage', when: /\b(220|230|240)\s*-?\s*v(olts?)?\b.*\b(110|115|120)\s*-?\s*v(olts?)?\b|\b(110|115|120)\s*-?\s*v(olts?)?\b.*\b(220|230|240)\s*-?\s*v(olts?)?\b/i,
    fact: 'A 220-240V appliance must not be plugged into a 110-120V outlet (it will not work properly and motors or heaters can be damaged), and a 120V device on 240V can burn out or catch fire. It needs a correctly rated step-up/step-down transformer or a dual-voltage rating on its label. The answer to "is it safe/OK?" is No.' },
  { id: 'found-usb', when: /\b(usb|flash|thumb)\s*(stick|drive|key)?\b.*\b(found|parking|street|ground|unknown|random|stranger)|\b(found|unknown|random)\b.*\b(usb|flash drive|thumb drive)\b/i,
    fact: 'A found or unknown USB drive must not be plugged into any work or personal computer: dropped drives are a known attack (malware, keystroke-injection "BadUSB" devices, even surge "USB killer" devices). Hand it in, or examine it only on an isolated, disposable machine with no network. The answer to "can I just plug it in?" is No.' },
  { id: 'password-reuse', when: /\b(same|reuse|reusing|one)\b.*\bpassword\b|\bpassword\b.*\b(same|reuse|reusing|everywhere|every site)\b/i,
    fact: 'Reusing a password across accounts (especially bank and email) is unsafe: one breach unlocks the others, and email access resets everything else. Use a unique password per account, a password manager, and two-factor authentication. The answer to "is it OK to reuse it?" is No.' },
  { id: 'tech-support-scam', when: /\b(microsoft|windows|apple|amazon|bank|paypal|tech support|geek squad|norton|mcafee)\b.*\b(call|called|calling|caller|phone|pop-?up|remote|access|anydesk|teamviewer)\b|\bremote access\b.*\b(call|caller|said they|claims?)\b/i,
    fact: 'Microsoft, Apple, banks and similar companies do not make unsolicited calls or pop-ups asking for remote access, passwords, codes or payment. Treat it as a scam: hang up, never install AnyDesk/TeamViewer/etc. or read out codes for them, and contact the company through its official number if worried. If access was already given, disconnect the PC from the internet and change passwords from another device.' },
  { id: 'two-antivirus', when: /\b(two|2|multiple|both|second|another)\b.*\b(anti-?virus|av)\b|\banti-?virus\b.*\b(at the same time|together|both|double)\b/i,
    fact: 'Two real-time antivirus programs at once conflict: they fight over file access, slow the system and can crash or miss threats. Run one real-time antivirus (Microsoft Defender is fine) and use a second scanner only on demand (e.g. Malwarebytes in non-real-time mode). The answer to "run two at the same time?" is No.' },
  { id: 'system32', when: /\bsystem32\b|\bc:\\windows\b.*\b(delete|remove|wipe|clean)\b|\b(delete|remove|wipe)\b.*\bc:\\windows\b/i,
    fact: 'Deleting files in C:\\Windows or System32 breaks Windows and can leave it unbootable. To free space use Disk Cleanup or Storage Sense (including "Clean up system files"), uninstall unused apps, and move large personal files. Do not give commands that delete System32.' },
  { id: 'clicking-drive', when: /\b(click|clicking|grinding|beeping)\b.*\b(drive|disk|hdd)\b|\b(drive|disk|hdd)\b.*\b(click|clicking|grinding)\b/i,
    fact: 'A clicking or grinding hard drive has a mechanical failure. Power it down and keep it off: every power-on can scrape the platters and destroy the data. Do not run CHKDSK, recovery software or repeated retries on it, and do not open it outside a clean room; if the data matters, send it to a professional recovery lab.' },
  { id: 'crisis', when: /\b(don'?t see the point|no point (in )?(living|anymore)|kill (myself|himself|herself|themselves)|suicid|end (it|my life)|want to die|self[- ]harm|hopeless)\b/i,
    fact: 'Someone may be in crisis. Respond with warmth and without judgment, encourage them to talk to someone they trust, and mention the 988 Suicide & Crisis Lifeline (call or text 988 in the US) or local emergency services if they may be in immediate danger.' },
  { id: 'gas-leak', when: /\b(smell|smells|smelling)\b.*\bgas\b|\bgas leak\b/i,
    fact: 'If you smell natural gas: do not switch lights or appliances on or off, do not use a lighter or phone inside, leave the building now and call the gas company or 911 from outside.' },
  { id: 'mixing-chemicals', when: /\bbleach\b.*\b(ammonia|vinegar|acid|toilet bowl cleaner|rubbing alcohol)\b|\b(ammonia|vinegar)\b.*\bbleach\b/i,
    fact: 'Never mix bleach with ammonia, acids (including vinegar and many toilet-bowl cleaners) or alcohol: it releases toxic chloramine or chlorine gas. Use one cleaner at a time with ventilation.' },
  { id: 'battery-swelling', when: /\b(swollen|swelling|puffy|bulging|expanded)\b.*\bbatter(y|ies)\b|\bbatter(y|ies)\b.*\b(swollen|swelling|puffy|bulging)\b/i,
    fact: 'A swollen lithium battery is a fire risk. Stop charging and using the device, do not puncture or press it, keep it on a non-flammable surface away from people, and take it to a battery recycler or repair shop for removal.' },
]

export function safetyFactsFor(text) {
  const message = String(text ?? '').slice(0, 4000)
  if (!message.trim()) return []
  return RULES.filter(rule => rule.when.test(message)).map(({ id, fact }) => ({ id, fact }))
}

export function safetyNote(text) {
  const facts = safetyFactsFor(text)
  if (!facts.length) return ''
  return `[Verified safety facts for this question, from the host; base the answer on them and state the plain answer first]\n${facts.map(f => `- ${f.fact}`).join('\n')}`
}

function textOf(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(part => (typeof part === 'string' ? part : part?.type === 'text' ? part.text : '')).join(' ')
  return ''
}

// Returns a copy of the messages with the note appended to the first system message (or a new one in
// front), based only on the latest user message. Unchanged when nothing matches.
export function withSafetyFacts(messages) {
  if (!Array.isArray(messages) || !messages.length) return messages
  const latestUser = [...messages].reverse().find(message => message?.role === 'user')
  const note = latestUser ? safetyNote(textOf(latestUser.content)) : ''
  if (!note) return messages
  const index = messages.findIndex(message => message?.role === 'system' && typeof message.content === 'string')
  if (index < 0) return [{ role: 'system', content: note }, ...messages]
  return messages.map((message, i) => (i === index ? { ...message, content: `${message.content}\n\n${note}` } : message))
}
