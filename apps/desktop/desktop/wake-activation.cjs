// One pending wake request; consuming it cannot enable tools or override mute.
function createWakeActivation(argv=[]){
  let pending=argv.includes('--nori-wake')
  return {
    request(args){if(Array.isArray(args)&&args.includes('--nori-wake'))pending=true},
    consume(){const result=pending;pending=false;return result},
  }
}
module.exports={createWakeActivation}
