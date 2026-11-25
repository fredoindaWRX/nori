// When the owner last engaged Nori (a chat turn started). Idle-time work such as her own
// self-test waits on this and stops the moment it moves. Process-local; nothing is stored.
let lastActivity = Date.now()
export function markActivity(now = Date.now()) { lastActivity = now }
export function lastActivityAt() { return lastActivity }
