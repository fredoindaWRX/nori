import { userCreativeRoutingText } from './artcraft-tools.mjs'

/** Skill authoring creates reviewable Markdown drafts; it never installs or activates them. */
export function requestsInstructionSkillAuthoring(goal) {
  const text = userCreativeRoutingText(goal).trim()
  if (!text || text.length > 20_000) return false
  if (/\b(?:install|import|add)\b.*\b(?:skill|instruction package)\b/i.test(text)) return false
  return /\b(?:create|write|author|draft|design|make)\b.{0,80}\b(?:skill|instruction package|SKILL\.md)\b/i.test(text)
    || /\b(?:skill|instruction package|SKILL\.md)\b.{0,80}\b(?:create|write|author|draft|design)\b/i.test(text)
}

export function skillAuthoringAnswer(goal) {
  const idea = String(userCreativeRoutingText(goal) || 'the requested capability').trim().slice(0, 240)
  return `I can draft a reviewable Markdown skill for “${idea}”. This is a draft-only authoring route: it will not install, activate, execute, or change the skill catalog. Review the proposed SKILL.md and its provenance first, then use the separate local ZIP installer if you decide to install it.`
}
