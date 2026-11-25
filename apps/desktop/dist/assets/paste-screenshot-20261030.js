// Paste a screenshot (Print Screen or Win+Shift+S, then Ctrl+V) or drop an image
// into Nori's chat. The image is handed to the composer's own attach input, so
// the existing size, type and review checks still apply; nothing is sent until
// the owner presses send.
(() => {
  'use strict'
  const LIMIT = 2_600_000 // the composer accepts images up to 2.8 MB
  const TYPES = ['image/png', 'image/jpeg', 'image/webp']
  const attachInput = () => document.querySelector('input[type="file"][aria-label="Choose an image or text file for Nori"]')

  async function fit(file) {
    if (TYPES.includes(file.type) && file.size <= LIMIT) return file
    const bitmap = await createImageBitmap(file)
    try {
      for (const [side, quality] of [[2560, 0.9], [1920, 0.85], [1600, 0.8], [1280, 0.75]]) {
        const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(bitmap.width * scale)
        canvas.height = Math.round(bitmap.height * scale)
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality))
        if (blob && blob.size <= LIMIT) return new File([blob], 'screenshot.jpg', { type: 'image/jpeg' })
      }
    } finally { bitmap.close() }
    throw new Error('Screenshot is too large to attach')
  }

  async function attach(file) {
    const input = attachInput()
    if (!input) return false
    const ready = await fit(file)
    const transfer = new DataTransfer()
    transfer.items.add(ready.name ? ready : new File([ready], 'screenshot.png', { type: ready.type }))
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    document.querySelector('.textbar-input')?.focus({ preventScroll: true })
    return true
  }

  const imageFrom = list => [...(list || [])].find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile() ?? null

  document.addEventListener('paste', event => {
    const file = imageFrom(event.clipboardData?.items)
    if (!file || !attachInput()) return
    event.preventDefault()
    attach(file).catch(error => console.warn('[nori] screenshot paste failed:', error.message))
  })
  document.addEventListener('dragover', event => {
    if ([...(event.dataTransfer?.items || [])].some(item => item.kind === 'file' && item.type.startsWith('image/'))) event.preventDefault()
  })
  document.addEventListener('drop', event => {
    const file = imageFrom(event.dataTransfer?.items)
    if (!file || !attachInput()) return
    event.preventDefault()
    attach(file).catch(error => console.warn('[nori] image drop failed:', error.message))
  })
})()
