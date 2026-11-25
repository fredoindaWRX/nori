"""Assemble recorded Fish outputs without claiming subjective voice approval."""
import hashlib,json,subprocess,wave
from pathlib import Path
P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-2/W2-MAIN');V=P/'voice-performance-inputs'
T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'))
raw=P/'narration-fred-raw.wav';assert not raw.exists()
parts=[];offset=0.;record=json.loads((V/'GENERATION-RECORD.json').read_text(encoding='utf-8'))
for i in range(1,5):
 audio=V/f'speech-{i:02}.mp3';assert audio.exists()
 pcm=subprocess.check_output([T['ffmpeg'],'-v','error','-i',str(audio),'-ar','48000','-ac','1','-f','s16le','pipe:1'])
 duration=len(pcm)/2/48000;parts.append(pcm)
 record['chunks'][i-1].update(status='Generated; wording review recorded separately',duration_seconds=duration,
   raw_start_seconds=offset,audio_sha256=hashlib.sha256(audio.read_bytes()).hexdigest(),
   input_sha256=hashlib.sha256((V/f'performance-{i:02}.txt').read_bytes()).hexdigest())
 offset+=duration
with wave.open(str(raw),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(48000);f.writeframes(b''.join(parts))
chain='atempo=0.9,highpass=f=75,equalizer=f=250:t=q:w=0.8:g=-2,equalizer=f=3000:t=q:w=0.8:g=2,acompressor=threshold=0.18:ratio=2:attack=10:release=100:makeup=1'
r=subprocess.run([T['ffmpeg'],'-hide_banner','-i',str(raw),'-af',chain+',loudnorm=I=-16:TP=-2:LRA=8:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
levels=json.loads(r.stderr[r.stderr.rfind('{'):r.stderr.rfind('}')+1])
norm=f",loudnorm=I=-16:TP=-2:LRA=8:measured_I={levels['input_i']}:measured_TP={levels['input_tp']}:measured_LRA={levels['input_lra']}:measured_thresh={levels['input_thresh']}:offset={levels['target_offset']}:linear=false"
final=P/'narration-fred-clear.wav'
subprocess.run([T['ffmpeg'],'-v','error','-i',str(raw),'-af',chain+norm,'-ar','48000','-ac','1','-c:a','pcm_s24le',str(final)],check=True)
subprocess.run([T['ffmpeg'],'-v','error','-xerror','-i',str(final),'-f','null','-'],check=True)
probe=json.loads(subprocess.check_output([T['ffprobe'],'-v','error','-show_format','-of','json',str(final)]))
record.update(total_raw_duration_seconds=offset,clear_master_duration_seconds=float(probe['format']['duration']),
 audio_filters=chain+norm,finished_video=False,owner_listening_verified=False,
 status='Full voice master assembled; final transcription/alignment review remains required')
(V/'GENERATION-RECORD.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
print(json.dumps({'master':str(final),'duration':probe['format']['duration'],'complete_decode':True}))
