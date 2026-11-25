export function evaluateResearchAcceptance(state, { taskId, allowedHosts = ['docs.python.org', 'www.python.org'] } = {}) {
  if (!state || state.task_id !== taskId) return { passed: false, status: 'identity-mismatch' }
  if (!['completed', 'failed', 'blocked', 'cancelled', 'interrupted'].includes(state.status)) return { passed: false, status: 'pending' }
  if (state.status !== 'completed') return { passed: false, status: state.status, failure: state.failure || null }
  const actions = state.executions?.filter(x => x.status === 'completed').map(x => x.action) || []
  const citations = state.research_evidence
  if (state.completion_kind !== 'source_linked_research' || !['search_web', 'inspect_web', 'research_report'].every(x => actions.includes(x))
      || typeof state.response !== 'string' || !state.response.trim() || !Array.isArray(citations) || !citations.length) {
    return { passed: false, status: 'missing-completion-evidence' }
  }
  for (const citation of citations) {
    try {
      const url = new URL(citation.source)
      if (url.protocol !== 'https:' || url.username || url.password || !allowedHosts.includes(url.hostname)) return { passed: false, status: 'source-outside-scope' }
    } catch { return { passed: false, status: 'invalid-source' } }
  }
  return { passed: true, status: 'completed', verifiedActions: actions, citations: citations.map(x => x.source), response: state.response }
}
