/** Latest-only location state. No history, disk writes, logging or geocoding. */
export function createLatestLocation({now=Date.now, staleAfterMs=15*60*1000}={}) {
  let latest=null
  let enabled=false
  return {
    enable(){enabled=true},
    pause(){enabled=false;latest=null},
    accept(message){
      if(!enabled)throw new Error('Location sharing is paused')
      if(message?._type!=='location')throw new Error('Expected a location update')
      const {lat,lon,acc,tst}=message
      if(typeof lat!=='number'||!Number.isFinite(lat)||lat < -90||lat >90||typeof lon!=='number'||!Number.isFinite(lon)||lon < -180||lon >180)throw new Error('Invalid coordinates')
      if(typeof acc!=='number'||!Number.isFinite(acc)||acc<0||acc>100000)throw new Error('Invalid accuracy')
      if(typeof tst!=='number'||!Number.isFinite(tst)||tst<=0||tst*1000>now()+60000)throw new Error('Invalid location timestamp')
      if(now()-tst*1000>staleAfterMs)throw new Error('Location update is too old')
      if(latest && tst<=latest.timestamp) return false
      latest={latitude:lat,longitude:lon,accuracyMeters:acc,timestamp:tst,receivedAt:now()}
      return true
    },
    read(){
      return {enabled,location:latest ? {...latest} : null,stale:latest ? now()-latest.timestamp*1000>staleAfterMs : true}
    },
  }
}
