const VIDEO_WORDS = /\b(?:videos?|clips?|animated|video animation)\b/i
const VIDEO_ACTION = /\b(?:generate|create|make|produce|render)\b/i
const VIDEO_CAPABILITY = /^(?:hey\s+nori[,!]\s*)?(?:can|could|do|are)\s+you\b/i
const VIDEO_EDITING = /\b(?:edit|trim|cut|splice|subtitle|caption|transcode|convert|export|timeline|filmcraft|effectcraft)\b/i
const OTHER_TOOL = /\b(?:skill|github|repository|repo|install|integrat(?:e|ion)|implement|plugin|tool|code|app|website|function|module)\b/i
const NON_VIDEO_ARTIFACT = /\b(?:script|storyboard|shot\s+list|outline|description|prompt|plan)\b/i
const NEGATED_GENERATION = /\b(?:do\s+not|don['’]?t|never|stop|cancel)\b/i
const OTHER_ARTIFACT = /\b(?:document|docx|pdf|spreadsheet|presentation|slides?|deck|image|photo|picture|logo|svg|soundtrack|music|audio|cad|blueprint|wireframe)\b/i

export function isVideoCapabilityQuestion(goal = '') {
  return VIDEO_WORDS.test(goal) && VIDEO_ACTION.test(goal) && VIDEO_CAPABILITY.test(goal.trim()) &&
    !/\b(?:of|showing|depicting|with|for me|a car|a person)\b/i.test(goal) && !OTHER_TOOL.test(goal)
}

/** Route generation requests to the local video model, not FilmCraft's editor. */
function directVideoRequest(goal) {
  if (typeof goal !== 'string' || !goal.trim() || NEGATED_GENERATION.test(goal) || VIDEO_EDITING.test(goal) || OTHER_TOOL.test(goal) || NON_VIDEO_ARTIFACT.test(goal)) return false
  if (isVideoCapabilityQuestion(goal)) return false
  return VIDEO_WORDS.test(goal) && VIDEO_ACTION.test(goal) && !OTHER_ARTIFACT.test(goal)
}

function refinement(goal) {
  return typeof goal === 'string' && !NEGATED_GENERATION.test(goal) && !VIDEO_EDITING.test(goal)
    && !OTHER_TOOL.test(goal) && !NON_VIDEO_ARTIFACT.test(goal) && !OTHER_ARTIFACT.test(goal)
    && /^(?:(?:yes|yeah|yep|please|ok(?:ay)?)[,! .]*)?(?:i\s+want\s+you\s+to\s+)?(?:do|make|render|generate|redo|regenerate|change|add|keep|try)\b/i.test(goal.trim())
    && /\b(?:it|that|same|more|less|again)\b/i.test(goal)
}

/** Keep a contiguous creative request chain; unrelated work breaks the link. */
export function resolveVideoRequest(goal = '', turns = []) {
  const direct = directVideoRequest(goal)
  if (direct && !refinement(goal)) return goal
  if (!refinement(goal)) return null
  const users = turns.slice(-12).filter(turn => turn?.role === 'user' && typeof turn.text === 'string')
  const refinements = [goal]
  for (let index = users.length - 1; index >= 0; index--) {
    const previous = users[index].text
    if (directVideoRequest(previous)) {
      const guidance = /\b(?:exactly like that|do that|do it)\b/i.test(goal)
        ? turns.slice(-2).find(turn => (turn?.role === 'nori' || turn?.role === 'assistant') && typeof turn.text === 'string')?.text : ''
      const prompt = [previous, ...refinements.reverse().map(text => `Requested refinement: ${text}`),
        guidance ? `Visual reference from the preceding discussion: ${guidance.slice(0,1800).replace(/[\r\n]+/g, ' ')}` : ''].filter(Boolean).join('\n')
      if (Buffer.byteLength(prompt, 'utf8') > 12000) throw new Error('The accumulated video request is too long; shorten the scene description.')
      return prompt
    }
    if (/^(?:did|have|are)\s+you\b.{0,50}\b(?:finish|finished|done|complete|completed)\b.{0,50}\b(?:it|that|picture|image|animation|video|clip)\b/i.test(previous)) continue
    if (!refinement(previous)) return null
    refinements.push(previous)
  }
  return direct ? goal : null
}

export function isVideoRequest(goal = '', turns = []) {
  return resolveVideoRequest(goal, turns) !== null
}

export function videoCapabilityAnswer(available) {
  return available
    ? 'I have a local video generator available. Tell me the duration in seconds or minutes; if you do not specify one, I use 8 seconds. Longer silent videos use newly generated short shots joined together, so there may be visible cuts. Rendering time and available disk space limit each job. I’ll only say it worked after the duration is verified and the video is displayed.'
    : 'The local video generator is not responding, so I cannot create a video right now. I have not contacted a cloud service.'
}

