import { randomBytes } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { isIP } from 'node:net'
import { networkInterfaces } from 'node:os'
import path from 'node:path'
import WebSocket from 'ws'

// Only explicit requests target the one paired local TV. Self-signed TLS trust
// is confined to this private IPv4 endpoint, never changed process-wide.
const MAC=/^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/i
const TOKEN=/^[A-Za-z0-9-]{4,64}$/
const CLIENT_NAME=Buffer.from('Nori').toString('base64')
const APPS=Object.freeze({netflix:'3201907018807',youtube:'111299001912','prime video':'3201910019365',prime:'3201910019365','disney+':'3201901017640',disney:'3201901017640',hulu:'3201601007625',spotify:'3201606009684'})
const ROOM='(?:living\\s*room|bedroom(?:\\s+\\d{1,2})?|kitchen|family\\s*room|office|den|basement)'
const TARGET='(?:(?:my|the|teh|our|your)\\s+)?(?:'+ROOM+'\\s+)?(?:samsung\\s+)?(?:tv|television)(?:\\s+in\\s+(?:the\\s+)?'+ROOM+')?'
function privateIp(value){if(typeof value!=='string'||isIP(value)!==4)return false;const[a,b]=value.split('.').map(Number);return a===10||a===192&&b===168||a===172&&b>=16&&b<=31}
function commandBody(text){
 const value=String(text??'').trim()
 if(!value||value.length>1200||/^["'`]|\n/.test(value)||/\b(?:don't|don['’]t|do not|never|without|not)\b/i.test(value))return null
 return value.replace(/^(?:(?:hey\s+)?nori[,:\s]+)?(?:(?:please|can you|could you|would you|will you)\s+)*(?:please\s+)?/i,'').replace(/[.!?]+$/,'').trim().toLowerCase()
}
export function parseTvAction(text){
 const body=commandBody(text);if(!body)return null
 const match=pattern=>body.match(new RegExp('^'+pattern+'$','i'))
 if(match('(?:connect|pair|link|set\\s*up)\\s+'+TARGET+'(?:\\s+(?:to|with)\\s+(?:you|nori))?'))return{pair:true}
 let m=match('(?:turn|switch|power)\\s+(on|off)\\s+'+TARGET)||match('(?:turn|switch|power)\\s+'+TARGET+'\\s+(on|off)')||match(TARGET+'\\s+(on|off)')
 if(m)return m[1]==='off'?{unsupported:'I do not have a verified state-setting power-off command. No power button was sent; use the TV remote.'}:{power:'on'}
 if(match('shut\\s+'+TARGET+'\\s+off'))return{unsupported:'I do not have a verified state-setting power-off command. No power button was sent; use the TV remote.'}
 if(match('toggle\\s+(?:the\\s+)?mute\\s+(?:on|for)\\s+'+TARGET)||match('toggle\\s+'+TARGET+'\\s+mute'))return{keys:['KEY_MUTE'],label:'mute toggle'}
 if(m=match('(mute|unmute)\\s+'+TARGET))return{mute:m[1].toLowerCase()==='mute'}
 const absolute=match('(?:set\\s+'+TARGET+'\\s+volume\\s+(?:to\\s+)?|turn\\s+'+TARGET+'\\s+volume\\s+to\\s+)(.+)')||match('(?:set|turn)\\s+(?:the\\s+)?volume\\s+(?:on|for)\\s+'+TARGET+'\\s+(?:to\\s+)?(.+)')
 if(absolute){const requested=absolute[1].trim();if(!/^(?:\d{1,4}%?|max(?:imum)?|min(?:imum)?)$/i.test(requested))return{unsupported:'Use one TV volume level from 0 to 100, or max. No volume command was sent.'};const level=/^max(?:imum)?$/i.test(requested)?100:/^min(?:imum)?$/i.test(requested)?0:Number(requested.replace(/%$/,''));if(!Number.isSafeInteger(level)||level<0||level>100)return{unsupported:'TV volume can be set from 0 to 100. No volume command was sent.'};return{setVolume:level}}
 m=match('(?:turn\\s+)?'+TARGET+'\\s+volume\\s+(up|down)(?:\\s+(?:by\\s+)?(\\d+))?')||match('(?:turn\\s+)?(?:the\\s+)?volume\\s+(up|down)\\s+(?:on|for)\\s+'+TARGET+'(?:\\s+(?:by\\s+)?(\\d+))?')||match('turn\\s+'+TARGET+'\\s+(up|down)(?:\\s+(?:by\\s+)?(\\d+))?')
 if(!m){const relative=match('(raise|increase|lower|decrease)\\s+(?:the\\s+)?volume\\s+(?:on|for)\\s+'+TARGET+'(?:\\s+(?:by\\s+)?(\\d+))?');if(relative)m=[relative[0],/^(raise|increase)$/.test(relative[1])?'up':'down',relative[2]]}
 if(m){const steps=m[2]===undefined?2:Number(m[2]);if(!Number.isSafeInteger(steps)||steps<1||steps>10)return{unsupported:'I can send 1 to 10 relative volume steps per request. No volume command was sent.'};return{keys:Array(steps).fill(m[1]==='up'?'KEY_VOLUP':'KEY_VOLDOWN'),label:'volume '+m[1]+' '+steps+' step'+(steps===1?'':'s')}}
 for(const[app,appId]of Object.entries(APPS)){const escaped=app.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');if(match('(?:open|launch|start|play|put|go\\s+to)\\s+(?:the\\s+)?'+escaped+'(?:\\s+app)?\\s+on\\s+'+TARGET))return{app,appId}}
 if(match('(?:open|show)\\s+(?:the\\s+)?(?:input|source|hdmi)(?:\\s+menu)?\\s+on\\s+'+TARGET)||match(TARGET+'\\s+(?:input|source|hdmi)(?:\\s+menu)?'))return{keys:['KEY_SOURCE'],label:'input-menu button'}
 if(match('(?:open|show)\\s+(?:the\\s+)?home(?:\\s+screen)?\\s+on\\s+'+TARGET)||match(TARGET+'\\s+home(?:\\s+screen)?'))return{keys:['KEY_HOME'],label:'home button'}
 // "play a veritasium video on the TV": top YouTube search result, played by the TV's YouTube app.
 if(m=match('(?:play|put(?:\\s+on)?|watch)\\s+(.{2,80}?)\\s+(?:(?:on|from)\\s+youtube\\s+)?on\\s+'+TARGET)){
  const raw=m[1].trim();if(APPS[raw.replace(/\s+app$/,'')])return{app:raw.replace(/\s+app$/,''),appId:APPS[raw.replace(/\s+app$/,'')]}
  const query=raw.replace(/^(?:(?:a|an|some|the)\s+)?(?:youtube\s+)?(?:videos?|something|anything|stuff)(?:\s+(?:about|on|of|for|by))?\s*/,'').replace(/^(?:a|an|some)\s+/,'').replace(/\s+(?:youtube\s+)?videos?$/,'').trim()||raw
  return{youtube:query}
 }
 // "say hi to danielle through the TV", "tell danielle dinner is ready on the TV": spoken in Nori's voice.
 const VIA='\\s+(?:on|through|thru|over|from)\\s+'+TARGET
 if(m=match('(?:say|send)\\s+(hi|hello|hey|good\\s?night|good\\s+morning)\\s+to\\s+([a-z][a-z\'-]{0,30})'+VIA))return{say:cap(m[1].replace(/\s+/g,' '))+' '+cap(m[2])+'! It’s Nori.'}
 if(m=match('tell\\s+([a-z][a-z\'-]{0,30})\\s+(?:that\\s+)?(.{1,200}?)'+VIA))return{say:cap(m[1])+', '+m[2]+'.'}
 if(m=match('say\\s+(.{1,200}?)'+VIA))return{say:cap(m[1])+'.'}
 return null
}
function cap(word){return word.charAt(0).toUpperCase()+word.slice(1)}
export function requestsTv(text){return parseTvAction(text)!==null}
export function requestsTvPairing(text){return parseTvAction(text)?.pair===true}
function configPath(root){if(typeof root!=='string'||!path.isAbsolute(root))throw Error('TV storage is unavailable');return path.join(root,'samsung-tv','tv.json')}
function validConfig(value){if(value?.schema!=='nori.samsung-tv.v1'||!privateIp(value.ip)||typeof value.token!=='string'||!TOKEN.test(value.token))return null;return{schema:'nori.samsung-tv.v1',ip:value.ip,token:value.token,mac:typeof value.mac==='string'&&MAC.test(value.mac)?value.mac.toLowerCase():null}}
function readConfig(root){try{return validConfig(JSON.parse(readFileSync(configPath(root),'utf8')))}catch{return null}}
function writeConfig(root,value){const file=configPath(root);mkdirSync(path.dirname(file),{recursive:true});const temporary=file+'.'+process.pid+'.'+Date.now()+'.tmp';writeFileSync(temporary,JSON.stringify(value)+'\n',{encoding:'utf8',mode:0o600,flag:'wx'});renameSync(temporary,file)}

// ws supplies RFC6455 Upgrade/Accept validation, TCP/continuation reassembly,
// control-frame handling and payload limits. Keep early TV acknowledgements
// queued until the caller subscribes; open and first message may share a packet.
function openChannel(ip,token,{timeoutMs=8000,WebSocketClass=WebSocket,socketFactory,signal}={}){
 if(signal?.aborted)return Promise.reject(Error('The TV request was cancelled'))
 if(!privateIp(ip)||token!==null&&(typeof token!=='string'||!TOKEN.test(token))||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>45000)return Promise.reject(Error('The local TV connection parameters are invalid'))
 const url=new URL('wss://'+ip+':8002/api/v2/channels/samsung.remote.control');url.searchParams.set('name',CLIENT_NAME);if(token)url.searchParams.set('token',token)
 return new Promise((resolve,reject)=>{
  let opened=false,closed=false,settled=false;const backlog=[],listeners=new Set()
  const ws=new WebSocketClass(url.href,{rejectUnauthorized:false,servername:'',handshakeTimeout:timeoutMs,maxPayload:65536,perMessageDeflate:false,followRedirects:false,...(socketFactory?{createConnection:socketFactory}:{})})
  const timer=setTimeout(()=>{if(!settled){settled=true;reject(Error('The TV connection timed out'))}end();ws.terminate()},timeoutMs)
  const notify=value=>{for(const listener of [...listeners])listener(value)}
  const end=()=>{if(closed)return;closed=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);notify({event:'nori.transport.closed'});if(!settled){settled=true;reject(Error('The TV connection closed before it was ready'))}}
  const onAbort=()=>{if(!settled){settled=true;reject(Error('The TV request was cancelled'))}end();ws.terminate()}
  const channel={isOpen(){return !closed&&ws.readyState===WebSocketClass.OPEN},sendJson(value){if(closed||signal?.aborted||ws.readyState!==WebSocketClass.OPEN)throw Error('The TV connection is not writable');ws.send(JSON.stringify(value))},onMessage(listener){listeners.add(listener);if(closed)listener({event:'nori.transport.closed'});else for(const message of backlog.splice(0))listener(message);return()=>listeners.delete(listener)},close(){if(closed)return;end();ws.terminate()}}
  signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort()
  ws.on('message',data=>{if(closed)return;let value;try{value=JSON.parse(data.toString('utf8'))}catch{return}if(listeners.size)notify(value);else{if(backlog.length>=16){channel.close();return}backlog.push(value)}})
  ws.on('open',()=>{if(closed)return;opened=true;clearTimeout(timer);if(!settled){settled=true;resolve(channel)}})
  ws.on('error',()=>{if(!opened&&!settled){settled=true;reject(Error('The TV remote connection was refused or failed'))}end();ws.terminate()})
  ws.on('close',end)
 })
}
function waitFor(channel,predicate,timeoutMs){return new Promise(resolve=>{let done=false,stop=()=>{};const finish=value=>{if(done)return;done=true;clearTimeout(timer);stop();resolve(value)};const timer=setTimeout(()=>finish(null),timeoutMs);stop=channel.onMessage(message=>{if(message?.event==='nori.transport.closed')finish(null);else if(predicate(message))finish(message)});if(done)stop()})}
async function localJson(ip,suffix,{fetcher=fetch,signal}={}){
 signal?.throwIfAborted()
 if(!privateIp(ip)||!/^\/api\/v2\/(?:applications\/[0-9]+)?$/.test(suffix))throw Error('Invalid local TV endpoint')
 const response=await fetcher('http://'+ip+':8001'+suffix,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(4000)]):AbortSignal.timeout(4000),redirect:'error'})
 signal?.throwIfAborted()
 if(!response.ok)throw Error('The local TV status is unavailable')
 const reader=response.body?.getReader();if(!reader)throw Error('The TV status was empty');let bytes=0;const chunks=[]
 try{for(;;){signal?.throwIfAborted();const{done,value}=await reader.read();signal?.throwIfAborted();if(done)break;bytes+=value.length;if(bytes>65536)throw Error('The TV status exceeded its bound');chunks.push(Buffer.from(value))}}finally{await reader.cancel().catch(()=>{})}
 return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
