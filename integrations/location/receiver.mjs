import {createServer} from 'node:http'
import {createHash,timingSafeEqual} from 'node:crypto'
import {createLatestLocation} from './latest-location.mjs'

const digest=value=>createHash('sha256').update(value).digest()
/** Private loopback receiver; publish and owner credentials are separate. */
export function createLocationReceiver({phonePassword,ownerPassword,hosts=['127.0.0.1','localhost'],store=createLatestLocation()}={}) {
  if(typeof phonePassword!=='string'||phonePassword.length<32||typeof ownerPassword!=='string'||ownerPassword.length<32||phonePassword===ownerPassword)throw new Error('Distinct strong phone and owner credentials are required')
  const credentials={phone:digest(`Basic ${Buffer.from(`phone:${phonePassword}`).toString('base64')}`),owner:digest(`Basic ${Buffer.from(`owner:${ownerPassword}`).toString('base64')}`)}
  const allowed=new Set(hosts)
  const server=createServer(async(req,res)=>{
    const headers={'content-type':'application/json','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'}
    const reply=(status,body)=>{res.writeHead(status,headers);res.end(JSON.stringify(body))}
    const host=(req.headers.host??'').toLowerCase().replace(/:\d+$/,'')
    if(!allowed.has(host)||req.headers.origin){reply(403,{error:'Request denied'});return}
    const auth=digest(req.headers.authorization??'')
    const role=timingSafeEqual(auth,credentials.owner)?'owner':timingSafeEqual(auth,credentials.phone)?'phone':null
    if(!role){res.setHeader('www-authenticate','Basic realm="Nori location"');reply(401,{error:'Authentication required'});return}
    if(!['GET','POST'].includes(req.method)){reply(405,{error:'Method not allowed'});return}
    if(req.url==='/location/current'&&req.method==='GET'){
      if(role!=='owner'){reply(403,{error:'Owner access required'});return}
      reply(200,store.read());return
    }
    const update=req.url==='/location/update'&&req.method==='POST'
    const control=req.url==='/location/control'&&req.method==='POST'
    if(!update&&!control){reply(404,{error:'Not found'});return}
    if(update&&role!=='phone'){reply(403,{error:'Phone publish access required'});return}
    if(control&&role!=='owner'){reply(403,{error:'Owner access required'});return}
    if((req.headers['content-type']??'').split(';')[0].trim().toLowerCase()!=='application/json'){reply(415,{error:'JSON required'});return}
    if(Number(req.headers['content-length'])>4096){reply(413,{error:'Request too large'});return}
    try {
      let size=0;const chunks=[]
      for await(const bytes of req){size+=bytes.length;if(size>4096){reply(413,{error:'Request too large'});return}chunks.push(bytes)}
      if(update&&size===0){reply(200,[]);return}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if(control){
        if(body?.action==='enable')store.enable()
        else if(body?.action==='pause')store.pause()
        else {reply(400,{error:'Unknown control'});return}
        reply(200,{enabled:store.read().enabled});return
      }
      // OwnTracks queues non-2xx uploads. A paused latest-only receiver must
      // discard rather than accumulate a backlog to replay after resuming.
      if(!store.read().enabled||body?._type!=='location'){reply(200,[]);return}
      try {store.accept(body)} catch(error){
        if(error.message!=='Location update is too old')throw error
        // Acknowledge expired offline updates without making them current.
      }
      // OwnTracks expects an array response. Do not echo coordinates or friends.
      reply(200,[])
    } catch {reply(400,{error:'Invalid location request'})}
  })
  server.requestTimeout=10000;server.headersTimeout=10000
  return server
}
