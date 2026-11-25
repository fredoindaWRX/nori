// Fixed four-second PCM ring, independent of recognition latency.
function createMicrophoneRing(){
  const storage=Buffer.alloc(128000)
  let offset=0,count=0,total=0
  return {
    append(pcm){
      if(!Buffer.isBuffer(pcm)||pcm.length>65536||pcm.length%2)throw Error('Invalid PCM ring packet')
      const first=Math.min(pcm.length,storage.length-offset)
      pcm.copy(storage,offset,0,first);pcm.copy(storage,0,first)
      offset=(offset+pcm.length)%storage.length
      count=Math.min(storage.length,count+pcm.length);total+=pcm.length
    },
    total:()=>total,
    snapshot(bytes=96000){
      if(!Number.isInteger(bytes)||bytes<2||bytes>storage.length||bytes%2)throw Error('Invalid PCM window')
      const size=Math.min(bytes,count),result=Buffer.alloc(size)
      const start=(offset-size+storage.length)%storage.length,first=Math.min(size,storage.length-start)
      storage.copy(result,0,start,start+first);storage.copy(result,first,0,size-first)
      return result
    },
    clear(){storage.fill(0);offset=0;count=0},
  }
}
module.exports={createMicrophoneRing}
