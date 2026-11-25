import {localEndpoint,localFetch} from './local-policy.mjs'
export function isLocationQuestion(text){return /^(?:hey nori[, ]*)?(?:where am i|what(?:'s| is) my (?:current )?location|where(?:'m| am) i at)[?.!\s]*$/i.test(text.trim())}
export function locationControl(text){
  const match=/^(?:hey nori[, ]*)?(pause|stop|resume|enable) (?:my |phone )?location sharing[.!\s]*$/i.exec(text.trim())
  return match ? ['pause','stop'].includes(match[1].toLowerCase())?'pause':'enable' : null
}
export async function controlLocation(action,{endpoint=process.env.NORI_LOCATION_URL,password=process.env.NORI_LOCATION_OWNER_PASSWORD}={}){
  if(!['pause','enable'].includes(action))throw new Error('Unknown location control')
  if(!endpoint||!password)return 'Your phone location is not connected to Nori yet.'
  try {
    const base=localEndpoint('Nori location receiver',endpoint)
    const response=await localFetch(`${base}/location/control`,{method:'POST',signal:AbortSignal.timeout(3000),headers:{authorization:`Basic ${Buffer.from(`owner:${password}`).toString('base64')}`,'content-type':'application/json'},body:JSON.stringify({action})})
    if(!response.ok)throw new Error('Location control failed')
    const length=Number(response.headers.get('content-length'))
    if(length>4096)throw new Error('Invalid control response')
    const reader=response.body.getReader();let size=0;const chunks=[]
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096)throw new Error('Invalid control response');chunks.push(Buffer.from(value))}}
    finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
    const state=JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if(state.enabled!==(action==='enable'))throw new Error('Location state not confirmed')
    return action==='pause'?'Location sharing is paused, and I cleared the last saved location. Your phone may still monitor location until you pause it in OwnTracks.':'The receiver is ready for phone location updates. Your iPhone still needs OwnTracks configured and location permission.'
  } catch{return 'I could not confirm the location-sharing change. Check the receiver; do not assume sharing stopped.'}
}
export async function locationAnswer({endpoint=process.env.NORI_LOCATION_URL,password=process.env.NORI_LOCATION_OWNER_PASSWORD,now=Date.now}={}){
  if(!endpoint||!password)return 'Your phone location is not connected to Nori yet.'
  try {
    const base=localEndpoint('Nori location receiver',endpoint)
    const response=await localFetch(`${base}/location/current`,{signal:AbortSignal.timeout(3000),headers:{authorization:`Basic ${Buffer.from(`owner:${password}`).toString('base64')}`}})
    if(!response.ok)throw new Error('Location unavailable')
    const reader=response.body.getReader();const chunks=[];let size=0
    try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096)throw new Error('Location response too large');chunks.push(Buffer.from(value))}}
    finally {await reader.cancel().catch(()=>{});reader.releaseLock()}
    const state=JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if(state.enabled!==true)return 'Phone location sharing is paused.'
    const p=state.location
    if(!p)return 'Location sharing is enabled, but your phone has not sent an update yet.'
    if(!Number.isFinite(p.latitude)||Math.abs(p.latitude)>90||!Number.isFinite(p.longitude)||Math.abs(p.longitude)>180||!Number.isFinite(p.timestamp)||!Number.isFinite(p.accuracyMeters)||p.accuracyMeters<0)throw new Error('Invalid location')
    const age=now()-p.timestamp*1000
    if(age < -60000)throw new Error('Invalid measurement time')
    if(state.stale===true||age>900000)return 'Your last phone location is over 15 minutes old. I cannot confirm where you are now.'
    return `Your latest phone update places you at latitude ${p.latitude.toFixed(5)}, longitude ${p.longitude.toFixed(5)}, with reported accuracy of about ${Math.ceil(p.accuracyMeters)} meters. Updated ${Math.max(0,Math.floor(age/60000))} minute(s) ago. I have not looked up an address.`
  } catch {return 'Your phone location is temporarily unavailable. I cannot confirm where you are.'}
}
