/** Read-only host metadata, never model-generated claims or executable skills. */
import { readFileSync, lstatSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { managedInstructionCatalog } from './managed-instruction-skills.mjs'
import { userCreativeRoutingText } from './artcraft-tools.mjs'

export function requestsInstalledSkillCatalog(goal) {
  const original = userCreativeRoutingText(goal).trim()
  if (original.length > 20000) return false
  // A bounded no-mutation instruction must not turn a catalog read into an
  // installation request. Remove only whole, explicitly recognized clauses;
  // positive or ambiguous actions still fall through to their normal routes.
  const noMutationVerb = '(?:install|uninstall|remove|delete|change|edit|write|activate|execute|run)'
  const noMutationTarget = '(?:anything|files|code|software|packages?|(?:[a-z]:[\\\\/])?[\\w./\\\\-]+\\.(?:py|js|mjs|cjs|ts|tsx|jsx|c|cpp|h|cs|rs|go|java|rb|sh|ps1))'
  const prohibitedAction = noMutationVerb + '(?:\\s+(?:or|and)\\s+' + noMutationVerb + ')*\\s+' + noMutationTarget
  const restriction = new RegExp('(?:^|[.!?;\\n]\\s*)(?:do not|don[\u2019\']t)\\s+' + prohibitedAction + '(?:\\s+(?:or|and)\\s+' + prohibitedAction + ')*(?=\\s*(?:$|[.!?;\\n]))[.!?;]?', 'gi')
  // Only capability-status language is metadata. Keep any following positive
  // execute/install instruction intact so the catalog cannot swallow it.
  const subject = '(?:it|they|this skill|the skill|these skills|the skills|your (?:installed )?skills|any of them|each skill)'
  const statusQuestion = new RegExp('\\b(?:(?:whether|if)\\s+' + subject + '\\s+(?:can|may|are allowed to|is able to)|(?:can|could|may)\\s+' + subject + ')\\s+(?:execute|run)\\s+(?:(?:package|bundled)\\s+)?code\\b', 'gi')
  const selectionStatus = /\b(?:which|what)\s+(?:(?:of\s+)?(?:your|my|the|these)\s+)?(?:(?:verified|installed|managed|instruction)\s+)*skills\s+(?:can|may)\s+(?:execute|run)\s+code\b/gi
  // A whole read-only clause may coordinate omitted objects. Recognize this
  // bounded form only; never strip a positive action following the clause.
  const catalogReadOnlyClause = /(?:^|[.!?;\n]\s*)(?:do not|don't|don’t)\s+install,\s*edit,?\s+or\s+save\s+(?:a\s+)?memory(?=\s*(?:$|[.!?;\n]))[.!?;]?/gi
  const text = original.replace(catalogReadOnlyClause, '. ').replace(restriction, '. ')
    .replace(/(?:^|[.!?;\n]\s*)read[ -]only(?=\s*(?:$|[.!?;\n]))[.!?;]?/gi, '. ')
    .replace(selectionStatus, match => match.replace(/\b(?:execute|run)\s+code\b/i, 'provide execution capability metadata'))
    .replace(statusQuestion, 'execution capability metadata').trim()
  if (text.length > 20000) return false
  if (/\b(?:install|uninstall|remove|delete|create|write|author|activate|execute|run|pip|npm)\b/i.test(text)) return false
  if (/\b(?:do|perform)\s+(?:it|that|this)\b/i.test(text)) return false
  // A catalog-only shortcut must not consume a coding directive hidden behind
  // wording such as "now", "use Aider to", or an unfamiliar clause wrapper.
  // Remove only the verb in a narrowly described skill-capability question;
  // any following independent modification verb remains visible to this guard.
  const modification = '(?:edit|fix|debug|refactor|modify|update|change|add|repair|improve|enhance|build|implement|patch|rewrite|optimi[sz]e)'
  const capability = new RegExp('\\bskills?\\s+(?:(?:that|which)\\s+)?(?:can|could|may|(?:is|are)\\s+able\\s+to)\\s+' + modification + '\\b', 'gi')
  const purpose = new RegExp('\\bskills\\s+do\\s+you\\s+have\\s+installed\\s+to\\s+' + modification + '\\b', 'gi')
  const metadataVerb = match => match.replace(new RegExp(modification + '$', 'i'), 'provide guidance')
  const operations = text.replace(capability, metadataVerb).replace(purpose, metadataVerb)
  if (new RegExp('\\b' + modification + '\\b', 'i').test(operations)
    || /\bcode\s+(?:(?:me|us)\s+)?(?:a|an|the|my|our|this|that|some|new|another)\b/i.test(operations)) return false
  // A catalog answer must not silently consume another requested operation.
  // These reads/actions belong to the normal scoped-tool routing, even when a
  // catalog request appears in the same message. Catalog names, descriptions,
  // versions and provenance remain ordinary read-only metadata requests.
  // Split coordinated commands, but keep coordinated objects together: "do
  // not read other files and your catalog" negates the catalog too, whereas
  // "do not read other files and list your skills" has a positive second task.
  const clauses = text.split(/(?:[.!?](?=\s|$)|[;\n]|,\s*|\s+(?:and(?:\s+then|\s+also)?|then|but)\s+(?=(?:(?:please|also)\s+){0,2}(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:what|which|list|show|read|inspect|check|review|tell|scan|analy[sz]e|audit|edit|open|launch|search|browse|download|fetch|navigate|connect|switch|summarize|translate|calculate)\b))/i)
  const positiveClauses = []
  for (const clause of clauses) {
    const denied = clause.match(/\b(?:do not|don['’]t|never|without)\s+(?:ever\s+)?(inspect(?:ing)?|check(?:ing)?|read(?:ing)?|list(?:ing)?|show(?:ing)?|review(?:ing)?|display(?:ing)?|tell(?:ing)?(?:\s+me)?|report(?:ing)?|(?:use|using)\s+(?:any\s+)?tools?)\b(.*)$/i)
    if (denied && (/\b(?:skills?|catalog|registry)\b/i.test(denied[2])
      || /^\s*(?:their|its)\s+(?:names|descriptions|versions|provenance|sources|hashes)\b/i.test(denied[2])
      || /^(?:use|using)\b/i.test(denied[1]))) return false
    // An unrelated restriction is not a positive action and must not hide the
    // catalog request, including inline "without reading unrelated files".
    const positive = (denied ? clause.slice(0, denied.index) : clause).trim()
    positiveClauses.push(positive)
    const action = positive.match(/^(?:(?:please|also|then|and|but)\s+){0,3}(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(read|inspect|review|check|scan|analy[sz]e|audit|edit|open|launch|search|browse|download|fetch|navigate|connect|switch|summarize|translate|calculate)\b(.*)$/i)
    if (!action) continue
    if (/^(?:edit|open|launch|search|browse|download|fetch|navigate|connect|switch|summarize|translate|calculate)$/i.test(action[1])) return false
    const target = action[2].trim()
    const catalogTarget = /\b(?:skills?|catalog|registry)\b/i.test(target)
      || /^(?:(?:their|its|the)\s+)?(?:names|descriptions|versions|provenance|sources|hashes)\b/i.test(target)
    if (!catalogTarget || /\b(?:project|repository|repo|source code|files?|folders?|directories|directory|system|browser|web|screen|camera|tools?)\b|\b[\w-]+\.(?:py|js|mjs|cjs|ts|tsx|json|md|txt|csv|html|css|yaml|yml)\b|[a-z]:[\\/]|https?:\/\//i.test(target)) return false
  }
  const positiveText = positiveClauses.join(' ')
  if (/\bpackages?\b[^.!?\n]{0,100}\b(?:installed|added)\b[^.!?\n]{0,50}\bfor (?:you|nori)\b/i.test(positiveText)) return true
  return /\b(?:what|which|list|show|read|inspect|check|review|tell me)\b/i.test(positiveText)
    && /\b(?:skills?|skill catalog|skill registry)\b/i.test(positiveText)
    && /\b(?:your|my|nori|installed|managed|catalog|registry|available)\b/i.test(positiveText)
}

export function verifiedSkillCatalogStatus(store = process.env.NORI_SKILL_STORE) {
  if (typeof store !== 'string' || !store) return { status: 'unavailable', skills: [] }
  try {
    const root = resolve(store), registryPath = join(root, 'registry.json')
    for (const file of [root, registryPath]) {
      if (lstatSync(file).isSymbolicLink() || realpathSync(file).toLowerCase() !== file.toLowerCase()) {
        throw Error('Linked skill storage')
      }
    }
    const info = lstatSync(registryPath)
    if (!info.isFile() || info.size > 1024 * 1024) throw Error('Invalid registry')
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
    if (registry.schema !== 'nori.instruction-skills.v1' || !registry.packages
      || typeof registry.packages !== 'object' || Array.isArray(registry.packages)) throw Error('Invalid registry')
    const packages = Object.entries(registry.packages)
    if (packages.length > 64 || packages.some(([, record]) => !record || !Array.isArray(record.skills) || !record.skills.length)) {
      throw Error('Invalid package metadata')
    }
    const verified = managedInstructionCatalog(root)
    const expected = packages.reduce((count, [, record]) => count + record.skills.length, 0)
    if (verified.length !== expected) throw Error('Catalog integrity not established')
    const skills = verified.map(skill => {
      const [digest, record] = packages.find(([, record]) => record.skills.some(item => item.name === skill.name))
      const metadata = record.skills.find(item => item.name === skill.name)
      return { name: skill.name, description: skill.description,
        version: typeof metadata.version === 'string' ? metadata.version.slice(0, 80) : null,
        packageSha256: digest,
        sourceKind: typeof record.source_kind === 'string' ? record.source_kind.slice(0, 80) : 'not recorded',
        verified: true, codeExecutionEnabled: false }
    })
    return { status: 'verified', skills }
  } catch { return { status: 'unverified', skills: [] } }
}

const plain = value => String(value).replace(/[\r\n\u0000-\u001f`<>]/g, ' ').slice(0, 180)
export function installedSkillCatalogAnswer(store = process.env.NORI_SKILL_STORE) {
  const catalog = verifiedSkillCatalogStatus(store)
  if (catalog.status !== 'verified') {
    return 'I could not verify my managed instruction-skill catalog from the configured Nori skill store. I have not concluded that no skills are installed. No packages were installed or executed.'
  }
  const lines = catalog.skills.slice(0, 64).map(skill => `- ${skill.name}${skill.version ? ` (${plain(skill.version)})` : ''}: ${plain(skill.description)} [recorded source: ${plain(skill.sourceKind)}; recorded package SHA-256: ${skill.packageSha256}]`)
  if (catalog.skills.length > 64) lines.push(`${catalog.skills.length - 64} further verified entries omitted from this bounded reply.`)
  const relevance = catalog.skills.some(skill => skill.name === 'avoid-ai-writing')
    ? 'The writing bundle is useful for natural wording, editing, and review. These are guidance skills, not additional executable tools.' : ''
  return [`I checked my managed instruction-skill catalog: ${catalog.skills.length} verified skill${catalog.skills.length === 1 ? '' : 's'}.`,
    ...(relevance ? [relevance] : []),
    ...lines, 'Registered file hashes match. These are instruction references; code execution is disabled. This check does not inspect system pip/npm packages or verify that every tool is operational.'].join('\n\n')
}
