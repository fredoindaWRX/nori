// Serialized into the authenticated mobile page; no microphone access at load.
function installMobileVoice(createGate) {
  const panel = document.createElement('section')
  panel.setAttribute('aria-label', 'Call Nori')
  panel.style.cssText = 'padding:8px 16px;display:flex;gap:8px;flex-wrap:wrap'
  const call = document.createElement('button'), record = document.createElement('button'), read = document.createElement('button'), label = document.createElement('span')
  call.textContent = 'Call Nori'; record.textContent = 'Record message'; read.textContent = 'Read latest reply'
  record.disabled = read.disabled = true
  label.setAttribute('role', 'status')
  panel.append(call, record, read, label)
  const automatic = document.createElement('button')
  automatic.textContent = 'Auto send/read: off'
  automatic.setAttribute('aria-pressed', 'false')
  panel.append(automatic)
  const handsfree = document.createElement('button')
  handsfree.textContent = 'Hands-free: off'; handsfree.setAttribute('aria-pressed', 'false')
  panel.append(handsfree)
  document.body.insertBefore(panel, document.getElementById('activity-panel'))
  let token = null, stream = null, recorder = null, playback = null, objectUrl = null, generation = 0, pending = false, expiry = null, recordingTimer = null
  const controllers = new Set()
  let auto = false, autoTimer = null, lastRead = null
  let audioContext = null, analyser = null, sourceNode = null, vadTimer = null, gate = null, handsfreeOn = false
  let handsfreeStarting = false
  let detectedSpeech = false, automaticRecording = false, recordingBegan = 0
  function stopHandsfree() {
    handsfreeOn = false; clearTimeout(vadTimer)
    sourceNode?.disconnect(); sourceNode = null; analyser = null
    if (audioContext) void audioContext.close().catch(() => {})
    audioContext = null; gate = null
    handsfree.textContent = 'Hands-free: off'; handsfree.setAttribute('aria-pressed', 'false')
    if (automaticRecording && recorder?.state === 'recording') { detectedSpeech = false; recorder.stop() }
  }
  function listenTick() {
    if (!handsfreeOn || !token || !analyser) return
    if (!pending && !playback && !document.getElementById('send').disabled) {
      if (recorder?.state !== 'recording') {
        automaticRecording = true; detectedSpeech = false; recordingBegan = Date.now(); gate.reset()
        record.onclick()
        if (recorder?.state !== 'recording') { stopHandsfree(); return }
      }
      const samples = new Float32Array(analyser.fftSize)
      analyser.getFloatTimeDomainData(samples)
      const event = gate.sample(samples, Date.now())
      if (event === 'start') detectedSpeech = true
      if (event === 'stop' || (!detectedSpeech && Date.now() - recordingBegan >= 5000)) recorder.stop()
    }
    vadTimer = setTimeout(listenTick, 50)
  }
  handsfree.onclick = async () => {
    if (handsfreeStarting) return
    if (handsfreeOn) { stopHandsfree(); return }
    if (!token || !stream) { label.textContent = 'Start a call before enabling hands-free'; return }
    const epoch = generation
    handsfreeStarting = true; handsfree.disabled = true
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      if (!AudioContextClass || typeof createGate !== 'function') throw Error('Unavailable')
      audioContext = new AudioContextClass(); await audioContext.resume()
      if (epoch !== generation || !token) { stopHandsfree(); return }
      analyser = audioContext.createAnalyser(); analyser.fftSize = 2048
      sourceNode = audioContext.createMediaStreamSource(stream); sourceNode.connect(analyser)
      gate = createGate(); handsfreeOn = true
      if (!auto) automatic.onclick()
      handsfree.textContent = 'Hands-free: on'; handsfree.setAttribute('aria-pressed', 'true')
      label.textContent = 'Hands-free listening locally; pauses while Nori speaks'
      listenTick()
    } catch { stopHandsfree(); label.textContent = 'Hands-free unavailable; manual recording still works' }
    finally { handsfreeStarting = false; handsfree.disabled = false }
  }
  function latestReply() { return [...document.querySelectorAll('.message.nori')].at(-1) }
  function checkReply() {
    clearTimeout(autoTimer)
    if (!auto || !token) return
    const latest = latestReply()
    if (!pending && !playback && recorder?.state !== 'recording' && latest?.dataset.complete === 'true'
        && latest.dataset.id && latest.dataset.id !== lastRead) {
      lastRead = latest.dataset.id
      void read.onclick()
    }
    autoTimer = setTimeout(checkReply, 750)
  }
  automatic.onclick = () => {
    auto = !auto
    automatic.textContent = auto ? 'Auto send/read: on' : 'Auto send/read: off'
    automatic.setAttribute('aria-pressed', String(auto))
    lastRead = latestReply()?.dataset.id || null
    label.textContent = auto ? 'Recorded messages will send automatically; completed replies will be read aloud. Tool approvals still apply.' : 'Review transcripts before sending'
    checkReply()
  }
  async function post(path, body, format = 'json') {
    const controller = new AbortController(); controllers.add(controller)
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(65000)]) })
      if (!response.ok) throw Error('Local voice request failed')
      return await response[format]()
    } finally { controllers.delete(controller) }
  }
  function silence() {
    playback?.pause(); playback = null
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }
  function hangup() {
    generation++; const old = token; token = null
    stopHandsfree()
    clearTimeout(expiry); clearTimeout(recordingTimer); recordingTimer = null
    clearTimeout(autoTimer); auto = false
    automatic.textContent = 'Auto send/read: off'; automatic.setAttribute('aria-pressed', 'false')
    for (const controller of controllers) controller.abort()
    if (recorder?.state === 'recording') recorder.stop()
    recorder = null
    stream?.getTracks().forEach(track => track.stop()); stream = null
    silence(); pending = false
    call.disabled = false; call.textContent = 'Call Nori'
    record.disabled = read.disabled = true; record.textContent = 'Record message'; label.textContent = 'Call ended'
    if (old) void fetch('/voice/end', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: old }), keepalive: true, signal: AbortSignal.timeout(5000) }).catch(() => {})
  }
  call.onclick = async () => {
    if (token || stream) return hangup()
    const epoch = ++generation; call.disabled = true
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw Error('Recording unavailable')
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true }, video: false })
      if (epoch !== generation) { acquired.getTracks().forEach(track => track.stop()); return }
      stream = acquired
      for (const track of acquired.getTracks()) track.addEventListener('ended', () => {
        if (epoch === generation && stream === acquired) { hangup(); label.textContent = 'Microphone stopped; call ended' }
      }, { once: true })
      if (acquired.getTracks().some(track => track.readyState === 'ended')) { hangup(); label.textContent = 'Microphone stopped; call ended'; return }
      const session = await post('/voice/start', {})
      if (epoch !== generation) return
      if (!/^[a-f0-9]{64}$/.test(session.token) || !Number.isFinite(session.expiresAt)) throw Error('Invalid call')
      token = session.token; call.textContent = 'Hang up'; record.disabled = read.disabled = false
      label.textContent = 'Connected locally · press Record message to speak'
      lastRead = latestReply()?.dataset.id || null
      checkReply()
      expiry = setTimeout(hangup, Math.max(1, Math.min(1800000, session.expiresAt - Date.now())))
    } catch { if (epoch === generation) { hangup(); label.textContent = 'Call unavailable. Check microphone permission and local voice services.' } }
    finally { if (epoch === generation) call.disabled = false }
  }
  record.onclick = () => {
    if (!token || pending) return
    if (recorder?.state === 'recording') { recorder.stop(); return }
    silence()
    const epoch = generation, chunks = []
    let bytes = 0, overflow = false
    const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(value => MediaRecorder.isTypeSupported(value))
    if (!type) { label.textContent = 'No supported local recording format'; return }
    clearTimeout(recordingTimer); recordingTimer = null
    try { recorder = new MediaRecorder(stream, { mimeType: type }) } catch { label.textContent = 'Microphone recording unavailable'; return }
    const currentRecorder = recorder
    currentRecorder.ondataavailable = event => {
      if (epoch !== generation || recorder !== currentRecorder) return
      bytes += event.data.size
      if (bytes > 8 * 1024 * 1024) { overflow = true; if (currentRecorder.state === 'recording') currentRecorder.stop() }
      else chunks.push(event.data)
    }
    currentRecorder.onstop = async () => {
      if (epoch !== generation || recorder !== currentRecorder || !token) return
      clearTimeout(recordingTimer); recordingTimer = null
      record.textContent = 'Record message'
      const discard = automaticRecording && !detectedSpeech
      automaticRecording = false
      if (discard) { read.disabled = false; return }
      if (overflow) { read.disabled = false; label.textContent = 'Recording too large; please use a shorter message'; return }
      pending = true; record.disabled = read.disabled = true; label.textContent = 'Transcribing locally…'
      try {
        const bytes = new Uint8Array(await new Blob(chunks, { type }).arrayBuffer())
        let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte)
        if (epoch !== generation || !token) return
        const result = await post('/voice/transcribe', { token, type, audio: btoa(binary) })
        if (epoch !== generation) return
        if (typeof result.text !== 'string') throw Error('Invalid transcript')
        const input = document.getElementById('prompt')
        if (input.value.trim()) { label.textContent = 'Your draft is preserved. Send or clear it before another voice message.'; return }
        input.value = result.text; input.dispatchEvent(new Event('input'))
        if (auto && result.text.trim() && result.text.length <= input.maxLength && !document.getElementById('send').disabled) {
          document.getElementById('composer').requestSubmit()
          label.textContent = 'Voice message submitted to the existing conversation; check chat for delivery'
        } else label.textContent = 'Transcript ready in your conversation. Review and press Send.'
      } catch { if (epoch === generation) label.textContent = 'Transcription failed; no message sent' }
      finally { if (epoch === generation) { pending = false; record.disabled = read.disabled = false } }
    }
    currentRecorder.onerror = () => { if (epoch === generation && recorder === currentRecorder) { hangup(); label.textContent = 'Recording failed; microphone released' } }
    try { currentRecorder.start(1000) } catch { hangup(); label.textContent = 'Recording failed; microphone released'; return }
    record.textContent = 'Finish recording'; read.disabled = true
    label.textContent = 'Recording · up to 30 seconds'
    recordingTimer = setTimeout(() => { if (epoch === generation && recorder === currentRecorder && currentRecorder.state === 'recording') currentRecorder.stop() }, 30000)
  }
  read.onclick = async () => {
    if (!token || pending || recorder?.state === 'recording') return
    const epoch = generation
    const rows = [...document.querySelectorAll('.message.nori')]
    const latest = rows.at(-1)
    if (latest?.dataset.complete !== 'true') { label.textContent = 'Wait for Nori to finish her reply'; return }
    const text = latest?.querySelector('.text')?.textContent
    if (!text) { label.textContent = 'No reply to read yet'; return }
    if (text.length > 2000) { label.textContent = 'This reply is too long for one speech request'; return }
    silence(); pending = true; read.disabled = record.disabled = true
    try {
      const audio = await post('/voice/speak', { token, text }, 'blob')
      if (epoch !== generation) return
      objectUrl = URL.createObjectURL(audio); playback = new Audio(objectUrl)
      const currentPlayback = playback
      playback.onended = () => { if (playback === currentPlayback) silence() }
      playback.onerror = () => {
        if (epoch === generation && playback === currentPlayback) {
          silence()
          label.textContent = 'Local voice playback failed; you can record or try reading again'
        }
      }
      await playback.play(); label.textContent = 'Nori is speaking · Record message interrupts playback'
    } catch {
      if (epoch === generation) {
        silence()
        label.textContent = 'Local voice playback unavailable; you can record or try reading again'
      }
    }
    finally { if (epoch === generation) { pending = false; read.disabled = record.disabled = false } }
  }
  window.addEventListener('pagehide', hangup)
  document.addEventListener('visibilitychange', () => { if (document.hidden) hangup() })
}
module.exports = { installMobileVoice }
