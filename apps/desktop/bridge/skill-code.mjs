// Running a script that came with a skill, with the owner's approval (owner, 2026-11-16: "Run with approval").
// A run starts from the owner's own chat message ("run the selftest script from movie-riff-tools") or from Nori's
// run_skill_script tool (skill-script-tools.mjs) on a turn where that skill is selected.
// The first run of a skill's scripts opens a native Windows prompt in the desktop app that lists every script;
// after an Allow, that exact set of scripts stays approved. A run has a time limit and a bounded output, and it
// executes with the owner's Windows account: this is an approval gate, not a sandbox.
import { execFile } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const { approvedScriptPath, isGranted, locateSkillScripts, NAME } = require('../desktop/skill-code.cjs')

const MAX_ARGS = 12, MAX_ARG = 600, RUN_MS = 60_000, MAX_OUTPUT = 256 * 1024, SHOWN = 3000

function splitArgs(text) {
  const out = []
  for (const match of String(text ?? '').matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    const value = match[1] ?? match[2] ?? match[3]
    if (value.length > MAX_ARG || out.length >= MAX_ARGS) throw Object.assign(Error('Too many or too long script arguments'), { code: 'SKILL_SCRIPT_ARGS' })
    out.push(value)
  }
  return out
}

/** "run skill script <skill> <file.py> [args]" or "run the <file> script from <skill> [skill] [with <args>]". */
export function skillScriptRequest(text) {
  const raw = String(text ?? '').trim()
  if (!raw || raw.length > 4000 || /\n/.test(raw)) return null
  let m = raw.match(/^(?:please\s+)?run\s+skill\s+script\s+([a-z0-9-]+)[\s/]+([\w./\\-]+?\.py)(?:\s+(.*))?$/i)
  if (m) return { skill: m[1].toLowerCase(), script: m[2], args: splitArgs(m[3]) }
  m = raw.match(/^(?:please\s+)?(?:run|use|start)\s+(?:the\s+)?([\w./\\-]+?)(?:\.py)?\s+(?:script|helper|tool)\s+(?:from|in|of)\s+(?:the\s+|your\s+)?([a-z0-9-]+)(?:\s+skill)?(?:\s+(?:with|on)\s+(.*))?[.!]?$/i)
  if (m && NAME.test(m[2].toLowerCase())) return { skill: m[2].toLowerCase(), script: `${m[1].replace(/\.py$/i, '')}.py`, args: splitArgs(m[3]) }
  return null
}

function desktopExecutable(environment) {
  const executable = environment.NORI_SKILL_DESKTOP_EXECUTABLE
  if (typeof executable !== 'string' || !isAbsolute(executable) || basename(executable).toLowerCase() !== 'nori.exe'
      || !existsSync(executable) || lstatSync(executable).isSymbolicLink() || !lstatSync(executable).isFile()
      || realpathSync(executable).toLowerCase() !== resolve(executable).toLowerCase()) throw Object.assign(Error('The desktop app is not connected in this session.'), { code: 'SKILL_CODE_NO_DESKTOP' })
  return executable
}
function python(environment) {
  const root = environment.NORI_SUITE_ROOT || environment.NORI_ROOT
  const path = root ? join(root, 'integrations', 'image-generation', 'runtime', 'ComfyUI_windows_portable', 'python_embeded', 'python.exe') : ''
  if (!path || !existsSync(path)) throw Object.assign(Error('Nori\'s own Python is not available, so the script was not run.'), { code: 'SKILL_CODE_NO_PYTHON' })
  return path
}
const sleep = ms => new Promise(done => setTimeout(done, ms))
const BOOTSTRAP = "import sys,runpy,os;p=sys.argv[1];sys.argv=sys.argv[1:];sys.path.insert(0,os.path.dirname(p));runpy.run_path(p,run_name='__main__')"

/**
 * Runs one script of an installed skill. Returns { status, ... }:
 *   'ran' { script, exitCode, output, truncated } | 'approval_needed' | 'declined'
 * Throws Error with .code for an unknown skill/script or a missing runtime.
 */
