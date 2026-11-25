"""Assemble the complete mic/Discord episode with original motion and measured captions."""
import json,math,re,subprocess,wave
from pathlib import Path
import numpy as np
P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-2/W2-MAIN');O=P/'edit-plates';V=P/'render-work';V.mkdir(exist_ok=True)
T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'));FF=T['ffmpeg'];FP=T['ffprobe']
plan=json.loads((P/'SHOT-PLAN.json').read_text(encoding='utf-8'));qa=json.loads((P/'narration-alignment-check.json').read_text(encoding='utf-8'))
assert qa['editorial_review_complete'] and qa['remaining_material_instruction_flags']==0
duration=qa['duration_seconds'];total=math.ceil(duration*30);last=0;parts=[]
out=P/'Separate-Mic-Discord-OBS-Fredo.mp4';assert not out.exists(),'Preserve an existing export before rerendering.'
words=json.loads((P/'spoken-words.json').read_text(encoding='utf-8'));norm=lambda s:re.sub('[^a-z0-9]','',s.lower())
def find(phrase):
 target=[norm(x) for x in phrase.split()]
 for i in range(len(words)-len(target)+1):
  if [norm(w['word']) for w in words[i:i+len(target)]]==target:return words[i]['start']
 raise RuntimeError('Edit phrase missing: '+phrase)
