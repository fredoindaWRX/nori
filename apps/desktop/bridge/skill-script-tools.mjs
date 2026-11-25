// The one tool that lets Nori run a skill's script by herself in the middle of a turn
// (owner, 2026-11-16: "let her run skill scripts by herself mid-task").
// It is offered only on a turn where a selected skill really has scripts and no other tool set was chosen.
// The approval rule is unchanged and is enforced by runSkillScript, not here: the first use of a skill's scripts
// opens the desktop app's native prompt listing every script, nothing runs before the owner's Allow, and a changed
// or added script asks again. The skill and script arguments are enums of what is installed, so the model cannot
// name a path of its own.
import { createRequire } from 'node:module'
import { runSkillScript } from './skill-code.mjs'

const require = createRequire(import.meta.url)
const { locateSkillScripts, NAME } = require('../desktop/skill-code.cjs')

const MAX_ARGS = 12, MAX_ARG = 600, RESULT_CHARS = 5200, OUTPUT_CHARS = 3200

export const SKILL_SCRIPT_NOTICE = 'One tool is available this turn: run_skill_script. It runs a Python script that came with one of the selected skills, with the arguments you give, and returns what the script printed. Use it only when the skill guidance or the owner\'s request calls for that script; do not run scripts to explore. The first run of a skill\'s scripts needs the owner\'s Allow in a Windows prompt: if the result says owner_approval_needed, nothing ran, so tell the owner to approve and ask again. Any note in the skill text saying its code is never run means it never runs by itself; this tool is the only way it runs. Report only what the tool result shows. Never claim a script ran, or what it printed, without a result that says executed true. No other tools are available: never claim you created, saved, wrote, or deleted a file or folder yourself.'

/** Skill names from the labels the skill context puts in front of each selected skill. */
export function selectedSkillNames(skillContext) {
  const names = []
  for (const match of String(skillContext ?? '').matchAll(/\[Installed (?:local|GitHub) skill "([a-z0-9-]+)"/g)) {
    if (NAME.test(match[1]) && !names.includes(match[1])) names.push(match[1])
  }
  return names
}

/** { skill: [script, ...] } for the named skills that carry scripts. A skill that cannot be read is left out. */
export function skillsWithScripts(names, environment = process.env) {
  const out = {}
  const store = environment.NORI_SKILL_STORE
  if (!store) return out
  for (const name of Array.isArray(names) ? names.slice(0, 3) : []) {
    try {
      const scripts = Object.keys(locateSkillScripts(store, name).scripts)
      if (scripts.length) out[name] = scripts
    } catch {}
  }
  return out
}

export function createSkillScriptTools({ skills, signal, environment = process.env, run = runSkillScript } = {}) {
  const names = Object.keys(skills ?? {})
  const scripts = [...new Set(names.flatMap(name => skills[name]))]
  if (!names.length || !scripts.length) throw new Error('No skill scripts to offer')
  const definitions = Object.freeze([{ type: 'function', function: {
    name: 'run_skill_script',
    description: `Run one Python script that came with a selected skill and return its output. Scripts: ${names.map(name => `${name}: ${skills[name].join(', ')}`).join('; ')}. Needs the owner's approval of that skill's scripts the first time.`,
    parameters: { type: 'object', additionalProperties: false,
      properties: {
        skill: { type: 'string', enum: names, description: 'The installed skill the script belongs to.' },
        script: { type: 'string', enum: scripts, description: 'The script file, exactly as listed.' },
        args: { type: 'array', items: { type: 'string', maxLength: MAX_ARG }, maxItems: MAX_ARGS, description: 'Command-line arguments for the script, one per item. Use full file paths.' },
      },
      required: ['skill', 'script'] } } }])
  const clip = (text, size) => (text.length > size ? `${text.slice(0, size - 1)}…` : text)
  const reply = (value, maxBytes) => {
    let text = JSON.stringify(value)
    const limit = Math.min(RESULT_CHARS, Number.isFinite(maxBytes) && maxBytes > 400 ? maxBytes : RESULT_CHARS)
    // Shorten only the script output; the facts about the run always fit.
    for (let size = OUTPUT_CHARS; text.length > limit && typeof value.output === 'string' && size > 100; size = Math.floor(size / 2)) {
      text = JSON.stringify({ ...value, output: clip(value.output, size), truncated: true })
    }
    return text
  }
  return Object.freeze({
    definitions, skillScriptWorker: true,
    async call(name, args, { maxBytes } = {}) {
      if (name !== 'run_skill_script') throw new Error('Unknown skill tool')
      const skill = args?.skill, script = args?.script
      if (!names.includes(skill) || !skills[skill].includes(script)) throw new Error('That script is not part of a selected skill')
      const list = args?.args === undefined ? [] : args.args
      if (!Array.isArray(list) || list.length > MAX_ARGS || list.some(item => typeof item !== 'string' || item.length > MAX_ARG)) throw new Error('Script arguments must be at most 12 short strings')
      const result = await run({ skill, script, args: list, signal, environment, waitMs: 45_000 })
      if (result.status !== 'ran') {
        return reply({ executed: false, error: 'owner_approval_needed', skill, script,
          message: 'Nothing ran. The owner has not approved this skill\'s scripts yet; a Windows prompt was opened. Tell the owner to approve it and ask again.' }, maxBytes)
      }
      return reply({ executed: true, skill: result.skill, script: result.script, exit_code: result.exitCode, timed_out: result.timedOut === true,
        output: clip(String(result.output ?? ''), OUTPUT_CHARS), truncated: result.truncated === true || String(result.output ?? '').length > OUTPUT_CHARS }, maxBytes)
    },
  })
}
