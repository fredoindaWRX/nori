'use strict'
const MAX_VISION_BYTES=8*1024**2
const MAX_VISION_REQUEST_BYTES=12*1024**2
function validateVisionDataUrl(value){
 if(typeof value!=='string'||value.length>Math.ceil(MAX_VISION_BYTES*4/3)+64)throw Error('Invalid local vision image')
 const match=/^data:(image\/(?:png|jpeg|webp));base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/.exec(value)
 if(!match)throw Error('Vision requires inline PNG, JPEG or WebP bytes; remote URLs are refused')
 const bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.length>MAX_VISION_BYTES)throw Error('Local vision image exceeds its byte budget')
 const mime=match[1]
 const valid=mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  :mime==='image/jpeg'?bytes.subarray(0,3).equals(Buffer.from([255,216,255]))
  :bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'
 if(!valid)throw Error('Local vision bytes do not match their declared type')
 return {mime,bytes:bytes.length}
}
function validateVisionMessages(messages){
 let images=0,text=0
 for(const message of messages){
  if(!['system','user'].includes(message.role))throw Error('Vision observations cannot carry tool or assistant actions')
  if(typeof message.content==='string'){text+=message.content.length;continue}
  if(!Array.isArray(message.content))throw Error('Invalid local vision message')
  for(const item of message.content){
   if(item?.type==='text'&&typeof item.text==='string')text+=item.text.length
   else if(message.role==='user'&&item?.type==='image_url'&&item.image_url&&Object.keys(item.image_url).join()==='url'){
    validateVisionDataUrl(item.image_url.url);images++
   }else throw Error('Invalid local vision content')
  }
 }
 if(images!==1||text>8192)throw Error('Vision requires one bounded image and question')
 return true
}
module.exports={MAX_VISION_BYTES,MAX_VISION_REQUEST_BYTES,validateVisionDataUrl,validateVisionMessages}
