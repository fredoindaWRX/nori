// Threat-intel brief (Wil, 2026-11-14: "make the threat intel skill for nori"; chosen instead of a Tor/dark-web
// tool). Two public, clearnet sources read through Nori's guarded Apoc reader (Core hard floor, HTML only):
//   - CISA Known Exploited Vulnerabilities catalog: the ~17-20 newest entries, newest first.
//   - ransomware.live front page: recent leak-site postings with the group that posted them.
// No Tor, no dark web, no logins, no downloads, nothing run. The page text is untrusted data; this module only
// extracts dates, IDs, vendor/product names and group names, and writes the brief itself.
import { coreGraph } from './research-tools.mjs'

export const THREAT_SOURCES = Object.freeze({
  kev: 'https://www.cisa.gov/known-exploited-vulnerabilities-catalog',
  ransomware: 'https://www.ransomware.live/',
})

// Software on Wil's machines, used to flag "this one touches your setup". Vendor/product text only.
export const OWNER_STACK = Object.freeze([
  ['Microsoft Windows', /\bwindows\b|\bwin32k\b|\bntfs\b|\bsmb\b|\bkernel\b.*\bmicrosoft\b|\bmicrosoft\b.*\b(kernel|windows)\b/i],
  ['Microsoft Edge / WebView2', /\bedge\b|\bwebview/i],
  ['Chrome / Chromium / Brave / Electron', /\bchrom(e|ium)\b|\bbrave\b|\belectron\b|\bv8\b|\bskia\b|\bangle\b/i],
  ['NVIDIA driver / CUDA', /\bnvidia\b/i],
  ['AMD driver / Adrenalin', /\bamd\b|\bradeon\b/i],
  ['Node.js', /\bnode\.?js\b/i],
  ['Python', /\bpython\b/i],
  ['Git', /\bgit\b(?!lab)/i],
  ['OBS Studio', /\bobs\b/i],
  ['Discord', /\bdiscord\b/i],
  ['Unity', /\bunity\b/i],
  ['WSL / Hyper-V', /\bhyper-?v\b|\bwsl\b/i],
  ['llama.cpp / Ollama', /\bllama\.?cpp\b|\bollama\b/i],
  ['7-Zip / WinRAR', /\b7-?zip\b|\bwinrar\b/i],
  ['OpenSSH (Windows, Git)', /\bopenssh\b/i],
])

