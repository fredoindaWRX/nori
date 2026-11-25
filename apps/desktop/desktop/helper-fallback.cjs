'use strict'
// Answer from the helper model when the main model cannot (owner, 2026-11-11: "Yes, build it").
// The helper is a separate 9B on the second graphics card (C:\Nori\integrations\nori-helper), loopback
// only, behind a bearer key that only this PC's user can read. Used for one request at a time, only after
// the main route failed, never for vision. If the helper is off, nothing changes.
const fs=require('node:fs')
const path=require('node:path')
const HELPER_ORIGIN='http://127.0.0.1:18795'
const HELPER_MODEL='nori-helper-9b'
const HELPER_CONTEXT=65536

function readHelperKey(environment=process.env){
 try{
  const key=fs.readFileSync(path.join(String(environment.LOCALAPPDATA||''),'NoriHelper','api-key.txt'),'utf8').trim()
  return /^[0-9a-f]{64}$/.test(key)?key:null
 }catch{return null}
}

/** The helper's response for this body, or null when the helper is off, keyless or refuses. */
async function helperRequest(body,{signal,fetcher=fetch,key=readHelperKey()}={}){
 if(!key)return null
 const result=await fetcher(HELPER_ORIGIN+'/v1/chat/completions',{method:'POST',redirect:'error',signal,
  headers:{'content-type':'application/json',authorization:'Bearer '+key},
  body:JSON.stringify({...body,model:HELPER_MODEL,chat_template_kwargs:{enable_thinking:false,...body.chat_template_kwargs}})})
 return result.ok?result:null
}
// R83: the helper reads prompts at about 66 tokens/s on the RX 480, and Nori's full requests carry 7-10K
// tokens of persona, tools and history (about two minutes). When the helper takes over it gets a slim
// request instead: one short identity line, the last few plain messages, no tool catalogue.
const HELPER_SYSTEM="You are N.O.R.I. (Nori), the user's local AI assistant and COO. Reply briefly and plainly, without headings or a sign-off. "
 +"This reply comes from your small backup model because your main model is busy or unavailable, so you have no tools in this reply: "
 +"do not say you checked, ran, opened, changed or looked up anything. You cannot see or hear the user, so do not comment on how they look or sound. If the user asked for an action, say you will need your main model for it and they can ask again in a moment."
const HELPER_PROMPT_CHARS=2400,HELPER_MAX_TOKENS=300
const plain=content=>typeof content==='string'?content:Array.isArray(content)?content.filter(part=>part&&part.type==='text'&&typeof part.text==='string').map(part=>part.text).join('\n'):''
function slimForHelper(body){
 const turns=[]
 let room=HELPER_PROMPT_CHARS
 for(const message of [...(body.messages??[])].reverse()){
  if(message?.role!=='user'&&message?.role!=='assistant')continue
  const text=plain(message.content).trim()
  if(!text)continue
  if(room<=0)break
  const kept=text.length>room?text.slice(text.length-room):text
  turns.unshift({role:message.role,content:kept})
  room-=kept.length
  if(turns.length>=6)break
 }
 while(turns.length&&turns[0].role!=='user')turns.shift()
 const supplied=[body.max_tokens,body.max_completion_tokens].filter(Number.isInteger)
 const slim={model:body.model,stream:body.stream===true,messages:[{role:'system',content:HELPER_SYSTEM},...turns],
  max_tokens:Math.min(HELPER_MAX_TOKENS,...(supplied.length?supplied:[HELPER_MAX_TOKENS]))}
 for(const key of ['temperature','top_p','stop','seed'])if(body[key]!==undefined)slim[key]=body[key]
 return slim
}
module.exports={HELPER_ORIGIN,HELPER_MODEL,HELPER_CONTEXT,readHelperKey,helperRequest,slimForHelper,HELPER_SYSTEM}