function wake(mac,{signal}={}){if(signal?.aborted||!MAC.test(mac))return Promise.reject(Error('TV network address unavailable or request cancelled'));return new Promise((resolve,reject)=>{const bytes=Buffer.from(mac.split(':').map(x=>parseInt(x,16))),packet=Buffer.concat([Buffer.alloc(6,255),...Array(16).fill(bytes)]),socket=createSocket('udp4');let done=false;const finish=error=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);try{socket.close()}catch{}error?reject(Error('The TV wake signal could not be confirmed')):resolve()};const onAbort=()=>finish(Error('cancelled'));const timer=setTimeout(()=>finish(Error('timeout')),2000);signal?.addEventListener('abort',onAbort,{once:true});socket.once('error',finish);if(signal?.aborted){onAbort();return}try{socket.bind(()=>{if(done)return;try{socket.setBroadcast(true);socket.send(packet,9,'255.255.255.255',finish)}catch(error){finish(error)}})}catch(error){finish(error)}})}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))

export async function* pairTv(dataRoot,{ip='10.0.0.193',waitMs=45000,transport={},signal}={}){
 signal?.throwIfAborted()
 if(!privateIp(ip)||!Number.isInteger(waitMs)||waitMs<1||waitMs>45000){yield 'The pairing target must be a literal private IPv4 TV address. Nothing was paired.';return}
 let info
 try{info=await localJson(ip,'/api/v2/',{...transport,signal})}catch(error){if(signal?.aborted)throw error;yield 'I could not reach the TV’s local status endpoint. Nothing was paired.';return}
 yield 'Look at the Samsung TV and choose Allow with its remote. I will wait for that TV-owned approval.\n\n'
 let channel
 try{signal?.throwIfAborted();channel=await (transport.openChannel||openChannel)(ip,null,{timeoutMs:waitMs,signal});signal?.throwIfAborted();const reply=await waitFor(channel,message=>['ms.channel.connect','ms.channel.unauthorized','ms.channel.timeOut'].includes(message?.event),waitMs);signal?.throwIfAborted()
  const token=reply?.data?.token
  if(reply?.event==='ms.channel.connect'&&typeof token==='string'&&TOKEN.test(token)){
   const mac=typeof info?.device?.wifiMac==='string'&&MAC.test(info.device.wifiMac)?info.device.wifiMac.toLowerCase():null
   await(transport.writeConfig||writeConfig)(dataRoot,{schema:'nori.samsung-tv.v1',ip,mac,token,paired_at:new Date().toISOString()})
   yield 'Paired after the TV accepted the connection. The pairing token stays in local TV storage.';return
  }
  yield reply?.event==='ms.channel.unauthorized'?'The TV denied pairing. Nothing was saved.':'The TV did not confirm pairing in time. Nothing was saved.'
 }catch(error){if(signal?.aborted)throw error;yield 'I could not confirm TV pairing. Check the TV before retrying.'}finally{channel?.close()}
}
// The TV's UPnP RenderingControl service (port 9197) reads and sets mute/volume as explicit states.
const RENDERING='urn:schemas-upnp-org:service:RenderingControl:1'
async function rendering(ip,action,args='',{fetcher=fetch,signal}={}){
 signal?.throwIfAborted()
 if(!privateIp(ip)||!['GetMute','SetMute','GetVolume','SetVolume'].includes(action))throw Error('Invalid TV media request')
 const body='<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:'+action+' xmlns:u="'+RENDERING+'"><InstanceID>0</InstanceID><Channel>Master</Channel>'+args+'</u:'+action+'></s:Body></s:Envelope>'
 const boundedSignal=signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000)
 const response=await fetcher('http://'+ip+':9197/upnp/control/RenderingControl1',{method:'POST',redirect:'error',credentials:'omit',body,signal:boundedSignal,headers:{'content-type':'text/xml; charset="utf-8"',SOAPACTION:'"'+RENDERING+'#'+action+'"'}})
 boundedSignal.throwIfAborted()
 if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});throw Error('TV media service did not return a readable response')}
 const reader=response.body.getReader(),chunks=[];let bytes=0
 try{
  while(true){boundedSignal.throwIfAborted();const part=await reader.read();boundedSignal.throwIfAborted();if(part.done)break;bytes+=part.value.byteLength;if(bytes>4096)throw Error('TV media response exceeds limit');chunks.push(part.value)}
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock()}
 boundedSignal.throwIfAborted()
 return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))
}
function mediaValue(xml,tag,max){
 if(/<!DOCTYPE|<!ENTITY|<!--|<(?:\w+:)?Fault\b/i.test(xml))throw Error('Invalid TV media response')
 const values=[...xml.matchAll(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>','g'))]
 if(values.length!==1)throw Error('Missing or ambiguous TV state')
 const scalar=values[0][1].trim();if(!(max===1?/^[01]$/:/^\d{1,3}$/).test(scalar))throw Error('Invalid TV state')
 const value=Number(scalar);if(!Number.isSafeInteger(value)||value>max)throw Error('Invalid TV state')
 return value
}
const readMute=async(ip,options)=>mediaValue(await rendering(ip,'GetMute','',options),'CurrentMute',1)===1
const readVolume=async(ip,options)=>mediaValue(await rendering(ip,'GetVolume','',options),'CurrentVolume',100)
// YouTube search runs on youtube.com; playback starts through the TV's own DIAL
// YouTube endpoint (port 8080), the same route phone casting uses. No token needed.
const YOUTUBE_ID='111299001912'
async function boundedText(response,limit,signal){
 const reader=response.body?.getReader();if(!reader)throw Error('Empty response');let bytes=0;const chunks=[]
 try{for(;;){signal?.throwIfAborted();const{done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>limit)break;chunks.push(Buffer.from(value))}}finally{await reader.cancel().catch(()=>{})}
 return Buffer.concat(chunks).toString('utf8')
}
async function findYoutubeVideo(query,{fetcher=fetch,signal}={}){
 const bounded=signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)
 const response=await fetcher('https://www.youtube.com/results?search_query='+encodeURIComponent(query),{signal:bounded,redirect:'follow',credentials:'omit',headers:{'accept-language':'en-US'}})
 if(!response.ok){await response.body?.cancel().catch(()=>{});throw Error('YouTube search failed')}
 const page=await boundedText(response,6*1024*1024,bounded)
 const found=page.match(/"videoRenderer":\{"videoId":"([\w-]{11})"[\s\S]{0,6000}?"title":\{"runs":\[\{"text":"((?:[^"\\]|\\.){1,300})"/)
 if(!found)return null
 let title;try{title=JSON.parse('"'+found[2]+'"')}catch{title=found[2]}
 return{id:found[1],title:title.replace(/[*_`[\]]/g,'')}
}
async function playYoutube(ip,query,{fetcher=fetch,sleep:pause=sleep,signal}={}){
 let video
 try{video=await findYoutubeVideo(query,{fetcher,signal})}catch(error){if(signal?.aborted)throw error;return 'I could not search YouTube right now. Nothing was sent to the TV.'}
 if(!video||!/^[\w-]{11}$/.test(video.id))return 'I could not find a YouTube video for “'+query+'”. Nothing was sent to the TV.'
 try{
  const bounded=signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)
  const response=await fetcher('http://'+ip+':8080/ws/apps/YouTube',{method:'POST',redirect:'error',credentials:'omit',body:'v='+video.id,signal:bounded,headers:{'content-type':'text/plain; charset=utf-8',origin:'package:com.google.android.youtube'}})
  await response.body?.cancel().catch(()=>{})
  if(response.status!==201&&response.status!==200)return 'The TV refused the YouTube request (HTTP '+response.status+'). Nothing was started.'
 }catch(error){if(signal?.aborted)throw error;return 'I could not reach the TV’s YouTube app. Nothing was started.'}
 await pause(4000);signal?.throwIfAborted()
 try{const status=await localJson(ip,'/api/v2/applications/'+YOUTUBE_ID,{fetcher,signal});if(status?.visible===true)return 'The TV reports YouTube is open with **'+video.title+'** (https://youtu.be/'+video.id+').'}catch(error){if(signal?.aborted)throw error}
 return 'I sent the TV’s YouTube app **'+video.title+'**, but could not confirm it is showing. Check the TV.'
}

// Spoken messages: the bridge renders Nori's local voice, this module serves the
// clip once on the PC's address in the TV's subnet, and the TV's own media
// renderer (DLNA AVTransport) fetches and plays it. The bridge registers its
// voice renderer at startup; without one, nothing is sent.
let tvSpeech=null
export function setTvSpeech(render){tvSpeech=typeof render==='function'?render:null}
const AVTRANSPORT='urn:schemas-upnp-org:service:AVTransport:1'
function localAddressFor(ip){
 const prefix=ip.split('.').slice(0,3).join('.')+'.'
 for(const list of Object.values(networkInterfaces()))for(const item of list??[])if(item.family==='IPv4'&&!item.internal&&item.address.startsWith(prefix))return item.address
 return null
}
async function avTransport(ip,action,args,{fetcher=fetch,signal}={}){
 const body='<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:'+action+' xmlns:u="'+AVTRANSPORT+'"><InstanceID>0</InstanceID>'+args+'</u:'+action+'></s:Body></s:Envelope>'
 const bounded=signal?AbortSignal.any([signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000)
 const response=await fetcher('http://'+ip+':9197/upnp/control/AVTransport1',{method:'POST',redirect:'error',credentials:'omit',body,signal:bounded,headers:{'content-type':'text/xml; charset="utf-8"',SOAPACTION:'"'+AVTRANSPORT+'#'+action+'"'}})
 await response.body?.cancel().catch(()=>{})
 return response.ok
}
function xml(value){return value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
async function sayOnTv(ip,message,{render=tvSpeech,fetcher=fetch,serve=serveOnce,signal}={}){
 if(!render)return 'My voice is not available right now, so nothing was sent to the TV.'
 let audio
 try{audio=await render(message);signal?.throwIfAborted()}catch(error){if(signal?.aborted)throw error;return 'I could not render the message in my voice. Nothing was sent to the TV.'}
 const host=localAddressFor(ip);if(!host)return 'This PC has no address on the TV’s network, so nothing was sent to the TV.'
 const clip=await serve(audio,host,{signal})
 try{
  const meta=xml('<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/"><item id="0" parentID="-1" restricted="1"><dc:title>Nori</dc:title><upnp:class>object.item.audioItem.musicTrack</upnp:class><res protocolInfo="http-get:*:audio/wav:*">'+clip.url+'</res></item></DIDL-Lite>')
  if(!await avTransport(ip,'SetAVTransportURI','<CurrentURI>'+xml(clip.url)+'</CurrentURI><CurrentURIMetaData>'+meta+'</CurrentURIMetaData>',{fetcher,signal}))return 'The TV refused the message. Nothing was played.'
  if(!await avTransport(ip,'Play','<Speed>1</Speed>',{fetcher,signal}))return 'The TV accepted the message but refused to play it.'
  const fetched=await clip.fetched
  return fetched?'The TV played my message: “'+message+'”':'The TV accepted the message but never downloaded the audio. Windows Firewall may be blocking Nori; allow Nori on private networks and try again.'
 }catch(error){if(signal?.aborted)throw error;return 'I could not reach the TV’s media player. Nothing was played.'}
 finally{clip.close()}
}
// Serves one audio clip at an unguessable path on the given address for at most 20 seconds.
async function serveOnce(audio,host,{signal}={}){
 const pathName='/nori-'+randomBytes(16).toString('hex')+'.wav'
 let resolveFetched;const fetched=new Promise(resolve=>{resolveFetched=resolve})
 const server=createServer((request,response)=>{
  if(request.url!==pathName||!['GET','HEAD'].includes(request.method)){response.writeHead(404).end();return}
  response.writeHead(200,{'content-type':'audio/wav','content-length':audio.length})
  response.end(request.method==='HEAD'?undefined:audio,()=>{if(request.method==='GET')setTimeout(()=>resolveFetched(true),3000)})
 })
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,host,resolve)})
 const timer=setTimeout(()=>resolveFetched(false),20000)
 signal?.addEventListener('abort',()=>resolveFetched(false),{once:true})
 return{url:'http://'+host+':'+server.address().port+pathName,fetched,close:()=>{clearTimeout(timer);server.close()}}
}

export async function tvRequest(text,{dataRoot,transport={},signal}={}){
 signal?.throwIfAborted()
 const action=parseTvAction(text);if(action?.pair)return null
 if(!action)return 'I control the TV only on an explicit single TV command.'
 if(action.unsupported)return action.unsupported
 const config=validConfig(await(transport.readConfig||readConfig)(dataRoot));signal?.throwIfAborted();if(!config)return 'I am not paired with a verified local TV. Say “connect my TV” and choose Allow on the TV.'
 let awake=false;try{awake=(await localJson(config.ip,'/api/v2/',{...transport,signal}))?.device?.PowerState==='on'}catch(error){if(signal?.aborted)throw error}
 if(action.power==='on'){
  if(awake)return 'Your TV reports it is already on.'
  if(!config.mac)return 'I cannot wake the TV because its verified network address is unavailable. No wake signal was sent.'
  try{signal?.throwIfAborted();await(transport.wake||wake)(config.mac,{signal});signal?.throwIfAborted();return 'I sent the TV wake signal; I have not verified that it turned on.'}catch(error){if(signal?.aborted)throw error;return 'I could not confirm the TV wake signal was sent. Check the TV before retrying.'}
 }
 if(!awake)return 'The TV did not report that it is on. No control command was sent.'
 if(action.say!==undefined)return sayOnTv(config.ip,action.say,{render:transport.render||tvSpeech,fetcher:transport.fetcher||fetch,serve:transport.serve||serveOnce,signal})
 if(action.youtube!==undefined)return playYoutube(config.ip,action.youtube,{fetcher:transport.fetcher||fetch,sleep:transport.sleep||sleep,signal})
 const media={fetcher:transport.fetcher||fetch,signal}
 if(action.mute!==undefined){
  try{
   const before=await readMute(config.ip,media);signal?.throwIfAborted();if(before===action.mute)return action.mute?'The TV is already muted.':'The TV is already unmuted.'
   await rendering(config.ip,'SetMute','<DesiredMute>'+(action.mute?1:0)+'</DesiredMute>',media)
   signal?.throwIfAborted();const after=await readMute(config.ip,media);signal?.throwIfAborted();return after===action.mute?(action.mute?'Done: the TV is muted (checked with the TV).':'Done: the TV is unmuted (checked with the TV).'):'I asked the TV to '+(action.mute?'mute':'unmute')+', but it still reports the old state.'
  }catch(error){if(signal?.aborted)throw error;return 'I could not read or set the TV mute state. No toggle was sent.'}
 }
 if(action.setVolume!==undefined){
  try{
   await rendering(config.ip,'SetVolume','<DesiredVolume>'+action.setVolume+'</DesiredVolume>',media)
   signal?.throwIfAborted();const level=await readVolume(config.ip,media);signal?.throwIfAborted()
   return level===action.setVolume?'Done: TV volume is '+level+' (checked with the TV).':'I asked for volume '+action.setVolume+', but the TV reports '+level+'.'
  }catch(error){if(signal?.aborted)throw error;return 'I could not set the TV volume. Check the TV before retrying.'}
 }
 let channel,sent=0
 try{
  channel=await(transport.openChannel||openChannel)(config.ip,config.token,{signal});signal?.throwIfAborted()
  const ready=await waitFor(channel,message=>['ms.channel.connect','ms.channel.unauthorized','ms.channel.timeOut'].includes(message?.event),6000)
  signal?.throwIfAborted();if(ready?.event!=='ms.channel.connect')return 'The TV did not authorize the remote session. No control command was sent.'
  if(action.appId){channel.sendJson({method:'ms.channel.emit',params:{event:'ed.apps.launch',to:'host',data:{appId:action.appId,action_type:'DEEP_LINK'}}});sent++
   await(transport.sleep||sleep)(4000)
   signal?.throwIfAborted();try{const status=await localJson(config.ip,'/api/v2/applications/'+action.appId,{...transport,signal});if(status?.running===true||status?.visible===true)return 'The TV reports '+action.app+' is open.'}catch(error){if(signal?.aborted)throw error}
   return 'I sent the '+action.app+' launch request, but could not confirm it opened. Check the TV before retrying.'
  }
  const keys=action.keys
  for(const key of keys){signal?.throwIfAborted();channel.sendJson({method:'ms.remote.control',params:{Cmd:'Click',DataOfCmd:key,Option:'false',TypeOfRemote:'SendRemoteKey'}});sent++;await(transport.sleep||sleep)(250);signal?.throwIfAborted();if(channel.isOpen?.()===false)throw Error('The TV connection closed after a command')}
  if(/^volume /.test(action.label)){await(transport.sleep||sleep)(400);try{signal?.throwIfAborted();const level=await readVolume(config.ip,media);signal?.throwIfAborted();return 'I sent the TV '+action.label+'; the TV now reports volume '+level+'.'}catch(error){if(signal?.aborted)throw error}}
  return 'I sent the TV '+action.label+'. I have not verified its resulting state.'
 }catch(error){if(signal?.aborted)throw error;return sent?'The TV request may be partially sent. Check the TV before retrying; no rollback is claimed.':'I could not confirm the TV control request completed. Check the TV before retrying.'}finally{channel?.close()}
}

