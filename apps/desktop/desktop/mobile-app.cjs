const MANIFEST = Object.freeze({
  id: '/', name: 'Nori', short_name: 'Nori', start_url: '/', scope: '/',
  display: 'standalone', background_color: '#0b0a0e', theme_color: '#0b0a0e',
  description: 'Your private connection to Nori on your PC.',
  icons: [192, 512].map(size => ({ src: `/app/nori-${size}.png`, sizes: `${size}x${size}`, type: 'image/png', purpose: 'any maskable' })),
})

function informationPage(title, content, { offline = false } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#0b0a0e">${offline ? '<meta http-equiv="refresh" content="10;url=/">' : ''}<title>${title}</title><style>:root{color-scheme:dark;font:17px/1.6 system-ui,-apple-system,sans-serif;background:#0b0a0e;color:#eee9f5}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;box-sizing:border-box}main{max-width:440px}.mark{width:64px;height:64px;display:grid;place-items:center;border:1px solid #469db9;border-radius:20px;background:linear-gradient(145deg,#11364b,#20132f);color:#b0f1f1;font-size:32px;font-weight:bold}h1{font-size:28px;line-height:1.2}p,li{color:#b9b2c3}li{margin:12px 0}a{color:#a6e8f5}strong{color:#f1eaf7}.note{font-size:14px;color:#97909f}</style></head><body><main><div class="mark" aria-hidden="true">N</div><h1>${title}</h1>${content}</main></body></html>`
}

const OFFLINE_PAGE = informationPage('Waiting for your PC', '<p>Nori connects privately to your own computer. Keep your PC awake, Nori running, and Tailscale connected on both devices.</p><p>Reconnecting every 10 seconds.</p><p><a href="/">Reconnect now</a></p><p class="note">No conversations are saved in this offline screen.</p>', { offline: true })
const INSTALL_PAGE = informationPage('Nori on your Home Screen', '<p>Open this private link in <strong>Safari</strong> on your iPhone, with Tailscale connected.</p><ol><li>Tap Safari’s <strong>Share</strong> button.</li><li>Choose <strong>Add to Home Screen</strong>. You may need to scroll down.</li><li>Keep <strong>Open as Web App</strong> enabled if it is shown, then tap <strong>Add</strong>.</li></ol><p>On Android, use your browser’s <strong>Install app</strong> or <strong>Add to Home screen</strong> option.</p><p>Nori runs on your PC. Your phone provides chat, optional voice, and task progress. Coding and System approvals stay on the desktop.</p><p><a href="/">Back to Nori</a></p>')

// Navigation fallback only. Do not cache conversations, tasks, audio, screenshots,
// authentication failures, or any other response from the private channel.
const SERVICE_WORKER = `'use strict';
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
const offline=()=>new Response(${JSON.stringify(OFFLINE_PAGE)},{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Retry-After':'10','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",'Permissions-Policy':'camera=(), microphone=(), geolocation=()'}});
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||event.request.mode!=='navigate'||new URL(event.request.url).origin!==self.location.origin)return;
 event.respondWith(fetch(event.request).then(async response=>{if(![502,503,504].includes(response.status))return response;await response.body?.cancel().catch(()=>{});return offline()}).catch(()=>offline()));
});`

function enhanceMobilePage(page) {
  if (typeof page !== 'string' || !page.includes('</head>') || !page.includes('</body>')) throw new TypeError('Mobile document required')
  return page.replace('</head>', '<link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/app/nori-180.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Nori"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><style>header{padding-top:env(safe-area-inset-top);height:calc(58px + env(safe-area-inset-top))}#install-help{display:block;text-align:center;padding:5px 0;color:#a6dce9;font-size:12px}html,body{height:var(--nori-mobile-height,100dvh)}section[aria-label="Call Nori"] button{padding:7px 10px;border:1px solid #39323f;border-radius:10px;background:#19151f;color:#d8d0e2;font-size:12px;touch-action:manipulation}section[aria-label="Call Nori"] button:first-child{background:#24434e;border-color:#437d90;color:#c3f4f5}section[aria-label="Call Nori"] button:disabled{opacity:.38}#activity-panel{font-size:13px;padding-bottom:max(12px,env(safe-area-inset-bottom))!important}@media(display-mode:standalone){#install-help{display:none}}</style></head>')
    .replace('<div id="hint">', '<a id="install-help" href="/install">Add Nori to your Home Screen</a><div id="hint">')
    .replace('</body>', '<script>function syncNoriViewport(){const h=window.visualViewport?.height;if(Number.isFinite(h)&&h>0)document.documentElement.style.setProperty("--nori-mobile-height",h+"px")}syncNoriViewport();window.visualViewport?.addEventListener("resize",syncNoriViewport);window.addEventListener("resize",syncNoriViewport);if("serviceWorker" in navigator){navigator.serviceWorker.register("/service-worker.js",{scope:"/",updateViaCache:"none"}).catch(()=>{});}</script></body>')
}

function mobileAsset(path) {
  if (path === '/manifest.webmanifest') return { type: 'application/manifest+json; charset=utf-8', body: Buffer.from(JSON.stringify(MANIFEST)) }
  if (path === '/service-worker.js') return { type: 'text/javascript; charset=utf-8', body: Buffer.from(SERVICE_WORKER), worker: true }
  if (path === '/install') return { type: 'text/html; charset=utf-8', body: Buffer.from(INSTALL_PAGE) }
  if (/^\/app\/nori-(180|192|512)\.png$/.test(path)) return { type: 'image/png', body: Buffer.from(require('./mobile-app-icons.cjs')[path], 'base64') }
  return null
}

function serveMobileAsset(response, asset) {
  response.writeHead(200, {
    'content-type': asset.type, 'content-length': asset.body.length, 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" + (asset.worker ? "; connect-src 'self'" : ''),
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    ...(asset.worker ? { 'service-worker-allowed': '/' } : {}),
  })
  response.end(asset.body)
}

module.exports = { MANIFEST, SERVICE_WORKER, enhanceMobilePage, mobileAsset, serveMobileAsset }
