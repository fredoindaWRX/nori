// The voice button beside the chat box used to toggle the microphone, so pressing
// it while the mic was on switched the mic off. Make it a "talk now" button:
// turn the mic on if needed, then start listening (same as pressing Space).
// The MIC button and the M key still turn the microphone off.
(() => {
  'use strict'
  const listen = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', key: ' ' }))
  document.addEventListener('click', event => {
    const button = event.target instanceof Element ? event.target.closest('button.textbar-attach[aria-label]') : null
    if (!button) return
    const label = button.getAttribute('aria-label')
    if (label === 'Disable voice input') {
      // Mic already on: start listening instead of muting.
      event.preventDefault()
      event.stopPropagation()
      button.blur()
      listen()
    } else if (label === 'Enable voice input') {
      // Let the original handler unmute, then start listening once the mic is up.
      setTimeout(listen, 900)
    }
  }, true)
  // Keep the tooltip truthful about what the button now does.
  const retitle = () => {
    for (const button of document.querySelectorAll('button.textbar-attach[aria-label$="voice input"]')) {
      const title = button.getAttribute('aria-label') === 'Disable voice input'
        ? 'Talk to Nori now (turn the microphone off with MIC or the M key)'
        : 'Turn on the microphone and talk to Nori'
      if (button.title !== title) button.title = title
    }
  }
  new MutationObserver(retitle).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label'] })
  retitle()
})()
