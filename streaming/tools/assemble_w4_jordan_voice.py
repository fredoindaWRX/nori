import json,hashlib,subprocess,shutil
from pathlib import Path
P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-4/W4-MAIN');V=P/'voice-performance-inputs';V.mkdir(exist_ok=True)
tools=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'));ff=tools['ffmpeg'];fp=tools['ffprobe']
ids=['fb42b199-b8d3-40da-aedd-48d22afc1e9c','7e0e6c79-1445-4dc7-8081-19ac4527555d','6ad7fea6-a773-4dd8-85aa-1a5f2e7b9274']
plan=json.loads((P/'SHOT-PLAN.json').read_text());texts=['\n\n'.join(s['voice_text'] for s in plan['shots'][:2]),'\n\n'.join(s['voice_text'] for s in plan['shots'][2:4]),plan['shots'][4]['voice_text']]
sources=[]
for i,(b,t) in enumerate(zip(ids,texts),1):
    target=V/f'speech-{i:02d}.mp3';assert not target.exists()
    shutil.copy2(Path('C:/Users/Studio/Downloads')/(b+'.mp3'),target);(V/f'speech-{i:02d}.txt').write_text(t,encoding='utf-8');sources.append(target)
raw=P/'narration-jordan-original-rate.wav';assert not raw.exists()
inputs=[]
for p in sources:inputs+=['-i',str(p)]
subprocess.run([ff,'-v','error',*inputs,'-filter_complex','[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]','-map','[out]','-ar','48000','-ac','1','-c:a','pcm_s24le',str(raw)],check=True)
def measure(p):
    result=subprocess.run([ff,'-hide_banner','-i',str(p),'-af','loudnorm=I=-16:TP=-2:LRA=8:print_format=json','-f','null','-'],capture_output=True,text=True,check=True).stderr
    return json.loads(result[result.rfind('{'):result.rfind('}')+1])
levels=measure(raw);chain=f"loudnorm=I=-16:TP=-2:LRA=8:measured_I={levels['input_i']}:measured_TP={levels['input_tp']}:measured_LRA={levels['input_lra']}:measured_thresh={levels['input_thresh']}:offset={levels['target_offset']}:linear=false"
master=P/'narration-jordan.wav';subprocess.run([ff,'-v','error','-i',str(raw),'-af',chain,'-ar','48000','-ac','1','-c:a','pcm_s24le',str(master)],check=True)
subprocess.run([ff,'-v','error','-xerror','-i',str(master),'-f','null','-'],check=True)
duration=float(json.loads(subprocess.check_output([fp,'-v','error','-show_format','-of','json',str(master)]))['format']['duration']);final=measure(master)
qa=dict(voice='Jordan',voice_id='79d0bd3e4e5444b18f7b6d89b5927bf1',engine='s2.1-pro-free',paid_spend=0,tempo=1.0,pitch_changed=False,processing='Loudness normalization only',duration_seconds=duration,measured_mix=final,full_decode_passed=True,human_listening_verified=False,owner_accepted=False)
(P/'NARRATION-QA.json').write_text(json.dumps(qa,indent=2),encoding='utf-8')
(V/'GENERATION-RECORD.json').write_text(json.dumps(dict(voice=qa['voice'],voice_id=qa['voice_id'],engine=qa['engine'],paid_spend=0,generated_chunks=[dict(index=i,blob_id=b,file=str(p),sha256=hashlib.sha256(p.read_bytes()).hexdigest()) for i,(p,b) in enumerate(zip(sources,ids),1)],assembled_master=str(master),duration_seconds=duration),indent=2),encoding='utf-8')
plan.update(voice_id=qa['voice_id'],voice_name='Jordan',status='Full narration exported; word timing and video edit pending',actual_narration_duration_seconds=duration)
(P/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2),encoding='utf-8')
print(json.dumps(qa))
