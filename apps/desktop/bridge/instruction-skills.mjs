/** Reviewed instruction data, not executable skills or additional authority. */
import { openSync, readSync, closeSync, fstatSync, realpathSync, lstatSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { managedInstructionSkillContext } from './managed-instruction-skills.mjs'
import { selfImprovementReference, loopEngineeringReference } from './self-improvement-reference.mjs'

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const rules = [
  ['async-parallel', 'ff95abbb67b62a889d7ef71f1d06834238c47ecd3d49483f7823b4cd17d92680'],
  ['rerender-functional-setstate', 'e46096d4c2c8fc89ab717bd7e56b8a884b612a88013a99b0c63e7dfc45d8cf25'],
]
const localSkillGuides = [
  ['writing-guidelines', /\b(?:review|audit|check)\b.*\b(?:writing|prose|docs?|tone|voice|style)\b|\b(?:writing|prose)\s+(?:guidelines|style)\b/i, 'c28458a39d09a2fb7d6459eb7311d1a30c7c7f17069ad28132031b916d74d269'],
  ['web-design-guidelines', /\b(?:review|audit|check)\b.*\b(?:ui|ux|accessibility|design|interface|web page)\b|\b(?:accessibility|web interface)\s+guidelines\b/i, '17e48da905f83a19c174079b50760a98c069527ba50079239b3c187236627c29'],
  ['vercel-optimize', /\bvercel\b.*\b(?:cost|performance|optimization|optimi[sz]e|slow|billing|usage|metrics|function invocations|build minutes)\b/i, '3675219c3b9622513696dd359ff70a8fa38c0b3c3b554b237e10f2b4807fcfb3'],
  ['vercel-cli-with-tokens', /\bvercel\b.*\b(?:token|environment variables|deploy|deployment|cli)\b/i, '238d7b90660e02c4bc4bf18084aef11923e3f95385fb54e436e0d264a59c8b08'],
  ['react-view-transitions', /\b(?:react|next\.js)\b.*\b(?:view transitions?|route transitions?|animate route|shared element|transition api)\b|\b(?:ViewTransition|startViewTransition|transition types)\b/i, 'a7b2831ef90e3f3a75d6380ec5532988a1d1c9b2eb431a7e67ae2cb471030f41'],
  ['react-native-skills', /\b(?:react native|expo|mobile performance|native modules|mobile app)\b/i, 'aff91057282facb41ddc8873a482e19cfb928056fc32b350e1b084b16cb58dc2'],
  ['deploy-to-vercel', /\b(?:deploy|publish|push|create preview)\b.*\bvercel\b|\bvercel\b.*\b(?:deploy|preview deployment|production deployment)\b/i, '0df550ec39472fa202d752754fddf797b5b7a605cf63aaad06462aea577aa6a7'],
  ['composition-patterns', /\b(?:react|component|component library)\b.*\b(?:composition pattern|compound component|render prop|boolean props|reusable api)\b/i, 'fb8f849b4d46c0c4d364ae6fb398a5cb693b54f9a4c31765a1ec0689c7cb93d5'],
  ['react-best-practices', /\b(?:react|next\.js|jsx|tsx)\b.*\b(?:performance|refactor|data fetching|bundle|component|best practices)\b/i, '3286ace648b4d740317b9c1cb7fbd38600eaacc62a8b57ea5e06fd2992b5582e'],
]
const localReferences = [
  {
    name: 'nori-linux-graphics-investigator',
    manifestSha256: '1ee8625acc4a3b0ce9adb9631c7cc5d6b8235cc386773d7d673d33222ff1dada',
    matches: /\b(?:linux|mesa|graphics|gpu|alpha|t2\s*sde|desktop driver)\b/i,
    maxBytes: 8192,
    promptGuidance: 'QEMU virtual graphics/software rendering are not real-GPU acceleration. Separate CPU/ABI from GPU/driver/API support. Verify exact hardware with primary sources; a video/build is not proof. No host/device changes.',
  },
  {
    name: 'nori-rea',
    manifestSha256: '40cd7ee4dc0710cba25cc024626bcb1d1ba32765f04871fec99383504bfbd179',
    matches: /\b(?:rea|reverse[- ]engineering agent|reverse engineer(?:ing)?)\b/i,
    maxBytes: 8192,
    promptGuidance: 'Nori checks REA by verifying Node.js/package identity, starting its own local stdio MCP client, and reading tools/list. The native local-chat bridge can invoke only its own registered REA actions: analyze_javascript_application, open_binary, binary_overview, and export_evidence_bundle for one exact quoted user-selected built app folder, .asar, .exe, or .dll, passing the target through Neuralese and retaining a digest-verified Evidence bundle. The server-advertised catalog is not the same as Nori-wired actions. Do not run setup for Codex or alter another agent config. The separate nori-rea skill remains a plan-only reference and grants no execution authority. Source-runtime synthetic JavaScript analysis and a live MCP handshake passed; packaged desktop display and live native-binary analysis remain unverified. Do not claim an analysis occurred unless that specific call returns a verified receipt. Answer the latest question directly; if asked “you know REA?”, explain what REA is and the current limits.',
  },
]

function readPinnedManifest(path, expectedHash, maxBytes) {
  let fd
  try {
    if (realpathSync(path).toLowerCase() !== path.toLowerCase() || lstatSync(path).isSymbolicLink()) return null
    fd = openSync(path, 'r')
    const info = fstatSync(fd)
    if (!info.isFile() || info.size < 1 || info.size > maxBytes) return null
    const buffer = Buffer.alloc(maxBytes + 1)
    const length = readSync(fd, buffer, 0, buffer.length, 0)
    if (length !== info.size || realpathSync(path).toLowerCase() !== path.toLowerCase()) return null
    const raw = buffer.subarray(0, length)
    if (createHash('sha256').update(raw).digest('hex') !== expectedHash) return null
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))
  } catch { return null }
  finally { if (fd !== undefined) closeSync(fd) }
}

