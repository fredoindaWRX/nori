const {writeFileSync}=require('node:fs')
const {join}=require('node:path')

// Optional synthetic-fixture diagnostics must never prevent owned shutdown.
// No directory creation, overwrite, fallback state, or owner-data reporting.
function reportProbeFailure(probe,error){
  if(!probe)return false
  try{
    writeFileSync(join(probe.directory,'desktop-failure.json'),
      JSON.stringify({error:String(error?.message??error).slice(0,1000)}),{flag:'wx'})
    return true
  }catch{return false}
}
module.exports={reportProbeFailure}