def run(args):
 r=subprocess.run(args,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 if r.returncode:
  (V/'last-render-error.txt').write_bytes(r.stderr);raise RuntimeError(r.stderr.decode(errors='replace')[-6000:])
beats=[]
for s in plan['shots']:
 start=s['start_seconds'];end=start+s['duration_seconds'];n=s['index']
 for j in range(4):
  custom=[start,find('Then speak while the guest stays quiet')-.03,find('Adjust the guest source')-.03,find('Mute the microphone and check')-.03,end] if n==7 else None
  stop=round((custom[j+1] if custom else start+(end-start)*(j+1)/4)*30) if n<12 or j<3 else total
  frames=stop-last;assert frames>0
  image=O/f'scene-{n:02}-beat-{j+1:02}.png';part=V/f'beat-{n:02}-{j+1:02}.mp4'
  if not part.exists():
   vf=f"zoompan=z='1+0.018*on/{frames}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x1080:fps=30,format=yuv420p"
   run([FF,'-v','error','-loop','1','-framerate','30','-i',str(image),'-vf',vf,'-frames:v',str(frames),'-an','-c:v','libx264','-preset','veryfast','-crf','20','-threads','4',str(part)])
  parts.append(part);beats.append({'scene':n,'beat':j+1,'start':last/30,'end':stop/30,'frames':frames,'asset':str(image)});last=stop
  print(json.dumps({'beat':f'{n:02}-{j+1:02}','frames':frames}),flush=True)
assert last==total
lst=V/'plates-concat.txt';lst.write_text(''.join("file '"+p.as_posix()+"'\n" for p in parts),encoding='utf-8')
base=V/'motion-plates.mp4'
if not base.exists():run([FF,'-v','error','-f','concat','-safe','0','-i',str(lst),'-c','copy',str(base)])
memes=[
 {'file':'meme-one-guy.png','start':find('Finally A volume knob'),'duration':2.8,'meaning':'Original reaction to the loud friend'},
 {'file':'meme-microwave.png','start':find('assembled in a microwave'),'duration':2.5,'meaning':'Original reaction to excessive voice filtering'},
 {'file':'meme-haunted-echo.png','start':find('Once as a haunted echo'),'duration':2.5,'meaning':'Original duplicate-guest reaction'},
 {'file':'meme-three-plates.png','start':find('three plates on the table'),'duration':3.0,'meaning':'Original shared-mix versus extra-tracks analogy'}]
root=P.parents[1]
cutaways=[
 {'asset':str(root/'Week-2/W2-S1/Separate-Mic-Discord-Fredo.mp4'),'start':find('Separate sources give each sound'),'duration':2.2,'seek':.4,'url':'https://www.youtube.com/shorts/5KxXhG6FNNA','left':'TWO VOICES','right':'TWO CONTROLS'},
 {'asset':str(root/'Week-2/W2-S2/Test-The-Recording-Fredo.mp4'),'start':find('The meter is a clue'),'duration':2.3,'seek':.3,'url':'https://www.youtube.com/shorts/DXrACqq7K7g','left':'METER IS A CLUE','right':'FILE IS PROOF'}]
for c in cutaways:assert Path(c['asset']).is_file()
rate=48000;t=np.arange(round(duration*rate))/rate;bed=np.zeros_like(t)
for k,at in enumerate(np.arange(0,duration,2.5)):
 local=t-at;sel=(local>=0)&(local<.85);v=local[sel];freq=[164.8138,195.9977,220.,195.9977][k%4]
 bed[sel]+=.005*(1-np.exp(-v*35))*np.exp(-v*7)*np.sin(2*np.pi*freq*v)
# Short accents follow sentence-ending pauses. They do not sit on technical instructions.
accents=[]
for m in memes:
 end=m['start']+m['duration'];next_words=[w for w in words if w['start']>=end]
 if next_words:
  at=next_words[0]['start']-.08
  if at>end:
   local=t-at;sel=(local>=0)&(local<.06);v=local[sel];bed[sel]+=.012*np.sin(2*np.pi*820*v)*np.exp(-v*90);accents.append(at)
bed*=np.minimum(t/.5,1)*np.minimum((duration-t)/.5,1)
music=P/'original-music-and-cuts.wav'
with wave.open(str(music),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate);f.writeframes((bed*32767).astype('<i2').tobytes())
def ass_stamp(ms):return f'{ms//360000:01}:{ms//6000%60:02}:{ms//100%60:02}.{ms%100:02}'
head='[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Segoe UI Semibold,44,&H00FFFFFF,&H00FFFFFF,&H00110A05,&H00110A05,-1,0,0,0,100,100,0,0,1,3,1,2,110,110,48,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
lines=[]
for chunk in (P/'captions.srt').read_text(encoding='utf-8').strip().split('\n\n'):
 rows=chunk.splitlines();match=re.fullmatch(r'(\d+):(\d+):(\d+),(\d+) --> (\d+):(\d+):(\d+),(\d+)',rows[1]);nums=list(map(int,match.groups()))
 a=(nums[0]*3600+nums[1]*60+nums[2])*100+nums[3]//10;b=(nums[4]*3600+nums[5]*60+nums[6])*100+nums[7]//10
 caption='\\N'.join(rows[2:]).replace('{','').replace('}','');lines.append(f'Dialogue: 0,{ass_stamp(a)},{ass_stamp(b)},Default,,0,0,0,,{{\\fad(45,45)}}{caption}')
ass=P/'captions.ass';ass.write_text(head+'\n'.join(lines)+'\n',encoding='utf-8')
args=[FF,'-v','error','-i',str(base),'-i',str(P/'narration-fred-clear.wav'),'-i',str(music)]
for c in cutaways:args+=['-ss',str(c['seek']),'-t',str(c['duration']),'-i',c['asset']]
for m in memes:args+=['-loop','1','-framerate','30','-i',str(O/m['file'])]
args+=['-loop','1','-framerate','30','-i',str(O/'end-screen.png')]
filters=['[0:v]setsar=1[v0]'];counter=0
for i,c in enumerate(cutaways,3):
 filters += [f'[{i}:v]scale=-2:610,pad=1600:630:(ow-iw)/2:(oh-ih)/2:color=0x0d1424,drawtext=fontfile=\'C\\:/Windows/Fonts/seguisb.ttf\':text=\'{c["left"]}\':fontsize=42:fontcolor=0xffe45d:x=30:y=265,drawtext=fontfile=\'C\\:/Windows/Fonts/seguisb.ttf\':text=\'{c["right"]}\':fontsize=38:fontcolor=0x53e6ff:x=1050:y=305,setpts=PTS-STARTPTS+{c["start"]}/TB[cut{i}]',f'[v{counter}][cut{i}]overlay=160:260:enable=\'between(t,{c["start"]},{c["start"]+c["duration"]})\':eof_action=pass[v{counter+1}]'];counter+=1
for i,m in enumerate(memes,5):
 filters.append(f'[v{counter}][{i}:v]overlay=0:0:enable=\'between(t,{m["start"]},{m["start"]+m["duration"]})\':eof_action=pass[v{counter+1}]');counter+=1
filters.append(f'[v{counter}][9:v]overlay=0:0:enable=\'gte(t,{duration-20})\'[vend]')
escaped=ass.as_posix().replace(':','\\:')
filters.extend([f"[vend]ass=filename='{escaped}',format=yuv420p[vout]",'[1:a][2:a]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.94[aout]'])
(V/'final-filter.txt').write_text(';\n'.join(filters),encoding='utf-8')
manifest={'duration_seconds':duration,'motion_beats':beats,'memes':memes,'own_channel_cutaways':cutaways,
 'music':'Original quiet synthesized motif; own-cutaway audio muted','sound_accents_seconds':accents,
 'actual_capture':'OBS output settings screenshot in scene 9','live_guest_test_shown':False,
 'realistic_owner_avatar_used':False,'final_output':out.name,'publication_ready':False}
(P/'EDIT-MANIFEST.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
args+=['-filter_complex',';'.join(filters),'-map','[vout]','-map','[aout]','-t',str(duration),'-c:v','libx264','-preset','veryfast','-crf','19','-threads','6','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',str(out)]
print('Assembling the complete animated episode.',flush=True);run(args)
run([FF,'-v','error','-xerror','-i',str(out),'-f','null','-'])
probe=json.loads(subprocess.check_output([FP,'-v','error','-show_format','-show_streams','-of','json',str(out)]))
(P/'render-verification.json').write_text(json.dumps({'probe':probe,'full_decode':'passed','render_frames':total,'exported_frame_and_audio_review':'pending','publication_ready':False},indent=2),encoding='utf-8')
print(json.dumps({'export':str(out),'duration':duration,'full_decode':'passed','review_required':True}),flush=True)