export function requestsThreatIntel(goal = '') {
  const text = String(goal)
  if (/\b(?:don't|do not|never)\b[^.]{0,30}\bthreat/i.test(text)) return false
  return /\bthreat[\s-]*(?:intel(?:ligence)?|brief|report|update)\b/i.test(text)
    || /\b(?:security|cyber(?:security)?)\s+(?:brief|briefing|news|update|report)\b/i.test(text)
    || /\b(?:what(?:'s|\s+is|\s+are)|which)\b[^.?]{0,40}\b(?:being\s+exploited|actively\s+exploited|exploited\s+vulnerabilit)/i.test(text)
    || /\b(?:new|latest|recent)\s+(?:cves?|kevs?|exploited\s+vulnerabilit\w*|zero[\s-]?days?)\b/i.test(text)
    || /\bransomware\s+(?:news|activity|attacks?|gangs?|groups?|update|report)\b/i.test(text)
    || /\b(?:cisa\s+)?kev\s+(?:catalog|list|update)\b/i.test(text)
}

const clip = (value, size) => { const line = String(value ?? '').replace(/\s+/g, ' ').trim(); return line.length > size ? `${line.slice(0, size - 1)}…` : line }

// KEV page text: "... Vendor | Product CVE-YYYY-N Name: description ... Known To Be Used in Ransomware Campaigns? Known|Unknown ... Date Added: D Due Date: D ..."
export function parseKevText(text) {
  const source = String(text ?? '')
  const heads = [...source.matchAll(/([A-Z0-9][\w.&()'’+\-/ ]{0,60}?) \| ([\w.&()'’+\-/ ]{1,90}?) (CVE-\d{4}-\d{4,8}) /g)]
  const entries = []
  for (let i = 0; i < heads.length; i++) {
    const head = heads[i], end = i + 1 < heads.length ? heads[i + 1].index : source.length
    const body = source.slice(head.index + head[0].length, end)
    const added = body.match(/Date Added: (\d{4}-\d{2}-\d{2})/)?.[1]
    if (!added) continue
    // The previous entry ends with its NVD link (".../CVE-…") and the first with "…results"; drop that tail.
    const vendor = clip(head[1].replace(/^.*(?:CVE-\d{4}-\d{4,8}|results)\s+/, ''), 60)
    entries.push({ cve: head[3], vendor, product: clip(head[2], 90), name: clip(body.split(':')[0], 140), added,
      due: body.match(/Due Date: (\d{4}-\d{2}-\d{2})/)?.[1] ?? null,
      ransomware: /Known To Be Used in Ransomware Campaigns\? Known/i.test(body) })
  }
  const seen = new Set()
  return entries.filter(entry => !seen.has(entry.cve) && seen.add(entry.cve))
}

// ransomware.live front page: "... <victim> <Group> Discovered: YYYY-MM-DD ...". The victim/group split is
// approximate, so the brief reports groups and counts only, never victim names.
export function parseRansomwareText(text) {
  const source = String(text ?? '')
  const items = [...source.matchAll(/((?:[A-Z][\w-]*\s){0,1}[A-Za-z0-9][\w.-]*) Discovered: (\d{4}-\d{2}-\d{2})/g)]
  const pairs = new Map()
  for (const item of items) pairs.set(item[1], (pairs.get(item[1]) ?? 0) + 1)
  return items.map(item => {
    const words = item[1].split(' ')
    // Two-word group only when that exact pair recurs on the page (e.g. "Curious Worm"); otherwise the last word.
    const group = words.length === 2 && pairs.get(item[1]) >= 2 ? item[1] : words.at(-1)
    return { group: clip(group, 40), discovered: item[2] }
  })
}

export function matchOwnerStack(entry) {
  const text = `${entry.vendor} ${entry.product} ${entry.name}`
  return OWNER_STACK.filter(([, pattern]) => pattern.test(text)).map(([label]) => label)
}

export function composeThreatBrief({ kev = [], ransomware = [], now = new Date(), errors = [] } = {}) {
  const lines = []
  const today = now.toISOString().slice(0, 10)
  if (kev.length) {
    const newest = kev[0].added
    const recent = kev.filter(entry => entry.added >= isoDaysBefore(now, 7))
    const mine = kev.map(entry => ({ entry, hits: matchOwnerStack(entry) })).filter(item => item.hits.length)
    lines.push(`**Actively exploited vulnerabilities (CISA KEV)**: ${recent.length} added in the last 7 days; newest added ${newest}.`)
    if (mine.length) {
      lines.push('Touches your setup:')
      for (const { entry, hits } of mine.slice(0, 6)) lines.push(`- ${entry.cve}, ${entry.vendor} ${entry.product} (${hits.join(', ')}). Added ${entry.added}${entry.ransomware ? ', used by ransomware' : ''}. Update it.`)
    } else lines.push('None of the newest entries match the software on your PCs (Windows, Chrome/Electron, NVIDIA, AMD, OBS and the rest).')
    const others = kev.filter(entry => !mine.some(item => item.entry === entry)).slice(0, 6)
    if (others.length) {
      lines.push('Other new entries:')
      for (const entry of others) lines.push(`- ${entry.cve}, ${entry.vendor} ${entry.product}: ${entry.name}. Added ${entry.added}${entry.ransomware ? ', used by ransomware' : ''}.`)
    }
  } else lines.push('**CISA KEV**: I could not read the catalog this time.')
  if (ransomware.length) {
    const byGroup = new Map()
    for (const item of ransomware) byGroup.set(item.group, (byGroup.get(item.group) ?? 0) + 1)
    const top = [...byGroup].sort((a, b) => b[1] - a[1]).slice(0, 5)
    const days = [...new Set(ransomware.map(item => item.discovered))].sort()
    lines.push('', `**Ransomware leak sites (ransomware.live)**: ${ransomware.length} new victim postings from ${days[0]} to ${days.at(-1)}.`,
      `Most active: ${top.map(([group, count]) => `${group} (${count})`).join(', ')}. Group names are read from the page and may be approximate.`)
  } else lines.push('', '**Ransomware**: I could not read ransomware.live this time.')
  if (errors.length) lines.push('', `Not read: ${errors.join('; ')}.`)
  lines.push('', `Sources: ${THREAT_SOURCES.kev} and ${THREAT_SOURCES.ransomware}, read ${today} through my guarded web reader. This is public clearnet data; nothing was run or downloaded.`)
  return lines.join('\n')
}

function isoDaysBefore(now, days) { return new Date(now.getTime() - days * 86400_000).toISOString().slice(0, 10) }

export async function threatBrief({ environment = process.env, fetcher, signal, graph = coreGraph, now = new Date() } = {}) {
  const read = async url => {
    const output = await graph('browser', { operation: 'inspect', url }, { environment, fetcher, signal })
    if (output?.result?.url !== url || typeof output.result.text !== 'string') throw Error('reader returned no page')
    return output.result.text
  }
  const errors = []
  const [kevText, ransomwareText] = await Promise.all([
    read(THREAT_SOURCES.kev).catch(error => { errors.push(`CISA KEV (${clip(error.message, 80)})`); return '' }),
    read(THREAT_SOURCES.ransomware).catch(error => { errors.push(`ransomware.live (${clip(error.message, 80)})`); return '' }),
  ])
  const kev = parseKevText(kevText), ransomware = parseRansomwareText(ransomwareText)
  if (!kev.length && !ransomware.length) throw Error(`I could not read either threat source. ${errors.join('; ')}`)
  return composeThreatBrief({ kev, ransomware, now, errors })
}
