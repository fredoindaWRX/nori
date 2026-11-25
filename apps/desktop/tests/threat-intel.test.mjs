// Threat-intel brief (Wil, 2026-11-14): CISA KEV + ransomware.live through the guarded reader; no Tor.
import test from 'node:test'
import assert from 'node:assert/strict'
import { requestsThreatIntel, parseKevText, parseRansomwareText, composeThreatBrief, threatBrief, THREAT_SOURCES, matchOwnerStack } from '../bridge/threat-intel.mjs'

// Shapes copied from the real reader output on 2026-11-14 (shortened).
const KEV = 'JSON Schema (updated 09-02-2026) License Showing 1 to 20 of 1781 results Check Point | Multiple Products CVE-2026-123039 Check Point Multiple Products Incorrect Permission Assignment for Critical Resource Vulnerability: Check Point Firewall ... Known To Be Used in Ransomware Campaigns? Unknown Forensic triage required per BOD 26-04: Yes Date Added: 2026-11-13 Due Date: 2026-11-16 Action: Apply mitigations ... https://nvd.nist.gov/vuln/detail/CVE-2026-123039 Google | Chromium CVE-2026-125350 Google Chromium Use-After-Free Vulnerability: Google Chromium contains ... Known To Be Used in Ransomware Campaigns? Known Date Added: 2026-11-10 Due Date: 2026-11-24 Notes: https://nvd.nist.gov/vuln/detail/CVE-2026-125350 OpenBSD | OpenSSH CVE-2026-123158 OpenBSD OpenSSH Race Condition Vulnerability: ... Known To Be Used in Ransomware Campaigns? Unknown Date Added: 2026-11-09 Due Date: 2026-11-30'
const RL = 'Not Found Grundbaulabor Trier GmbH Everest Discovered: 2026-11-14 (2h ago) text… Final Notice Before Publication Everest Discovered: 2026-11-13 (7h) New Group i*t*r***t.com Curious Worm Discovered: 2026-11-13 New Group t**a.com Curious Worm Discovered: 2026-11-13 RE/MAX Germany Panzer Discovered: 2026-11-12'

test('only threat-intel requests route here', () => {
  for (const q of ['threat intel brief', 'give me a security briefing', 'what is being actively exploited right now', 'latest CVEs', 'ransomware news', 'any new zero-days?'])
    assert.equal(requestsThreatIntel(q), true, q)
  for (const q of ['tell me a joke', 'what is ransomware', 'do not give me a threat brief', 'search the dark web']) assert.equal(requestsThreatIntel(q), false, q)
})

test('KEV entries parse with clean vendor, product, dates and ransomware flag', () => {
  const kev = parseKevText(KEV)
  assert.deepEqual(kev.map(e => [e.cve, e.vendor, e.product, e.added, e.ransomware]), [
    ['CVE-2026-123039', 'Check Point', 'Multiple Products', '2026-11-13', false],
    ['CVE-2026-125350', 'Google', 'Chromium', '2026-11-10', true],
    ['CVE-2026-123158', 'OpenBSD', 'OpenSSH', '2026-11-09', false]])
  assert.deepEqual(matchOwnerStack(kev[1]), ['Chrome / Chromium / Brave / Electron'])
})

test('ransomware postings become group counts, two-word groups when they recur, no victim names', () => {
  const items = parseRansomwareText(RL)
  assert.deepEqual(items.map(i => i.group), ['Everest', 'Everest', 'Curious Worm', 'Curious Worm', 'Panzer'])
  const brief = composeThreatBrief({ kev: parseKevText(KEV), ransomware: items, now: new Date('2026-11-14T06:00:00Z') })
  assert.match(brief, /Touches your setup:\n- CVE-2026-125350, Google Chromium/)
  assert.match(brief, /OpenSSH \(Windows, Git\)/)
  assert.match(brief, /Most active: Everest \(2\), Curious Worm \(2\), Panzer \(1\)/)
  assert.doesNotMatch(brief, /Grundbaulabor|RE\/MAX/)
  assert.match(brief, /nothing was run or downloaded/)
})

test('reads exactly the two fixed sources through the Core reader and reports a source it could not read', async () => {
  const asked = []
  const graph = async (capability, request) => {
    asked.push([capability, request])
    if (request.url === THREAT_SOURCES.kev) return { status: 'completed', result: { url: request.url, text: KEV } }
    throw Error('denied by hard floor')
  }
  const brief = await threatBrief({ graph, now: new Date('2026-11-14T06:00:00Z') })
  assert.deepEqual(asked.map(([c, r]) => [c, r.operation, r.url]).sort(), [['browser', 'inspect', THREAT_SOURCES.kev], ['browser', 'inspect', THREAT_SOURCES.ransomware]].sort())
  assert.match(brief, /could not read ransomware\.live/)
  assert.match(brief, /Not read: ransomware\.live \(denied by hard floor\)/)
  await assert.rejects(threatBrief({ graph: async () => { throw Error('offline') } }), /could not read either/)
})
