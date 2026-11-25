import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { isIP } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { hueRequest } from './hue.mjs'
import { readInventory } from './network-watch.mjs'

const ENTITY = /^(light|switch|vacuum|media_player|camera|sensor|binary_sensor)\.[a-z0-9_]{1,120}$/
const clean = value => String(value ?? '').replace(/[\x00-\x1f<>`]/g, ' ').slice(0,160)
const fail = (error, extra = {}) => ({ success:false, verified:false, error, ...extra })
const privateHost = h => h === 'localhost' || (isIP(h) === 4 && (h.startsWith('10.') || h.startsWith('192.168.') || h.startsWith('127.') || /^172\.(1[6-9]|2\d|3[01])\./.test(h)))

// Use the same owner-enrolled configuration contract as shared/hardware/home_assistant.py.
// No model-facing tool accepts a URL, credential, arbitrary service, or payload.
export function homeAssistantConfig(dataRoot, legacyPath = 'C:/Nori/integrations/home_assistant.json') {
  const file = join(dataRoot, 'integrations', 'home_assistant.json')
  const selected = existsSync(file) ? file : legacyPath
  try {
    const c = JSON.parse(readFileSync(selected, 'utf8'))
    const u = new URL(c.base_url)
    if (c.trusted !== true || typeof c.token !== 'string' || !c.token || c.token.length > 4096 || /[\r\n]/.test(c.token)
      || !['http:','https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || !['','/'].includes(u.pathname)
      || (u.protocol === 'http:' && !privateHost(u.hostname))) return null
    return { base_url:u.origin, token:c.token }
  } catch { return null }
}

export function createHomeAssistantClient({ dataRoot, config, fetcher = fetch, signal, pause = delay } = {}) {
  const connection = config ?? homeAssistantConfig(dataRoot)
  async function request(route, body) {
    signal?.throwIfAborted()
    if (!connection) throw Error('home_assistant_not_configured')
    const bounded = signal ? AbortSignal.any([signal, AbortSignal.timeout(6000)]) : AbortSignal.timeout(6000)
    const response = await fetcher(connection.base_url + route, { method:body ? 'POST':'GET', redirect:'error', credentials:'omit', signal:bounded,
      headers:{ Authorization:`Bearer ${connection.token}`, 'Content-Type':'application/json' }, ...(body ? {body:JSON.stringify(body)}:{}) })
    if (!response.ok) { await response.body?.cancel(); throw Error('home_assistant_request_failed') }
    const reader = response.body?.getReader()
    if (!reader) throw Error('empty_response')
    const parts=[]; let size=0
    try { for (;;) { bounded.throwIfAborted(); const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>2_000_000)throw Error('response_too_large'); parts.push(value) } }
    finally { await reader.cancel().catch(()=>{}); reader.releaseLock() }
    bounded.throwIfAborted()
    return JSON.parse(Buffer.concat(parts).toString('utf8'))
  }
  const state = async id => {
    if (!ENTITY.test(id)) throw Error('invalid_entity')
    const value = await request('/api/states/'+id)
    if (value?.entity_id !== id || typeof value.state !== 'string') throw Error('invalid_state')
    return value
  }
  async function discover() {
    if (!connection) return fail('home_assistant_not_configured')
    try {
      const [states, services] = await Promise.all([request('/api/states'),request('/api/services')])
      if (!Array.isArray(states) || !Array.isArray(services)) return fail('invalid_inventory')
      const devices=states.filter(x=>ENTITY.test(x?.entity_id)).slice(0,2000).map(x=>({
        id:x.entity_id, name:clean(x.attributes?.friendly_name || x.entity_id), state:clean(x.state),
        observed_at:new Date().toISOString(), state_updated_at:clean(x.last_updated),
        available:!['unavailable','unknown'].includes(x.state),
        commands:commandsFor(x,services), provider:'home_assistant',
      }))
      return {success:true, devices, truncated:states.length>2000}
    } catch { signal?.throwIfAborted(); return fail('home_assistant_unreachable') }
  }
  async function command(id, action, ownerText) {
    if (!ENTITY.test(id)) return fail('invalid_entity')
    const inventory=await discover()
    if (!inventory.success) return inventory
    const device=inventory.devices.find(x=>x.id===id)
    if (!device?.available || !device.commands.includes(action)) return fail('unsupported_or_unavailable')
    if (!ownerRequested(ownerText,action,id,device.name)) return fail('owner_request_does_not_match')
    // Friendly names must be unique; entity IDs remain the disambiguation route.
    if (!String(ownerText).includes(id) && inventory.devices.filter(x=>x.name.toLowerCase()===device.name.toLowerCase()).length!==1) return fail('ambiguous_device_name')
    const [domain]=id.split('.')
    let sent=false
    try {
      const before=await state(id)
      if (['unavailable','unknown'].includes(before.state)) return fail('device_unavailable')
      await request(`/api/services/${domain}/${action}`,{entity_id:id}); sent=true
      const expected=EXPECTED[action]
      let after
      for(let attempt=0;attempt<4;attempt++) {
        if(attempt) await pause(350,undefined,{signal})
        after=await state(id)
        if(expected.includes(after.state)) return {success:true,accepted:true,verified:true,id,action,state:clean(after.state)}
      }
      return fail('state_not_confirmed',{accepted:true,id,action,state:clean(after?.state)})
    } catch { signal?.throwIfAborted(); return fail('command_not_confirmed',{accepted:sent,id,action}) }
  }
  return {configured:!!connection, discover, command}
}

const EXPECTED={ turn_on:['on'],turn_off:['off'],start:['cleaning'],pause:['paused'],stop:['idle','docked'],return_to_base:['returning','docked'] }
export function commandsFor(state, services) {
  const domain=state.entity_id.split('.')[0]
  const offered=services.find(s=>s.domain===domain)?.services || {}
  let allowed=[]
  if(['light','switch'].includes(domain)) allowed=['turn_on','turn_off']
  if(domain==='vacuum') {
    const features=Number(state.attributes?.supported_features)||0
    allowed=Object.entries({start:8192,pause:4,stop:8,return_to_base:16}).filter(([,bit])=>(features&bit)!==0).map(([name])=>name)
  }
  // TV control remains on Nori's paired, verified Samsung adapter. Cameras and sensors are read-only here.
  return allowed.filter(name=>Object.hasOwn(offered,name))
}

export function ownerRequested(text, action, id, name) {
  const normalized=String(text??'').trim().toLowerCase().replace(/[.!?]+$/,'').replace(/^(?:hey )?nori[, ]+/, '').replace(/^(?:please |can you |could you )/,'')
  const verbs={turn_on:['turn on','switch on'],turn_off:['turn off','switch off'],start:['start'],pause:['pause'],stop:['stop'],return_to_base:['dock','return to base']}
  return (verbs[action]||[]).some(verb=>[id,name].map(x=>String(x).toLowerCase()).some(target=>[`${verb} ${target}`,`${verb} the ${target}`,`${verb} my ${target}`].includes(normalized)))
}

export async function deviceHubReport({dataRoot,signal,fetcher=fetch,hue=hueRequest,client}={}) {
  signal?.throwIfAborted()
  const ha=client || createHomeAssistantClient({dataRoot,signal,fetcher})
  const result={schema:'nori.home-device-hub.v1',observed_at:new Date().toISOString(),providers:{},devices:[]}
  // Reuse the existing paired adapter; its output is a bounded read-only receipt.
  try { result.providers.hue={report:await hue('list my hue lights',{dataRoot,signal,fetcher})} }
  catch { signal?.throwIfAborted();result.providers.hue={error:'hue_unreachable'} }
  result.providers.samsung_tv={paired_config_present:existsSync(join(dataRoot,'samsung-tv','tv.json')),status:'not_polled',tool:'tv_control'}
  const discovered=await ha.discover()
  result.providers.home_assistant={configured:ha.configured,success:discovered.success,error:discovered.error,truncated:discovered.truncated===true}
  if(discovered.success)result.devices=discovered.devices
  const inventory=readInventory(dataRoot)
  result.network_observations={last_scan:inventory.last_scan??null,devices:Object.values(inventory.devices).slice(0,512).map(x=>({
    name:clean(x.label||'Unlabelled network device'),address:clean(x.last_ip),last_seen:clean(x.last_seen),controllable:false,
  }))}
  return result
}

export function formatDeviceHub(result) {
  const lines=['Nori home hub inventory',`Checked: ${result.observed_at}`,String(result.providers.hue.report||'Hue is currently unreachable.'),
    result.providers.samsung_tv.paired_config_present?'Samsung TV: saved pairing found; use the TV tool. Current power and volume have not been checked.':'Samsung TV: pairing is required.']
  if(result.providers.home_assistant.success) {
    lines.push(`Home Assistant: ${result.devices.length} entities.`)
    for(const x of result.devices.slice(0,30))lines.push(`${x.id} (${x.name}): ${x.state}; commands: ${x.commands.join(', ')||'none through this hub'}.`)
    if(result.devices.length>30||result.providers.home_assistant.truncated)lines.push('Inventory display is limited; additional entities are omitted.')
  } else lines.push(result.providers.home_assistant.configured?'Home Assistant is configured but unreachable. No device state was inferred.':'Home Assistant is not connected. SmartThings, Ring and other devices need an enrolled integration before I can use them.')
  const net=result.network_observations
  lines.push(`Network cache: ${net.devices.length} observations; last scan ${net.last_scan||'never'}. These are not proof of current availability or control.`)
  for(const x of net.devices.slice(0,20))lines.push(`${x.name}: ${x.address}; last seen ${x.last_seen}.`)
  return lines.join('\n').slice(0,9000)
}

export async function homeDeviceCommand(args,options) {
  const client=options.client||createHomeAssistantClient(options)
  const r=await client.command(args.entity_id,args.command,options.ownerText)
  return r.verified?`Confirmed by Home Assistant: ${r.id} is ${r.state}.`:
    `Home hub: ${r.error}. ${r.accepted?'The command was accepted but its result is unconfirmed. Check the device before retrying.':'No completed device action is claimed.'}`
}
