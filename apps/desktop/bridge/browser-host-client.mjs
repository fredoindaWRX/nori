import { randomUUID } from 'node:crypto'

export function browserHostCall(operation, args = {}, { signal, channel = process } = {}) {
  if (!['status', 'start', 'stop', 'inspect', 'navigate', 'click', 'fill'].includes(operation)) return Promise.reject(Error('Unsupported browser operation'))
  if (typeof channel.send !== 'function' || !channel.connected) return Promise.reject(Error('Nori browser connection unavailable'))
  return new Promise((resolve, reject) => {
    const id = randomUUID()
    let settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true; clearTimeout(timer)
      channel.off('message', receive); channel.off('disconnect', disconnected)
      signal?.removeEventListener('abort', abort)
      if (error) reject(error); else resolve(result)
    }
    const receive = message => {
      if (message?.kind === 'nori-browser-result' && message.id === id) finish(message.error ? Error(message.error) : null, message.result)
    }
    const disconnected = () => finish(Error('Nori browser connection closed'))
    const abort = () => {
      if (channel.connected) try { channel.send({ kind: 'nori-browser-call', id: randomUUID(), operation: 'stop', args: {} }, () => {}) } catch {}
      finish(Error('Browser request stopped; inspect session state before retrying'))
    }
    // A read-only readiness check must not stop an existing browser on timeout.
    const timer = operation === 'status'
      ? setTimeout(() => finish(Error('Browser status check timed out')), 5000)
      : setTimeout(abort, 120000)
    channel.on('message', receive); channel.on('disconnect', disconnected)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) return abort()
    try { channel.send({ kind: 'nori-browser-call', id, operation, args }, error => { if (error) finish(error) }) }
    catch (error) { finish(error) }
  })
}
