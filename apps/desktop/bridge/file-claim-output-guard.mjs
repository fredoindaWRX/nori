/** Correct unsupported file/folder creation claims when no tool receipt backs them.
 *
 * Mirrors son-status-output-guard.mjs: a grounded replacement only when the
 * reply claims a durable file action and this turn has no verified write.
 * Chat-only routes (no projectTools) never produce write receipts, so any
 * "I created / saved / wrote" reply on those routes is corrected.
 *
 * A claim is trusted only when the caller supplies toolReceipts containing a
 * write_tool result whose status is ok/success AND whose path matches (or is
 * quoted inside) the reply. Anything else is refused rather than guessed at.
 */

const FILE_ACTION_CLAIM = /\b(?:i(?:'ve| have)?\s+(?:created|made|saved|written|wrote|added|updated|deleted|removed|moved|renamed|generated)|created\s+a\s+new\s+file|new\s+(?:file|folder)(?:\s+called)?|stored\s+(?:the|this)\s+(?:configuration|settings|data))\b/i

const QUOTED_PATH = /["'`“”]([^"'`“”\n]{1,512})["'`“”]/g
const BARE_PATH = /(?:[A-Za-z]:\\|\/)[\w\-./\\ ]+\.\w{1,10}/g

function lastUserText(messages) {
  if (!Array.isArray(messages)) return ''
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role === 'user' && typeof message.content === 'string') return message.content
  }
  return ''
}

function fictionalContext(text) {
  return /\b(?:fictional|imagine|story|hypothetical|roleplay|pretend|example output)\b/i.test(text)
}

export function needsFileClaimFactCheck(messages, response) {
  if (typeof response !== 'string' || !FILE_ACTION_CLAIM.test(response)) return false
  return !fictionalContext(lastUserText(messages))
}

function claimedPaths(response) {
  const found = new Set()
  for (const pattern of [QUOTED_PATH, BARE_PATH]) {
    pattern.lastIndex = 0
    let match
    while ((match = pattern.exec(response)) !== null) found.add(match[1] ?? match[0])
  }
  return [...found]
}

function receiptCoversClaim(receipts, response) {
  if (!Array.isArray(receipts) || receipts.length === 0) return false
  const paths = claimedPaths(response)
  return receipts.some((receipt) => {
    if (!receipt || typeof receipt !== 'object') return false
    const ok = receipt.status === 'ok' || receipt.status === 'success' || receipt.verified === true
    if (!ok || typeof receipt.path !== 'string' || !receipt.path) return false
    if (paths.length === 0) return true
    return paths.some((claimed) => claimed.includes(receipt.path) || receipt.path.includes(claimed))
  })
}

/**
 * Return a grounded replacement when the reply claims a file action without
 * a matching verified write receipt. Returns null when no correction applies.
 */
export function correctUnsupportedFileClaim(messages, response, toolReceipts = []) {
  if (!needsFileClaimFactCheck(messages, response)) return null
  if (receiptCoversClaim(toolReceipts, response)) return null
  return 'I have no verified write receipt for that file action — no write tool ran in this turn. '
    + 'Tell me the exact absolute path and what to put in it, and I will route it as an explicit action request '
    + 'instead of claiming it is already done.'
}
