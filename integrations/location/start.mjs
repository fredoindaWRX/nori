import {createLocationReceiver} from './receiver.mjs'

const port=Number(process.env.NORI_LOCATION_PORT??8791)
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('Invalid location receiver port')
const hosts=['127.0.0.1','localhost']
const privateHost=process.env.NORI_LOCATION_PRIVATE_HOST
if(privateHost){
  if(!/^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$/.test(privateHost))throw new Error('Expected a private Tailscale hostname')
  hosts.push(privateHost)
}
const server=createLocationReceiver({phonePassword:process.env.NORI_LOCATION_PHONE_PASSWORD,ownerPassword:process.env.NORI_LOCATION_OWNER_PASSWORD,hosts})
// Starting never enables sharing. Owner control is required after every restart.
server.listen(port,'127.0.0.1',()=>console.log(`Nori location receiver listening locally on port ${port}; sharing paused.`))
server.on('error',()=>{console.error('Location receiver could not start. No location was collected.');process.exitCode=1})
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)))
