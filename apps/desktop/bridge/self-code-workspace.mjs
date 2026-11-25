import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { join, resolve, extname, dirname } from 'node:path'

export function isSelfCodeRequest(value) {
  const text = String(value ?? '')
  if (/\b(?:do\s+not|don't|dont|never|stop|cancel)\b.{0,60}\b(?:build|create|write|implement|fix|repair|improve|review|inspect|check)\b/i.test(text)) return false
  if (/\b(?:build|create|write|implement)\s+(?:yourself|for yourself)\s+(?:(?:a|an|the|new|local|own)\s+){0,4}(?:plugin|extension|tool|integration|capability)\b/i.test(text)) return true
  // Owner, 2026-11-16: "make your code always mean hers". Any request to work on "your code" (or Nori's/her code,
  // codebase or source) is about Nori herself, whatever project happens to be selected. A plain question such as
  // "what is your codebase?" has no work verb and stays a question.
  if (!/\b(?:do\s+not|don't|dont|never|stop|cancel)\b/i.test(text)
    && /\b(?:work(?:ing)?\s+on|fix|repair|improve|update|upgrade|change|edit|modify|refactor|rewrite|clean\s*up|debug|optimi[sz]e|go\s+(?:through|thru)|inspect|review|check|look\s+(?:at|over|through))\b/i.test(text)
    && /\b(?:your|nori[’']?s?|her)\s+(?:own\s+)?(?:source\s+code|code|codebase|source)\b(?!\s+(?:name|word|of\s+conduct))/i.test(text)) return true
  return /\b(?:go\s+(?:through|thru)|inspect|review|check|fix|repair|improve)\b/i.test(text)
    && /\b(?:your|nori[’']?s?|her)\s+(?:own\s+)?(?:project|code|codebase|system|desktop|app)\b/i.test(text)
    && /\b(?:fix|repair|connect(?:ing|ions|ed)?|improve|broken|not\s+working)\b/i.test(text)
}

export function selfCodeWorkspace(environment = process.env) {
  if (!environment.NORI_APP_DATA_ROOT) throw Error('Nori-owned application storage is required for self-development.')
  return join(resolve(environment.NORI_APP_DATA_ROOT), 'development', 'self-code')
}

// One source-only workspace, never a second model/runtime installation. A dirty
// candidate is preserved for review rather than overwritten on another request.
export function prepareSelfCodeWorkspace({ suiteRoot, environment = process.env, gitExecutable } = {}) {
  const target = selfCodeWorkspace(environment)
  const gitEnvironment = {...environment,GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'NUL',GIT_TERMINAL_PROMPT:'0'}
  for (const key of Object.keys(gitEnvironment)) {
    if (/^GIT_/i.test(key) && !['GIT_CONFIG_NOSYSTEM','GIT_CONFIG_GLOBAL','GIT_TERMINAL_PROMPT'].includes(key)) delete gitEnvironment[key]
  }
  for (let path = target; ; path = dirname(path)) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw Error('Linked self-development storage refused.')
    if (dirname(path) === path) break
  }
  const git = args => execFileSync(gitExecutable, ['-c','core.hooksPath=NUL','-c','core.fsmonitor=false',
    '-c','commit.gpgsign=false', ...args], {
    cwd:target, windowsHide:true, timeout:15_000, encoding:'utf8',
    env:gitEnvironment,
  }).trim()
  const source = realpathSync(suiteRoot)
  const files = []
  let total = 0
  const allowed = new Set(['.py','.mjs','.cjs','.js','.ts','.tsx','.css','.html'])
  const excluded = new Set(['.git','node_modules','__pycache__','tests','test','data','state','models','release','vendor','.venv'])
  function collect(path, relative) {
    const info = lstatSync(path)
    if (info.isSymbolicLink()) throw Error('Linked source refused: '+relative)
    if (info.isDirectory()) {
      for (const entry of readdirSync(path).sort()) {
        if (!excluded.has(entry) && !entry.startsWith('.')) collect(join(path,entry),join(relative,entry))
      }
    } else if (info.isFile() && allowed.has(extname(path))) {
      if (info.size > 1024*1024 || (total += info.size) > 32*1024*1024 || files.length >= 2048)
        throw Error('Self-development source exceeds the bounded source-only workspace limit.')
      files.push([relative,readFileSync(path)])
    }
  }
  for (const relative of ['nori','apps/desktop/bridge']) {
    const path=join(source,relative)
    if (existsSync(path)) collect(path,relative)
  }
  if (!files.length) throw Error('No installed Nori source was available for self-development.')
  const sourceHash=createHash('sha256')
  for (const [relative,bytes] of files) sourceHash.update(relative).update('\0').update(bytes).update('\0')
  const sha256=sourceHash.digest('hex')
  if (existsSync(target)) {
    if (!existsSync(join(target,'.git')) || lstatSync(join(target,'.git')).isSymbolicLink()
      || !lstatSync(join(target,'.git')).isDirectory()) throw Error('Self-development requires its own ordinary Git directory.')
    const provenance = join(target,'.git','nori-self-source.json')
    if (!existsSync(provenance) || lstatSync(provenance).isSymbolicLink())
      throw Error('Existing self-development workspace has no matching source provenance; preserved.')
    const prior=JSON.parse(readFileSync(provenance,'utf8'))
    if (prior.source !== source || prior.sha256 !== sha256)
      throw Error('Installed source changed since the self-development baseline; existing work was preserved for review.')
    if (git(['status','--porcelain'])) throw Error('Nori has pending self-development edits awaiting review; they were preserved.')
    return target
  }
  mkdirSync(target,{recursive:true})
  for (const [relative,bytes] of files) {
    const path=join(target,relative);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes,{flag:'wx'})
  }
  git(['init'])
  git(['add','--','.'])
  git(['-c','user.name=Nori Local Development','-c','user.email=nori@localhost','commit','-m','Installed Nori source baseline'])
  writeFileSync(join(target,'.git','nori-self-source.json'),JSON.stringify({source,sha256,files:files.length,bytes:total}),{flag:'wx'})
  return target
}
