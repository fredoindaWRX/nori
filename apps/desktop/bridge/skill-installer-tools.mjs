import { execFile } from 'node:child_process'
import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path'
import { userCreativeRoutingText } from './artcraft-tools.mjs'

export function requestsInstructionSkillInstall(goal) {
  const text = userCreativeRoutingText(goal).trim()
  const exactPackageChoice = /^(?:hey\s+nori[,!]?\s*)?(?:(?:please|can you|could you)\s+)?(?:install|import|add)\s+(?:this|it|the\s+(?:attached\s+)?(?:skill\s+)?(?:package|zip))\s*[.!?]*$/i.test(text)
  const namedSkill = /^(?:hey\s+nori[,!]?\s*)?(?:(?:please|can you|could you)\s+)?(?:install|import|add)\b/i.test(text)
    && /\b(?:skills?|instruction package)\b/i.test(text)
  return text.length <= 20000
    && (exactPackageChoice || namedSkill)
    && !/\b(?:don't|do not|never|stop|cancel)\b/i.test(text)
}

export function skillArchiveMention(goal) {
  // The action is classified from unquoted text; the quoted path is data.
  const text = String(goal ?? '').slice(0, 20000)
  const quoted = [...text.matchAll(/["'`]([A-Za-z]:\\[^"'`\r\n]+\.zip)["'`]/gi)].map(m => m[1])
  const bare = quoted.length ? [] : [...text.matchAll(/\b([A-Za-z]:\\[^\s"'`<>|?*]+\.zip)\b/gi)].map(m => m[1])
  const paths = [...new Set([...quoted, ...bare])]
  if (paths.length > 1) throw new Error('Choose one local skill ZIP at a time.')
  if (/https?:\/\//i.test(text)) throw new Error('This installer accepts local ZIP packages. Download and review the package first.')
  return paths[0] || null
}

export function skillGithubUrlMention(goal) {
  const text = String(goal ?? '').slice(0, 20000)
  const urls = [...text.matchAll(/https?:\/\/[^\s"'`<>]+/gi)]
    .map(match => match[0].replace(/[),.!?;]+$/g, ''))
  if (!urls.length) return null
  if (urls.length !== 1) throw new Error('Choose one public GitHub skill link at a time.')
  let url
  try { url = new URL(urls[0]) } catch { throw new Error('Use a direct public GitHub skill-folder link.') }
  const parts = url.pathname.split('/').filter(Boolean)
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com'
      || url.username || url.password || url.search || url.hash
      || parts.length < 5 || !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[0])
      || !/^[A-Za-z0-9_.-]{1,100}$/.test(parts[1]) || !['tree', 'blob'].includes(parts[2])) {
    throw new Error('Use one HTTPS GitHub link to a public skill folder or SKILL.md file.')
  }
  return urls[0]
}

export async function openInstructionSkillInstaller(goal, { environment = process.env, runFile = execFile } = {}) {
  if (!requestsInstructionSkillInstall(goal)) throw new Error('An explicit instruction-skill install request is required.')
  const executable = environment.NORI_SKILL_DESKTOP_EXECUTABLE
  if (typeof executable !== 'string' || !isAbsolute(executable) || basename(executable).toLowerCase() !== 'nori.exe'
      || !existsSync(executable) || !lstatSync(executable).isFile() || lstatSync(executable).isSymbolicLink()
      || realpathSync(executable).toLowerCase() !== resolve(executable).toLowerCase()) {
    throw new Error('The desktop skill installer is not connected in this session.')
  }
  const githubUrl = skillGithubUrlMention(goal)
  const localGoal = githubUrl ? String(goal).replace(githubUrl, '') : goal
  const archive = skillArchiveMention(localGoal) || (!githubUrl && /\b(?:avoid-ai-writing|writing skills?)\b/i.test(String(goal))
    ? environment.NORI_BUNDLED_WRITING_SKILLS || null : null)
  if (githubUrl && archive) throw new Error('Choose either one GitHub skill link or one local ZIP package, not both.')
  if (archive && (typeof archive !== 'string' || !isAbsolute(archive) || extname(archive).toLowerCase() !== '.zip' || archive.startsWith('\\\\'))) {
    throw new Error('The bundled skill package must be a local ZIP file.')
  }
  const source = githubUrl || archive
  // A package the owner named in chat installs without the review window (owner decision 2026-11-15).
  // With no package named, the file picker still opens so the owner chooses by hand.
  await new Promise((done, fail) => runFile(executable, ['--nori-install-skill', ...(source ? [source, '--nori-skill-direct'] : [])], {
    cwd: dirname(executable), shell: false, windowsHide: true, timeout: 10000, maxBuffer: 16384,
  }, error => error ? fail(new Error('Nori could not open the skill review window.')) : done()))
  if (source) return { outcome: 'install_started', installed: false, packageCodeExecuted: false,
    source_kind: githubUrl ? 'github' : 'local_zip',
    message: 'Installing it now, no review window. It is checked first: instructions only, nothing in it runs. If anything is wrong you will get an error box. Ask me what skills I have in a few seconds to confirm.' }
  return { outcome: 'review_opened', installed: false, packageCodeExecuted: false,
    source_kind: githubUrl ? 'github' : 'local_zip',
    message: 'I opened Nori’s skill review window. Review the source and skill details, then choose Install instructions if they are correct. No installation is confirmed yet.' }
}
