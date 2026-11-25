import { composeToolUnion } from './tool-registry.mjs'
import { createResearchTools } from './research-tools.mjs'
import { createPersonalFilesTools } from './personal-files-tools.mjs'
import { createPcInfoTools } from './pc-info-tools.mjs'
import { createNoriProjectTools } from './project-tools.mjs'
import { createBrowserTools } from './browser-tools.mjs'
import { createSystemTools } from './system-tools.mjs'
import { createDocumentTools } from './document-tools.mjs'
import { installationPaths } from './installation-paths.mjs'
import { chooseToolIntent, chooserContext, referentialFollowUp } from './tool-intent.mjs'

export async function createRoutedAgentTools({ turns = [], toolIntent, ...options } = {}, factories = {}, choose = chooseToolIntent) {
  options.signal?.throwIfAborted()
  const intent = toolIntent === undefined
    ? await choose(options.intentGoal, { signal: options.signal, context: chooserContext(turns) })
    : toolIntent
  options.signal?.throwIfAborted()
  if (intent === null && !referentialFollowUp(options.intentGoal, turns)) return null
  return createAgentTools({ ...options, toolIntent: intent ?? 'base',
    browserTask: intent === 'browser', systemCommandTask: intent === 'system', researchTask: intent === 'research' }, factories)
}

// Assembly grants no authority: each adapter retains its own checks.
// Kept outside the chat router so its complete catalog can be tested directly.
export function createAgentTools({ intentGoal, toolIntent = null, browserTask = false,
  systemCommandTask = false, researchTask = false, signal } = {}, factories = {}) {
  signal?.throwIfAborted()
  const research = (factories.research ?? createResearchTools)(intentGoal, { signal })
  const files = (factories.files ?? createPersonalFilesTools)()
  const pc = (factories.pc ?? createPcInfoTools)()
  let project = null
  try { project = (factories.project ?? createNoriProjectTools)((factories.paths ?? installationPaths)().noriRoot) } catch {
    // An unavailable verified root must not result in an invented path.
  }
  const families = []
  if (browserTask) families.push({ key: 'browser', tools: (factories.browser ?? createBrowserTools)({ signal, allowStartRequest: true }) })
  if (systemCommandTask || toolIntent === 'agent') families.push({ key: 'system', tools: (factories.system ?? createSystemTools)() })
  if (toolIntent === 'documents' || toolIntent === 'agent') families.push({ key: 'documents', tools: (factories.documents ?? createDocumentTools)() })
  if (researchTask) families.push({ key: 'research', tools: research })
  if (toolIntent === 'project' && project) families.push({ key: 'project', tools: project, names: ['list_dir', 'read_file'] })
  if (toolIntent === 'files') families.push({ key: 'files', tools: files })
  if (toolIntent === 'pcinfo') families.push({ key: 'pcinfo', tools: pc })
  if (!researchTask) families.push({ key: 'research', tools: research, names: ['search_public_web', 'read_public_page'], base: true })
  if (toolIntent !== 'files') families.push({ key: 'files', tools: files, base: true })
  if (toolIntent !== 'pcinfo') families.push({ key: 'pcinfo', tools: pc, base: true })
  if (project) families.push({ key: 'project', tools: project, names: ['list_skill_catalog'], base: true })
  return composeToolUnion(families)
}