function readPinnedText(path, expectedHash, maxBytes) {
  let fd
  try {
    if (realpathSync(path).toLowerCase() !== path.toLowerCase() || lstatSync(path).isSymbolicLink()) return null
    fd = openSync(path, 'r')
    const info = fstatSync(fd)
    if (!info.isFile() || info.size < 1 || info.size > maxBytes) return null
    const buffer = Buffer.alloc(maxBytes + 1)
    const length = readSync(fd, buffer, 0, buffer.length, 0)
    if (length !== info.size || realpathSync(path).toLowerCase() !== path.toLowerCase()) return null
    const raw = buffer.subarray(0, length)
    if (createHash('sha256').update(raw).digest('hex') !== expectedHash) return null
    return new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch { return null }
  finally { if (fd !== undefined) closeSync(fd) }
}

export function instructionSkillContext(goal, root = process.env.NORI_SUITE_ROOT || defaultRoot) {
  if (typeof goal !== 'string') return ''
  const selected = []
  const installed = managedInstructionSkillContext(goal)
  if (installed) selected.push(installed)
  const improvement = selfImprovementReference(goal)
  if (improvement) selected.push(improvement)
  const loop = loopEngineeringReference(goal)
  if (loop) selected.push(loop)
  for (const [name, matches, hash] of localSkillGuides) {
    if (!matches.test(goal)) continue
    const path = resolve(root, 'skills', 'incoming', 'vercel-agent-skills', 'skills', name, 'SKILL.md')
    const source = readPinnedText(path, hash, 24000)
    if (!source) continue
    const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim()
    if (!body || body.length > 24000) continue
    // Include a short, hash-pinned excerpt only. It is untrusted reference
    // material, never executable code, credentials, or an authority grant.
    selected.push(`[${name}; Vercel skill reference; pinned, non-executable]\n${body.slice(0, 1200)}`)
    if (selected.length >= 2) break
  }
  if (/\b(?:react|tsx|jsx|useState|useCallback)\b/i.test(goal)) {
    const base = resolve(root, 'skills/incoming/vercel-agent-skills/skills/react-best-practices/rules')
    for (const [name, hash] of rules) {
      if (/\b(?:useState|useCallback|state)\b/i.test(goal) ? name !== 'rerender-functional-setstate' : name !== 'async-parallel') continue
      const path = resolve(base, `${name}.md`)
      try {
        if (realpathSync(path).toLowerCase() !== path.toLowerCase() || lstatSync(path).isSymbolicLink()) continue
        let fd, raw
        try {
          fd = openSync(path, 'r')
          const info = fstatSync(fd)
          if (!info.isFile() || info.size < 1 || info.size > 16000) continue
          const buffer = Buffer.alloc(16001)
          const length = readSync(fd, buffer, 0, buffer.length, 0)
          if (length !== info.size || realpathSync(path).toLowerCase() !== path.toLowerCase()) continue
          raw = buffer.subarray(0, length)
        } finally { if (fd !== undefined) closeSync(fd) }
        if (raw.length > 16000 || createHash('sha256').update(raw).digest('hex') !== hash) continue
        new TextDecoder('utf-8', { fatal: true }).decode(raw)
        // Keep the prompt small; full source remains pinned, never executed.
        const guidance = name === 'async-parallel'
          ? 'Run independent async work with Promise.all; keep dependencies ordered and preserve error handling.'
          : 'Use the existing setter; never reassign it. Prior-state update: setCount(p=>p+1).'
        selected.push(`[${name}; Vercel MIT] ${guidance}`)
      } catch { /* Missing/changed instruction data is not evidence of an installed skill. */ }
    }
  }
  for (const reference of localReferences) {
    if (!reference.matches.test(goal)) continue
    const path = resolve(root, 'skills', reference.name, 'skill.json')
    const manifest = readPinnedManifest(path, reference.manifestSha256, reference.maxBytes)
    if (manifest?.schema !== 'nori.skill-candidate.v1' || manifest?.name !== reference.name
        || manifest?.status !== 'candidate' || manifest?.authority !== 'none'
        || manifest?.execution !== 'plan_only'
        || typeof manifest?.nori_reference_guidance !== 'string'
        || manifest.nori_reference_guidance.length > 2000) continue
    selected.push(`[${reference.name}; candidate reference; inactive, non-executable]\n${reference.promptGuidance}`)
  }
  if (!selected.length) return ''
  return '[Reference data; no additional authority]\n' + selected.join('\n\n')
}
