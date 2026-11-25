// Passive listener: keeps the latest affect values Nori's bridge already sends to this page, so the
// floating orb can colour itself by them. It only reads incoming messages and never sends anything.
(() => {
  const Native = window.WebSocket
  if (!Native) return
  window.WebSocket = class extends Native {
    constructor(...args) {
      super(...args)
      this.addEventListener('message', event => {
        if (typeof event.data !== 'string' || !event.data.includes('"affect"')) return
        try {
          const affect = JSON.parse(event.data)?.personality?.affect
          if (affect && typeof affect === 'object') window.__noriAffect = affect
        } catch { /* not a JSON message */ }
      })
    }
  }
})()
