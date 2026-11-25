import {query} from '../../apps/desktop/bridge/nori-v2-query.mjs'
if(!process.env.NORI_LOCATION_OWNER_PASSWORD)throw new Error('Owner credential is required')
let saved=0;let result
async function* prompt(){yield {message:{content:'Where am I?'}}}
for await(const event of query({prompt:prompt(),options:{onConversationUpdate:()=>saved++}})){
  if(event.type==='result')result=event.result
}
const category=result==='Phone location sharing is paused.'?'paused'
  :result?.includes('has not sent an update')?'awaiting-update'
  :result?.includes('Your latest phone update')?'latest-available'
  :result?.includes('over 15 minutes old')?'stale':'unavailable'
console.log(JSON.stringify({nativeLocationRead:category!=='unavailable',category,savedHistoryCallbacks:saved}))
if(category==='unavailable'||saved!==0)process.exitCode=1