export async function runSkillScript({ skill, script, args = [], environment = process.env, runFile = execFile, signal,
  waitMs = 120_000, pollMs = 1000, now = Date.now } = {}) {
  const store = environment.NORI_SKILL_STORE, settings = environment.NORI_SETTINGS_DIR, dataRoot = environment.NORI_APP_DATA_ROOT
  if (!store || !settings || !dataRoot) throw Object.assign(Error('Skill storage is not connected in this session.'), { code: 'SKILL_CODE_NO_STORE' })
  const grantsFile = join(settings, 'skill-code-grants.json')
  const located = locateSkillScripts(store, skill)
  if (!Object.keys(located.scripts).length) throw Object.assign(Error('That skill has no scripts.'), { code: 'SKILL_SCRIPT_UNKNOWN', scripts: [] })
  if (!isGranted(grantsFile, located)) {
    // Ask the desktop app to show its native prompt, then wait for the owner's answer.
    const executable = desktopExecutable(environment)
    await new Promise((done, fail) => runFile(executable, ['--nori-skill-code-approve', located.skill], { cwd: dirname(executable), shell: false, windowsHide: true, timeout: 10_000, maxBuffer: 16384 },
      error => error ? fail(Object.assign(Error('Nori could not open the approval prompt.'), { code: 'SKILL_CODE_NO_DESKTOP' })) : done()))
    const until = now() + waitMs
    while (now() < until && !isGranted(grantsFile, locateSkillScripts(store, skill))) { signal?.throwIfAborted(); await sleep(pollMs) }
    if (!isGranted(grantsFile, locateSkillScripts(store, skill))) return { status: 'approval_needed', skill: located.skill, scripts: Object.keys(located.scripts) }
  }
  const approved = approvedScriptPath(store, grantsFile, skill, script)
  const cwd = join(resolve(dataRoot), 'skill-runs', located.skill)
  mkdirSync(cwd, { recursive: true })
  // Her bundled Python does not add the script's folder to its import path, so a small fixed bootstrap does it;
  // the script path and the owner's arguments are passed as plain arguments, never built into code.
  const result = await new Promise(done => runFile(python(environment), ['-E', '-s', '-c', BOOTSTRAP, approved.path, ...args],
    { cwd, shell: false, windowsHide: true, timeout: RUN_MS, maxBuffer: MAX_OUTPUT, signal, env: { ...environment, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8' } },
    (error, stdout, stderr) => done({ error, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') })))
  const text = [result.stdout.trim(), result.stderr.trim() && `[errors]\n${result.stderr.trim()}`].filter(Boolean).join('\n')
  const timedOut = Boolean(result.error?.killed)
  return { status: 'ran', skill: located.skill, script: approved.script, exitCode: timedOut ? null : (typeof result.error?.code === 'number' ? result.error.code : result.error ? 1 : 0),
    timedOut, output: text.slice(0, SHOWN), truncated: text.length > SHOWN, cwd }
}

/** What Nori tells the owner after a run or a refusal. Plain facts only. */
export function skillScriptAnswer(result) {
  if (result.status === 'approval_needed') return `I have not run anything. ${result.skill} carries ${result.scripts.length} script${result.scripts.length === 1 ? '' : 's'} (${result.scripts.join(', ')}), and I need your Allow in the Windows prompt first. Ask again once you have approved it.`
  const head = result.timedOut ? `I ran ${result.script} from ${result.skill}, but stopped it after 60 seconds.`
    : result.exitCode === 0 ? `I ran ${result.script} from ${result.skill}. It finished without errors.`
      : `I ran ${result.script} from ${result.skill}. It ended with exit code ${result.exitCode}.`
  return `${head}${result.output ? `\n\n${result.output}` : '\n\nIt printed nothing.'}${result.truncated ? '\n\n(Output cut at 3,000 characters.)' : ''}`
}
