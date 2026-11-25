const { createServer } = require('node:http')
const { installMobileVoice } = require('./mobile-voice.cjs')
const { createVoiceActivityGate } = require('./voice-activity.cjs')
const { installMobileTaskActivity } = require('./mobile-task-activity.cjs')
const { enhanceMobilePage, mobileAsset, serveMobileAsset } = require('./mobile-app.cjs')

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0b0a0e"><title>Nori Workspace</title>
<style>
:root{color-scheme:dark;font:16px/1.5 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0b0a0e;color:#ece9f2}*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;height:100dvh;overflow:hidden}body{display:flex;flex-direction:column;background:radial-gradient(ellipse at 50% -30%,#251833 0,transparent 55%),#0b0a0e}button,textarea{font:inherit}header{height:58px;flex:none;display:flex;align-items:center;gap:12px;padding:0 max(18px,calc((100vw - 960px)/2));border-bottom:1px solid #29242f;background:#100e14eF}.mark{width:30px;height:30px;flex:none;border:1px solid #725293;border-radius:10px;display:grid;place-items:center;color:#e6cfff;font-weight:700;background:linear-gradient(145deg,#2d1e3b,#111017);box-shadow:0 0 18px #8c58b526}.brand{font-weight:650;letter-spacing:.04em}.subbrand{color:#8f8998;font-size:12px;margin-left:4px}.spacer{flex:1}#status{display:flex;align-items:center;gap:7px;color:#aaa3b2;font-size:12px;white-space:nowrap}.dot{width:8px;height:8px;border-radius:50%;background:#8a6cac}.dot.online{background:#6cc89b;box-shadow:0 0 9px #6cc89b88}main{width:min(100%,820px);min-height:0;flex:1;margin:0 auto;display:flex;flex-direction:column;padding:24px 20px 0}#messages{min-height:0;flex:1;overflow:auto;overscroll-behavior:contain;padding:8px 0 28px;scrollbar-color:#393140 transparent;scrollbar-width:thin}.welcome{min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px;color:#bcb5c5}.welcome-mark{width:54px;height:54px;display:grid;place-items:center;border:1px solid #564166;border-radius:18px;color:#ead5ff;font-size:23px;background:linear-gradient(145deg,#2b2037,#131118);margin-bottom:18px;box-shadow:0 0 38px #9a70c41c}.welcome h1{margin:0 0 8px;color:#f1eaf7;font-size:24px;font-weight:600}.welcome p{max-width:390px;margin:0;color:#98919f;font-size:14px}.message{display:flex;gap:12px;align-items:flex-start;margin:0 0 22px;animation:arrive .16s ease-out}.avatar{width:28px;height:28px;flex:none;display:grid;place-items:center;border:1px solid #51405e;border-radius:9px;color:#e4ccfa;background:#201829;font-size:12px;font-weight:700}.message.user .avatar{border-color:#39343f;background:#211f25;color:#d7d0dc}.content{min-width:0;flex:1;padding-top:2px;overflow-wrap:anywhere;white-space:pre-wrap}.role{margin-bottom:4px;color:#c7b1dd;font-size:12px;font-weight:600}.message.user .role{color:#aaa4b0}.replying{color:#a89bb5}.composer-wrap{flex:none;padding:12px 0 max(16px,env(safe-area-inset-bottom));background:linear-gradient(transparent,#0b0a0e 15%)}form{display:flex;align-items:flex-end;gap:10px;padding:9px;border:1px solid #39323f;border-radius:18px;background:#151319;box-shadow:0 8px 28px #0005}textarea{display:block;width:100%;max-height:30vh;min-height:42px;resize:none;border:0;outline:0;padding:10px 9px;color:#f4eff8;background:transparent;font-size:16px;line-height:1.4}textarea::placeholder{color:#817a89}#send{width:42px;height:42px;flex:none;border:0;border-radius:13px;background:#ddd0eb;color:#241a2d;font-size:19px;font-weight:700;cursor:pointer;touch-action:manipulation}#send:disabled{opacity:.45}#hint{text-align:center;padding:9px 4px 0;color:#77717e;font-size:11px}#state{min-height:16px;color:#a79aaf;font-size:11px;text-align:center;padding-top:4px}@keyframes arrive{from{opacity:.25;transform:translateY(4px)}to{opacity:1;transform:none}}@media(max-width:600px){header{height:54px;padding:0 14px}.subbrand{display:none}main{padding:10px 14px 0}#messages{padding-top:14px}.message{gap:9px;margin-bottom:19px}.avatar{width:26px;height:26px}form{border-radius:16px}.composer-wrap{padding-top:9px}}
</style></head>
<body><header><div class="mark" aria-hidden="true">N</div><div class="brand">N.O.R.I.<span class="subbrand"> · workspace</span></div><div class="spacer"></div><div id="status" role="status"><span class="dot"></span><span>Connecting privately…</span></div></header>
<main><section id="messages" aria-label="Conversation with Nori" aria-live="polite"><div class="welcome"><div class="welcome-mark" aria-hidden="true">N</div><h1>Talk with Nori</h1><p>Your private conversation, through Nori’s local desktop session.</p></div></section><div class="composer-wrap"><form id="composer"><textarea id="prompt" aria-label="Message Nori" rows="1" maxlength="512" placeholder="Message Nori…" autocomplete="off" autocapitalize="sentences" spellcheck="false"></textarea><button id="send" aria-label="Send message" type="submit">↑</button></form><div id="state"></div><div id="hint">Enter to send · Shift + Enter for a new line</div></div></main>
<details id="activity-panel" style="padding:8px 16px;max-height:35vh;overflow:auto"><summary>Background activity</summary><div id="activity-list" aria-live="polite">Open to check saved tasks.</div></details>
<script>
const list=document.querySelector('#messages'),form=document.querySelector('#composer'),promptBox=document.querySelector('#prompt'),sendButton=document.querySelector('#send'),state=document.querySelector('#state'),statusText=document.querySelector('#status span:last-child'),statusDot=document.querySelector('.dot');let connected=false,busy=false,optimistic=[],nodes=new Map(),remoteMessages=new Map(),remoteOrder=[],previousNoriId=null,latestNoriId=null;
function makeMessage(message){const row=document.createElement('article');row.className='message '+(message.role==='user'?'user':'nori');row.dataset.id=message.id;const avatar=document.createElement('div');avatar.className='avatar';avatar.textContent=message.role==='user'?'Y':'N';avatar.setAttribute('aria-hidden','true');const body=document.createElement('div');body.className='content';const role=document.createElement('div');role.className='role';role.textContent=message.role==='user'?'You':'Nori';const text=document.createElement('div');text.className='text';body.append(role,text);row.append(avatar,body);return row}
function render(){const follow=list.scrollHeight-list.clientHeight-list.scrollTop<48;const merged=remoteOrder.map(id=>remoteMessages.get(id)).filter(Boolean);for(const draft of optimistic){if(!merged.some(message=>message.role==='user'&&message.text===draft.text&&(!draft.beforeUserIds||!draft.beforeUserIds.has(message.id))))merged.push(draft)}if(!merged.length){list.innerHTML='<div class="welcome"><div class="welcome-mark" aria-hidden="true">N</div><h1>Talk with Nori</h1><p>Your private conversation, through Nori’s local desktop session.</p></div>';nodes.clear();return}for(const welcome of list.querySelectorAll('.welcome'))welcome.remove();for(const message of merged){let row=nodes.get(message.id);if(!row){row=makeMessage(message);nodes.set(message.id,row)}row.querySelector('.text').textContent=message.text;list.appendChild(row)}for(const [id,row] of nodes)if(!merged.some(message=>message.id===id)){row.remove();nodes.delete(id)}if(follow)list.scrollTop=list.scrollHeight}
let pendingSend=null,lastUserIds=new Set();
function finishPhoneSend(pending,message=''){
 if(pendingSend!==pending)return;
 pendingSend=null;busy=false;sendButton.disabled=false;state.textContent=message;
}
function observePhoneSend(messages){
 const pending=pendingSend;if(!pending)return;
 const index=messages.findIndex(message=>message.role==='user'&&message.text===pending.text&&!pending.beforeUserIds.has(message.id));
 if(index<0){if(pending.userId)finishPhoneSend(pending,'Desktop conversation changed.');return}
 pending.userId=messages[index].id;
 pending.completed=messages.slice(index+1).some(message=>message.role==='nori'&&message.complete===true);
 if(pending.acknowledged&&pending.completed)finishPhoneSend(pending);
}
async function fetchConversation(){
 try{
  const response=await fetch('/conversation',{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error();const data=await response.json();if(!Array.isArray(data.messages))throw Error();
  connected=true;statusText.textContent='Private connection';statusDot.classList.add('online');
  const cleared=remoteOrder.length>0&&data.messages.length===0;
  if(cleared){optimistic=[];if(pendingSend)finishPhoneSend(pendingSend,'Desktop conversation changed.')}
  remoteMessages=new Map();remoteOrder=[];
  for(const message of data.messages){if(!remoteMessages.has(message.id))remoteOrder.push(message.id);remoteMessages.set(message.id,message)}
  lastUserIds=new Set(data.messages.filter(message=>message.role==='user').map(message=>message.id));
  optimistic=optimistic.filter(draft=>!data.messages.some(message=>message.role==='user'&&message.text===draft.text&&!draft.beforeUserIds.has(message.id)));
  if(remoteOrder.length>150){for(const id of remoteOrder.splice(0,remoteOrder.length-150))remoteMessages.delete(id)}
  latestNoriId=data.messages.filter(message=>message.role==='nori').at(-1)?.id||null;
  observePhoneSend(data.messages);render();
  for(const [id,row] of nodes)row.dataset.complete=remoteMessages.get(id)?.complete===true?'true':'false';
 }catch{connected=false;statusText.textContent='Reconnecting…';statusDot.classList.remove('online')}
 setTimeout(fetchConversation,connected?650:1500);
}
async function submitMessage(){
 const text=promptBox.value.trim();if(!text||sendButton.disabled)return;
 const pending={text,beforeUserIds:new Set(lastUserIds),acknowledged:false,completed:false,userId:null};
 pendingSend=pending;previousNoriId=latestNoriId;busy=true;sendButton.disabled=true;state.textContent='Sending to Nori…';
 try{
  const response=await fetch('/input',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'send',text}),signal:AbortSignal.timeout(15000)});
  const result=await response.json().catch(()=>({}));
  if(pendingSend!==pending)return;
  if(!response.ok){finishPhoneSend(pending,result.error==='nori_desktop_draft_pending'?'There is an unsent draft on your PC. Send or clear it there first.':result.error==='nori_chat_submission_pending'?'Another message is being submitted. Try again shortly.':result.error==='nori_text_submit_failed'?'Nori received the text, but submission needs attention.':result.error==='nori_text_input_not_focused'?'Nori’s text field is unavailable right now.':response.status===409?'Nori is not ready for remote chat.':'Could not send · tap to retry');return}
  pending.acknowledged=true;
  if(!pending.userId)optimistic.push({id:'local-'+Date.now()+'-'+Math.random().toString(36).slice(2),role:'user',text,beforeUserIds:pending.beforeUserIds});
  state.textContent='Nori is replying…';if(promptBox.value.trim()===text)promptBox.value='';resizePrompt();
  if(pending.completed)finishPhoneSend(pending);render();
 }catch{
  if(pendingSend!==pending)return;
  if(pending.userId){pending.acknowledged=true;if(promptBox.value.trim()===text)promptBox.value='';resizePrompt();state.textContent='Message reached Nori; waiting for the reply…';if(pending.completed)finishPhoneSend(pending)}
  else finishPhoneSend(pending,'Delivery not confirmed. Check the conversation before retrying.');
 }
}
function resizePrompt(){promptBox.style.height='auto';promptBox.style.height=Math.min(promptBox.scrollHeight,innerHeight*.3)+'px'}
promptBox.addEventListener('input',resizePrompt);form.addEventListener('submit',event=>{event.preventDefault();void submitMessage()});promptBox.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();form.requestSubmit()}});
fetchConversation();
(${installMobileTaskActivity.toString()})();
(${installMobileVoice.toString()})(${createVoiceActivityGate.toString()});
</script></body></html>`

const KEY_CODES = new Set([
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
  'ENTER', 'ESC', 'BACKSPACE', 'TAB', 'SPACE', 'LEFT', 'RIGHT', 'UP', 'DOWN',
  'DELETE', 'HOME', 'END', 'PAGEUP', 'PAGEDOWN',
])
const MODIFIERS = new Set(['shift', 'control', 'alt'])
const MAX_BODY = 2048

function decodeVoiceAudio(value) {
  if (typeof value !== 'string' || !value.length || value.length > 11184812 || value.length % 4 !== 0) throw Error('Invalid voice audio')
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length > 8 * 1024 * 1024 || decoded.toString('base64') !== value) throw Error('Invalid voice audio')
  return decoded
}

function json(response, status, value) {
  const body = Buffer.from(JSON.stringify(value))
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'content-length': body.length,
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
  })
  response.end(body)
}

function page(response) {
  const body = Buffer.from(enhanceMobilePage(PAGE))
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8', 'content-length': body.length,
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' blob:; media-src blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
    'permissions-policy': 'camera=(), microphone=(self), geolocation=()',
  })
  response.end(body)
}

function readBody(request, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const length = request.headers['content-length']
    if (request.headers['transfer-encoding'] || typeof length !== 'string' || !/^\d{1,8}$/.test(length)
        || Number(length) < 1 || Number(length) > limit) {
      reject(new Error('invalid_body_length'))
      request.resume()
      return
    }
    let size = 0
    const chunks = []
    const timer = setTimeout(() => { request.destroy(); reject(new Error('body_timeout')) }, 3000)
    request.on('data', chunk => {
      size += chunk.length
      if (size > limit) { clearTimeout(timer); request.destroy(); reject(new Error('body_too_large')); return }
      chunks.push(chunk)
    })
    request.on('end', () => {
      clearTimeout(timer)
      if (size !== Number(length)) return reject(new Error('body_length_mismatch'))
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
      catch { reject(new Error('invalid_json')) }
    })
    request.on('error', error => { clearTimeout(timer); reject(error) })
  })
}

function validPoint(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function makeInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  if (body.kind === 'pointer' && ['move', 'down', 'up'].includes(body.phase)
      && validPoint(body.x) && validPoint(body.y)) {
    if (body.phase === 'move' && Object.keys(body).sort().join(',') === 'kind,phase,x,y') {
      return { type: 'mouseMove', x: body.x, y: body.y }
    }
    if (['down', 'up'].includes(body.phase) && Object.keys(body).sort().join(',') === 'button,kind,phase,x,y'
        && ['left', 'right'].includes(body.button)) {
      return { type: body.phase === 'down' ? 'mouseDown' : 'mouseUp', button: body.button, x: body.x, y: body.y }
    }
  }
  if (body.kind === 'wheel' && Object.keys(body).sort().join(',') === 'deltaX,deltaY,kind,x,y'
      && validPoint(body.x) && validPoint(body.y)
      && [-120, 120].every(limit => Number.isFinite(body.deltaX) && Math.abs(body.deltaX) <= Math.abs(limit))
      && Number.isFinite(body.deltaY) && Math.abs(body.deltaY) <= 120) {
    return { type: 'mouseWheel', x: body.x, y: body.y, deltaX: body.deltaX, deltaY: body.deltaY }
  }
  if (body.kind === 'key' && ['down', 'up'].includes(body.phase) && KEY_CODES.has(body.key)
      && Array.isArray(body.modifiers) && body.modifiers.length <= 3
      && body.modifiers.every(item => MODIFIERS.has(item))
      && new Set(body.modifiers).size === body.modifiers.length
      && Object.keys(body).sort().join(',') === 'key,kind,modifiers,phase') {
    return { type: body.phase === 'down' ? 'keyDown' : 'keyUp', keyCode: body.key, modifiers: body.modifiers }
  }
  if (body.kind === 'text' && typeof body.text === 'string' && body.text.length > 0
      && body.text.length <= 512 && Buffer.byteLength(body.text, 'utf8') <= 1500
      && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(body.text)
      && Object.keys(body).sort().join(',') === 'kind,text') {
    return { type: 'insertText', text: body.text }
  }
  if (body.kind === 'send' && typeof body.text === 'string' && body.text.length > 0
      && body.text.length <= 512 && Buffer.byteLength(body.text, 'utf8') <= 1500
      && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(body.text)
      && Object.keys(body).sort().join(',') === 'kind,text') {
    return { type: 'sendText', text: body.text }
  }
  return null
}

function debuggerInput(input) {
  if (input.type === 'insertText') return ['Input.insertText', { text: input.text }]
  if (input.type === 'submitNoriDraft') return ['Runtime.evaluate', {
    expression: "(()=>{const i=document.querySelector('.textbar-input');const f=i?.closest('form.textbar');if(!i||!f||!i.value.trim())return false;f.requestSubmit();return true})()",
    returnByValue: true, userGesture: true,
  }]
  if (input.type === 'mouseMove') return ['Input.dispatchMouseEvent', { type: 'mouseMoved', x: input.x, y: input.y }]
  if (input.type === 'mouseDown' || input.type === 'mouseUp') {
    return ['Input.dispatchMouseEvent', {
      type: input.type === 'mouseDown' ? 'mousePressed' : 'mouseReleased',
      x: input.x, y: input.y, button: input.button, clickCount: 1,
    }]
  }
  if (input.type === 'mouseWheel') {
    return ['Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: input.x, y: input.y, deltaX: input.deltaX, deltaY: input.deltaY,
    }]
  }
  if (input.type === 'keyDown' || input.type === 'keyUp') {
    const key = input.keyCode
    const specialKeys = {
      ENTER: ['Enter', 'Enter', 13], ESC: ['Escape', 'Escape', 27],
      BACKSPACE: ['Backspace', 'Backspace', 8], TAB: ['Tab', 'Tab', 9],
      SPACE: [' ', 'Space', 32], LEFT: ['ArrowLeft', 'ArrowLeft', 37],
      RIGHT: ['ArrowRight', 'ArrowRight', 39], UP: ['ArrowUp', 'ArrowUp', 38],
      DOWN: ['ArrowDown', 'ArrowDown', 40], DELETE: ['Delete', 'Delete', 46],
      HOME: ['Home', 'Home', 36], END: ['End', 'End', 35],
      PAGEUP: ['PageUp', 'PageUp', 33], PAGEDOWN: ['PageDown', 'PageDown', 34],
    }
    const details = /^[A-Z]$/.test(key) ? [key.toLowerCase(), `Key${key}`, key.charCodeAt(0)]
      : /^[0-9]$/.test(key) ? [key, `Digit${key}`, key.charCodeAt(0)] : specialKeys[key]
    if (!details) throw new Error('Unsupported remote key')
    const modifierBits = { alt: 1, control: 2, shift: 8 }
    const modifiers = input.modifiers.reduce((bits, modifier) => bits | modifierBits[modifier], 0)
    const [keyValue, code, virtualKeyCode] = details
    const params = {
      type: input.type, key: keyValue, code, modifiers,
      nativeVirtualKeyCode: virtualKeyCode, windowsVirtualKeyCode: virtualKeyCode,
    }
    if (input.type === 'keyDown' && /^[A-Z0-9]$/.test(key)
        && !input.modifiers.includes('control') && !input.modifiers.includes('alt')) {
      params.text = key.length === 1 && /[A-Z]/.test(key)
        ? (input.modifiers.includes('shift') ? key : key.toLowerCase()) : key
      params.unmodifiedText = key.toLowerCase()
    }
    return ['Input.dispatchKeyEvent', params]
  }
  throw new Error('Unsupported remote input event')
}

function withDeadline(promise, timeoutMs) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Remote input dispatch timed out')), timeoutMs)
      timer.unref?.()
    }),
  ]).finally(() => clearTimeout(timer))
}

// Runs in Nori's own renderer only. Older shipped renderers do not publish a
// response-complete data attribute; use their explicit idle state and wait for
// the decode animation instead of leaving phone chat busy forever.
function readMobileConversation() {
  // A collapsed legacy transcript has no rows even when the conversation is
  // nonempty. Reject that unavailable snapshot instead of reporting a reset.
  if (document.querySelector('button[aria-label="Expand conversation panel"]')) throw new Error('Transcript snapshot unavailable while collapsed')
  const rows = [...document.querySelectorAll('.log-line')]
  const phase = document.querySelector('.status-text')?.textContent?.trim()
  const idle = ['STANDBY', 'LISTENING'].includes(phase)
    && !document.querySelector('.stop-btn, button[aria-label="Stop Nori"]')
  window.__noriRemoteEpoch ??= Math.random().toString(36).slice(2)
  window.__noriRemoteSerial ??= 0
  return rows.map(row => {
    let id = row.dataset.noriRemoteId
    if (!id) { id = window.__noriRemoteEpoch + '-' + (++window.__noriRemoteSerial); row.dataset.noriRemoteId = id }
    const content = row.querySelector('.log-text')
    const copy = content?.cloneNode(true)
    copy?.querySelectorAll('button').forEach(button => button.remove())
    const text = (typeof row.dataset.noriText === 'string' ? row.dataset.noriText : copy?.textContent || '').slice(0, 12000)
    const role = row.classList.contains('log-user') ? 'user' : 'nori'
    const complete = typeof row.dataset.responseComplete === 'string'
      ? row.dataset.responseComplete === 'true'
      : role === 'user' || Boolean(idle && text.trim() && !content?.querySelector('.decode-ghost'))
    return { id, role, complete, text }
  })
}

function createRemoteControlServer({ window, ownerLogin, origin, port = 8788, host = '127.0.0.1', clock = Date.now, activity = null, voice = null }) {
  if (!window?.webContents || typeof window.webContents.capturePage !== 'function'
      || typeof window.getContentSize !== 'function'
      || typeof window.webContents.debugger?.attach !== 'function'
      || typeof window.webContents.debugger?.isAttached !== 'function'
      || typeof window.webContents.debugger?.sendCommand !== 'function') throw new TypeError('Nori input target required')
  if (typeof ownerLogin !== 'string' || !ownerLogin.includes('@')) throw new TypeError('Tailscale owner identity required')
  const parsedOrigin = new URL(origin)
  if (parsedOrigin.protocol !== 'https:' || parsedOrigin.pathname !== '/' || parsedOrigin.search || parsedOrigin.hash
      || parsedOrigin.username || parsedOrigin.password) throw new TypeError('HTTPS tailnet origin required')
  if (!Number.isInteger(port) || port < 0 || port > 65535 || (port > 0 && port < 1024) || host !== '127.0.0.1') throw new TypeError('Loopback port required')

  let lastCapture = 0
  let capturePending = false
  let inputCount = 0
  let inputWindowStarted = 0
  let debuggerAttachedByService = false
  let attachPending = null
  let chatPending = false
  const debuggerSession = window.webContents.debugger
  async function ensureDebuggerAttached() {
    if (debuggerSession.isAttached()) return
    if (!attachPending) {
      attachPending = Promise.resolve().then(() => {
        if (!debuggerSession.isAttached()) {
          debuggerSession.attach()
          debuggerAttachedByService = true
        }
      }).finally(() => { attachPending = null })
    }
    await withDeadline(attachPending, 1500)
  }
  const server = createServer(async (request, response) => {
    const headers = request.headers
    if (request.socket.remoteAddress !== '127.0.0.1' && request.socket.remoteAddress !== '::ffff:127.0.0.1')
      return json(response, 403, { error: 'loopback_proxy_required' })
    if (headers['tailscale-user-login'] !== ownerLogin)
      return json(response, 403, { error: 'owner_identity_required' })
    const isPage = request.method === 'GET' && request.url === '/'
    // Safari fetches installation metadata without an Origin header. These
    // exact static assets remain behind the same owner identity check above.
    const asset = request.method === 'GET' ? mobileAsset(request.url) : null
    const trustedOrigin = headers.origin === parsedOrigin.origin ||
      (headers.origin === undefined && headers['sec-fetch-site'] === 'same-origin')
    if (!isPage && !asset && !trustedOrigin)
      return json(response, 403, { error: 'trusted_origin_required' })
    if (isPage) return page(response)
    if (asset) return serveMobileAsset(response, asset)
    if (['/voice/start', '/voice/end', '/voice/transcribe', '/voice/speak'].includes(request.url)) {
      if (request.method !== 'POST') return json(response, 405, { error: 'method_not_allowed' })
      if (!voice) return json(response, 503, { error: 'local_voice_unavailable' })
      if (headers['content-type'] !== 'application/json') return json(response, 400, { error: 'json_required' })
      let body, recording
      try {
        body = await readBody(request, request.url === '/voice/transcribe' ? 12 * 1024 * 1024 : 16 * 1024)
        if (!body || Array.isArray(body) || typeof body !== 'object') throw Error()
        const fields = { '/voice/start': '', '/voice/end': 'token', '/voice/transcribe': 'audio,token,type', '/voice/speak': 'text,token' }
        if (Object.keys(body).sort().join(',') !== fields[request.url]) throw Error()
        if (request.url !== '/voice/start' && (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token))) throw Error()
        if (request.url === '/voice/transcribe') {
          if (typeof body.type !== 'string') throw Error()
          recording = decodeVoiceAudio(body.audio)
        }
        if (request.url === '/voice/speak' && (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 2000)) throw Error()
      } catch { return json(response, 400, { error: 'invalid_voice_request' }) }
      try {
        if (request.url === '/voice/start') return json(response, 200, voice.start())
        if (request.url === '/voice/end') return json(response, 200, voice.end(body.token))
        if (request.url === '/voice/transcribe') {
          const text = await voice.transcribe(body.token, recording, body.type)
          return json(response, 200, { text })
        }
        const audio = await voice.speak(body.token, body.text)
        response.writeHead(200, { 'content-type': 'audio/wav', 'content-length': audio.length,
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        return response.end(audio)
      } catch { return json(response, 409, { error: 'voice_operation_failed_or_call_ended' }) }
    }
    if (request.url === '/activity' || /^\/activity\/[a-f0-9]{32}\/(?:cancel|steer)$/.test(request.url)) {
      const actionMatch = /^\/activity\/([a-f0-9]{32})\/(cancel|steer)$/.exec(request.url)
      const action = actionMatch?.[2] || null
      if (request.method !== (action ? 'POST' : 'GET')) return json(response, 405, { error: 'method_not_allowed' })
      if (typeof activity !== 'function') return json(response, 503, { error: 'activity_unavailable' })
      let direction = null
      if (action) {
        if (headers['content-type'] !== 'application/json') return json(response, 400, { error: 'json_required' })
        try {
          const body = await readBody(request, action === 'steer' ? 8192 : MAX_BODY)
          if (!body || Array.isArray(body) || typeof body !== 'object') throw Error()
          if (action === 'steer') {
            if (Object.keys(body).length !== 1 || typeof body.message !== 'string' || !body.message.trim() || body.message.length > 2000) throw Error()
            direction = body.message.trim()
          } else if (Object.keys(body).length) throw Error()
        } catch { return json(response, 400, { error: action === 'steer' ? 'invalid_task_direction' : 'empty_object_required' }) }
      }
      try {
        if (action === 'steer') {
          const accepted = await withDeadline(activity(actionMatch[1], action, direction), 13000)
          if (accepted?.accepted !== true || accepted?.scope_unchanged !== true) throw Error()
          return json(response, 200, { accepted: true, scope_unchanged: true,
            applies_at: 'next_safe_model_checkpoint' })
        }
        const result = await withDeadline(action === 'steer'
          ? activity(actionMatch[1], action, direction)
          : activity(actionMatch?.[1] || null, action), 13000)
        if (!Array.isArray(result.tasks)) throw Error()
        const tasks = result.tasks.slice(0,20).map(task => ({ id: task.id, goal: String(task.goal || '').slice(0,1200),
          status: task.status, response: task.status === 'awaiting_approval'
            ? 'Waiting for your confirmation in Nori on the desktop. No execution is authorized by this mobile view.' + (task.canStop === true ? ' You can stop the task here.' : ' Manage this task in Nori on the desktop.')
            : String(task.response || '').slice(0,16000), canStop: task.canStop === true,
          canSteer: task.canSteer === true,
          events: (Array.isArray(task.events) ? task.events : []).slice(-8)
            .filter(event => event && typeof event.message === 'string')
            .map(event => ({ message: event.message.slice(0,1500), at: typeof event.at === 'string' ? event.at.slice(0,64) : '' })) }))
        return json(response, 200, { tasks, unavailableSources: (Array.isArray(result.unavailableSources)
          ? result.unavailableSources : []).filter(source => source === 'work' || source === 'system') })
      } catch { return json(response, 503, { error: 'activity_unavailable' }) }
    }
    if (request.method === 'GET' && request.url === '/conversation') {
      if (window.isDestroyed?.())
        return json(response, 409, { error: 'nori_session_unavailable' })
      try {
        await ensureDebuggerAttached()
        const expression = '(' + readMobileConversation.toString() + ')()'
        const result = await withDeadline(debuggerSession.sendCommand('Runtime.evaluate', {
          expression, returnByValue: true,
        }), 2500)
        if (result?.exceptionDetails || !Array.isArray(result?.result?.value))
          return json(response, 503, { error: 'conversation_unavailable' })
        const messages = result.result.value.filter(item => item && typeof item.id === 'string'
          && item.id.length <= 100 && ['user', 'nori'].includes(item.role) && typeof item.text === 'string')
        return json(response, 200, { messages })
      } catch { return json(response, 503, { error: 'conversation_unavailable' }) }
    }
    if (request.method === 'GET' && ['/screen', '/screen?profile=mobile', '/screen?profile=desktop'].includes(request.url)) {
      const now = clock()
      if (capturePending || now - lastCapture < 400) return json(response, 429, { error: 'capture_rate_limited' })
      if (window.isDestroyed?.() || !window.isVisible?.() || window.isMinimized?.())
        return json(response, 409, { error: 'nori_window_not_visible' })
      capturePending = true
      lastCapture = now
      try {
        const captured = await window.webContents.capturePage()
        const dimensions = captured.getSize()
        const mobile = request.url === '/screen?profile=mobile'
        const maxWidth = mobile ? 800 : 1280
        const maxHeight = mobile ? 600 : 900
        const scale = Math.min(1, maxWidth / dimensions.width, maxHeight / dimensions.height)
        const image = scale < 1 ? captured.resize({
          width: Math.round(dimensions.width * scale), height: Math.round(dimensions.height * scale), quality: 'good',
        }) : captured
        const data = image.toJPEG(mobile ? 58 : 68)
        response.writeHead(200, {
          'content-type': 'image/jpeg', 'content-length': data.length,
          'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
          'x-nori-width': String(image.getSize().width), 'x-nori-height': String(image.getSize().height),
        })
        response.end(data)
      } catch { json(response, 503, { error: 'capture_unavailable' }) }
      finally { capturePending = false }
      return
    }
    if (request.method === 'POST' && request.url === '/input') {
      if (headers['content-type'] !== 'application/json') { request.resume(); return json(response, 400, { error: 'json_required' }) }
      let body
      try { body = await readBody(request) }
      catch (error) { return json(response, error.message === 'body_timeout' ? 408 : 400, { error: 'invalid_request' }) }
      const input = makeInput(body)
      if (!input) return json(response, 400, { error: 'unsupported_input' })
      if (window.isDestroyed?.() || (input.type !== 'sendText' && (!window.isVisible?.() || window.isMinimized?.())))
        return json(response, 409, { error: 'nori_window_not_visible' })
      const now = clock()
      if (now - inputWindowStarted >= 1000) { inputWindowStarted = now; inputCount = 0 }
      if (inputCount >= 120) return json(response, 429, { error: 'input_rate_limited' })
      inputCount += 1
      if (Number.isFinite(input.x) && Number.isFinite(input.y)) {
        let size
        try { size = window.getContentSize() }
        catch { return json(response, 503, { error: 'input_unavailable' }) }
        if (!Array.isArray(size) || size.length !== 2 || size.some(value => !Number.isFinite(value) || value < 1))
          return json(response, 503, { error: 'input_unavailable' })
        const [width, height] = size
        input.x = Math.round(input.x * Math.max(0, width - 1))
        input.y = Math.round(input.y * Math.max(0, height - 1))
      }
      if (input.type === 'sendText' && chatPending) return json(response, 409, { error: 'nori_chat_submission_pending' })
      if (input.type === 'sendText') chatPending = true
      try {
        await ensureDebuggerAttached()
        if (input.type === 'sendText') {
          const ready = await withDeadline(debuggerSession.sendCommand('Runtime.evaluate', {
            expression: "(()=>{const i=document.querySelector('.textbar-input');const f=i?.closest('form.textbar');if(!i||!f)return false;if(i.value.trim())return 'draft_pending';i.focus({preventScroll:true});return document.activeElement===i})()",
            returnByValue: true,
          }), 2000)
          if (ready?.result?.value === 'draft_pending') return json(response, 409, { error: 'nori_desktop_draft_pending' })
          if (ready?.result?.value !== true) return json(response, 409, { error: 'nori_text_input_not_focused' })
          await withDeadline(debuggerSession.sendCommand('Input.insertText', { text: input.text }), 2000)
          const [method, params] = debuggerInput({ type: 'submitNoriDraft' })
          const submitted = await withDeadline(debuggerSession.sendCommand(method, params), 2000)
          if (submitted?.exceptionDetails || submitted?.result?.value !== true)
            return json(response, 409, { error: 'nori_text_submit_failed', text_inserted: true })
        } else {
          const [method, params] = debuggerInput(input)
          await withDeadline(debuggerSession.sendCommand(method, params), 2000)
        }
      } catch { return json(response, 503, { error: 'input_unavailable' }) }
      finally { if (input.type === 'sendText') chatPending = false }
      return json(response, 200, { ok: true })
    }
    if (request.method !== 'GET' && request.method !== 'POST') { request.resume(); response.setHeader('allow', 'GET, POST'); return json(response, 405, { error: 'method_not_allowed' }) }
    request.resume()
    return json(response, 404, { error: 'not_found' })
  })
  server.headersTimeout = 5000
  server.requestTimeout = 5000
  server.maxHeadersCount = 24
  server.on('error', error => { server.lastError = error })
  const ready = new Promise((resolve, reject) => {
    const onListening = () => { cleanup(); resolve() }
    const onError = error => { cleanup(); reject(error) }
    const cleanup = () => { server.removeListener('listening', onListening); server.removeListener('error', onError) }
    server.once('listening', onListening)
    server.once('error', onError)
  })
  server.listen(port, host)
  return {
    server, ready,
    endpoint: `http://${host}:${port}`,
    stop: async () => {
      voice?.stop()
      if (server.listening) {
        const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        // Tailscale Serve keeps backend HTTP connections pooled. Close those
        // accepted sockets during shutdown so state ownership can be released.
        server.closeAllConnections?.()
        await closed
      }
      if (debuggerAttachedByService && window.webContents.debugger.isAttached()) {
        window.webContents.debugger.detach()
        debuggerAttachedByService = false
      }
    },
  }
}

module.exports = { createRemoteControlServer, debuggerInput, makeInput, decodeVoiceAudio, readMobileConversation }
