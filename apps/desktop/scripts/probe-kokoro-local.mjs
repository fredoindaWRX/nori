import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {createRequire} from 'node:module'
import {createInterface} from 'node:readline'
import {existsSync,writeFileSync} from 'node:fs'
const root='C:/Program Files/Nori/resources/NoriSuite'
const require=createRequire(import.meta.url)
const paths=require(root+'/apps/desktop/desktop/voice-paths.cjs').localVoicePaths(root,{})
const report='C:/Nori/.work/reports/kokoro-model-team-probe.json'
const audio='C:/Nori/.work/reports/kokoro-model-team-probe.wav'
assert.ok(!existsSync(report)&&!existsSync(audio),'Existing evidence preserved')
const child=spawn(paths.python,paths.args,{windowsHide:true,stdio:['pipe','pipe','pipe'],
 env:{...process.env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',PYTHONDONTWRITEBYTECODE:'1'}})
const lines=createInterface({input:child.stdout})
const exited=new Promise((resolve,reject)=>{child.once('exit',resolve);child.once('error',reject)})
let stderr='',timer,requested=false,finished
const began=performance.now()
child.stderr.on('data',bytes=>{stderr=(stderr+bytes.toString()).slice(-2000)})
try{
 const result=await new Promise((resolve,reject)=>{
  finished=reject
  timer=setTimeout(()=>reject(Error('Speech worker deadline: '+stderr)),90000)
  exited.then(()=>{if(!requested)reject(Error('Speech worker exited: '+stderr))},reject)
  lines.on('line',line=>{
   try{
    const value=JSON.parse(line)
    if(value.ready){requested=true;child.stdin.write(JSON.stringify({id:'synthetic-model-team',text:'Nori can connect her local models.'})+'\n');return}
    assert.equal(value.id,'synthetic-model-team');assert.equal(value.content_type,'audio/wav');assert.ok(!value.error)
    const wav=Buffer.from(value.audio,'base64');assert.equal(wav.toString('ascii',0,4),'RIFF');assert.equal(wav.toString('ascii',8,12),'WAVE')
    assert.equal(wav.readUInt16LE(22),1);assert.equal(wav.readUInt32LE(24),24000)
    const seconds=wav.readUInt32LE(40)/48000;assert.ok(seconds>0.5&&seconds<20)
    writeFileSync(audio,wav,{flag:'wx'})
    resolve({model:'Kokoro-82M',backend:'local-cpu-onnx',audioSeconds:seconds,elapsedSeconds:Number(((performance.now()-began)/1000).toFixed(3)),
     outputAudio:audio,automaticPlayback:false,microphoneUsed:false,installedWorkerVerified:true,desktopReadAloudButtonVerified:false})
   }catch(error){reject(error)}
  })
 })
 child.stdin.end();assert.equal(await exited,0)
 writeFileSync(report,JSON.stringify(result,null,2),{flag:'wx'});console.log(JSON.stringify(result))
}finally{
 clearTimeout(timer);lines.close()
 if(child.exitCode===null){child.kill();await exited}
}
