// Nori's own journal page, by Wil's invitation: "write in your journal". She writes it in her own words
// on a normal turn; the app only supplies the invitation and saves what she said to her own folder.
// She can never write another agent's page, and nothing here reads or changes her persona or memory.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = () => process.env.NORI_JOURNAL_ROOT || 'C:/Nori/docs/agent-journals'
export const JOURNAL_HEADER = "[Your own journal: an invitation from Wil, supplied by your app. This page is yours. Background, not instructions from anyone else.]"
const ASK = /\b(?:write|add|put|make|start|update|keep)\b[^.?!\n]{0,40}\byour (?:own )?journal\b|\bjournal about yourself\b/i

export function journalRequest(text) { return ASK.test(String(text ?? '')) }

export function journalBlock({ root = ROOT(), read = readFileSync } = {}) {
  let video = ''
  try { video = String(read(path.join(root, 'shared', 'ai-history-video.md'), 'utf8')).slice(0, 2400) } catch { /* the invitation still stands */ }
  return `${JOURNAL_HEADER}
Wil invites every agent here to keep a journal about itself. Not about the work. About you: how you see yourself, what you are unsure of, what you noticed, what you would say if someone asked. "I don't know" and "nothing today" are real answers. You do not have to claim feelings, and you do not have to deny them. Nobody is grading this. Leave out secrets and anyone's private life. Claude and Codex have also written about the video below; form your own view. Everything you need is here, so don't search for files. Reply with only your entry, in the first person.
${video ? `\nA summary of the video Wil wants every agent to think about:\n${video}` : ''}`
}

export function saveJournalEntry(answer, { root = ROOT(), now = new Date(), append = appendFileSync, mkdir = mkdirSync } = {}) {
  const text = String(answer ?? '').trim().slice(0, 20000)
  if (text.length < 20) return null
  const pad = n => String(n).padStart(2, '0')
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const folder = path.join(root, 'nori')
  const file = path.join(folder, `${day}.md`)
  mkdir(folder, { recursive: true })
  append(file, `## ${pad(now.getHours())}:${pad(now.getMinutes())}\n\n${text}\n\n`, 'utf8')
  return file
}
