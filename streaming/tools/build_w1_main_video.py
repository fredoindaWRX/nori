"""Final long-form assembly: original motion plates, own-channel cutaways, measured captions."""
import json,math,re,subprocess
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
F=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-1/W1-MAIN');O=F/'edit-plates';V=F/'render-work';V.mkdir(exist_ok=True)
T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'));FF=T['ffmpeg'];FP=T['ffprobe']
plan=json.loads((F/'SHOT-PLAN.json').read_text(encoding='utf-8'));qa=json.loads((F/'narration-alignment-check.json').read_text(encoding='utf-8'));assert qa['verified_source_word_match']
duration=qa['duration_seconds'];fps=30;total=math.ceil(duration*fps);last_frame=0;parts=[]
words=json.loads((F/'spoken-words.json').read_text(encoding='utf-8'));norm=lambda s:re.sub('[^a-z0-9]','',s.lower())
def find(phrase):
 target=[norm(x) for x in phrase.split()]
 for i in range(len(words)-len(target)+1):
  if [norm(w['word']) for w in words[i:i+len(target)]]==target:return words[i]['start']
 raise RuntimeError('Missing edit timing: '+phrase)
out=F/'OBS-Dual-Monitor-Setup-Fredo.mp4';assert not out.exists(),'Preserve an existing final video before rerendering.'
def run(cmd):
 result=subprocess.run(cmd,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 if result.returncode:
  (V/'last-render-error.txt').write_bytes(result.stderr)
  raise RuntimeError(result.stderr.decode('utf-8',errors='replace')[-6000:])
# Finite frame counts keep all cuts within one output frame of actual speech timing.
for shot in plan['shots']:
 start=shot['start_seconds'];end=start+shot['duration_seconds'];n=shot['index']
 for beat in range(4):
  custom=[start,find('If OBS is on Monitor One')-.03,find('If you move OBS onto Monitor Two')-.03,find('Move the controls')-.03,end] if n==4 else None
  stop=round((custom[beat+1] if custom else start+(end-start)*(beat+1)/4)*fps) if n<12 or beat<3 else total
  frames=stop-last_frame;assert frames>0
  plate=O/f'plate-{n:02d}-{beat+1:02d}.png';part=V/f'beat-{n:02d}-{beat+1:02d}.mp4'
  if not part.exists():
   vf=f"zoompan=z='1+0.022*on/{frames}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x1080:fps=30,format=yuv420p"
   run([FF,'-v','error','-loop','1','-framerate','30','-i',str(plate),'-vf',vf,'-frames:v',str(frames),'-an','-c:v','libx264','-preset','veryfast','-crf','20','-threads','4',str(part)])
  parts.append(part);last_frame=stop;print(json.dumps({'rendered_beat':f'{n:02d}-{beat+1}','frames':frames}),flush=True)
assert last_frame==total
lst=V/'plates-concat.txt';lst.write_text(''.join("file '"+p.as_posix()+"'\n" for p in parts),encoding='utf-8')
base=V/'motion-plates.mp4'
if not base.exists():run([FF,'-v','error','-f','concat','-safe','0','-i',str(lst),'-c','copy',str(base)])
def meme(filename,headline,subline,kind):
 im=Image.new('RGB',(1600,630),'#0d1424');d=ImageDraw.Draw(im);white='#f4f6ff';cyan='#55e6ff';yellow='#ffe45d';pink='#ff6d99'
 ft=lambda n:ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf',n)
 d.rounded_rectangle((5,5,1594,624),radius=30,outline=cyan,width=7)
 size=80
 while ft(size).getlength(headline)>1470:size-=2
 d.text((800,65),headline,font=ft(size),fill=yellow,anchor='mt')
 d.text((800,530),subline,font=ft(39),fill=white,anchor='mm')
 if kind=='portal':
  for k in range(6):d.rounded_rectangle((480+k*36,220+k*18,1120-k*36,465-k*18),radius=12,outline=pink if k%2 else cyan,width=7)
 elif kind=='egg':
  d.ellipse((210,210,490,490),outline=cyan,width=15);d.line((620,350,900,350),fill=yellow,width=14);d.polygon([(920,350),(875,320),(875,380)],fill=yellow)
  d.ellipse((1050,260,1490,440),outline=pink,width=15)
 elif kind=='border':
  for k in range(5):d.rectangle((510+k*45,215+k*20,1090-k*45,465-k*20),outline=pink,width=7)
  d.rounded_rectangle((490,195,1110,485),radius=23,outline=yellow,width=16)
 elif kind=='kitchen':
  d.rounded_rectangle((710,215,890,365),radius=65,fill=cyan);d.line((800,363,800,442),fill=cyan,width=17);d.line((725,453,875,453),fill=cyan,width=14)
  for dx in [100,150]:d.arc((800-dx,235,800+dx,400),-60,60,fill=pink,width=7)
 im.save(O/filename)
memes=[
 {'file':'meme-multiverse.png','start':find('family tree'),'duration':2.6,'headline':'BRO BUILT A MULTIVERSE','subline':'One preview was apparently too reasonable.','kind':'portal'},
 {'file':'meme-premium-tunnel.png','start':find('fancy border around'),'duration':3.,'headline':'PREMIUM TUNNEL. SAME PROBLEM.','subline':'The border has excellent marketing.','kind':'border'},
 {'file':'meme-egg.png','start':find('circle turns into an egg'),'duration':2.7,'headline':'16:9 WENT ON VACATION','subline':'Keep the aspect ratio. The circle deserves better.','kind':'egg'},
 {'file':'meme-kitchen.png','start':find('podcast from your kitchen'),'duration':2.5,'headline':'WELCOME TO THE KITCHEN PODCAST','subline':'Break screens need an audio check too.','kind':'kitchen'}]
for m in memes:meme(m['file'],m['headline'],m['subline'],m['kind'])
own=F.parents[1]
cutaways=[
 {'asset':str(own/'Week-1/W1-S1/OBS-Is-Showing-Itself-Fredo.mp4'),'source_seek':.35,'start':find('OBS is showing a screen'),'duration':2.4,'url':'https://www.youtube.com/shorts/WqziO-CB6f8','reason':'Own OBS Short visual callback'},
 {'asset':str(own/'Week-3/W3-S2/AI-Roles-Not-Loaded-Models-Fredo.mp4'),'source_seek':.35,'start':find('different jobs'),'duration':2.,'url':'https://www.youtube.com/shorts/Of6fypnBBmw','reason':'Own group-project reaction to monitors with different jobs'},
 {'asset':str(own/'Week-4/W4-S2/First-AI-Project-Test-Fredo.mp4'),'source_seek':.2,'start':find('only a clue'),'duration':2.2,'url':'https://www.youtube.com/shorts/yd7atGe1cRo','reason':'Own Trust Me Bro reaction; verify the preview'}]
for c in cutaways:assert Path(c['asset']).exists()
manifest={'duration_seconds':duration,'motion_beats':48,'memes':memes,'own_channel_cutaways':cutaways,'music':'Original synthesized quiet motif and transition accents','actual_capture':'live-captures/obs-starting-to-break-actual.mp4','realistic_owner_avatar_used':False,'final_output':out.name,'publication_ready':False}
(F/'EDIT-MANIFEST.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
args=[FF,'-v','error','-i',str(base),'-i',str(F/'narration-fred-edited.wav'),'-i',str(F/'original-music-and-cuts.wav'),'-i',str(F/'live-captures/obs-starting-to-break-actual.mp4')]
for c in cutaways:args+=['-ss',str(c['source_seek']),'-t',str(c['duration']),'-i',c['asset']]
for m in memes:args+=['-loop','1','-framerate','30','-i',str(O/m['file'])]
args+=['-loop','1','-framerate','30','-i',str(O/'end-screen.png')]
filters=['[0:v]setsar=1[v0]'];counter=0
actual_start=plan['shots'][9]['start_seconds'];actual_len=18.9
filters += [f'[3:v]scale=1120:630,pad=1600:630:240:0:color=0x03070d,tpad=stop_mode=clone:stop_duration=3,setpts=PTS-STARTPTS+{actual_start}/TB[capture]',f'[v0][capture]overlay=160:260:enable=\'between(t,{actual_start},{actual_start+plan["shots"][9]["duration_seconds"]})\':eof_action=pass[v1]'];counter=1
for i,c in enumerate(cutaways,4):
 kinetic={4:('OBS IN OBS','CLOSE THE PORTAL'),5:('DIFFERENT JOBS','ONE JOB EACH'),6:('TRUST ME BRO?','CHECK THE PREVIEW')}[i]
 filters += [f'[{i}:v]scale=-2:610,pad=1600:630:(ow-iw)/2:(oh-ih)/2:color=0x0d1424,drawtext=fontfile=\'C\\:/Windows/Fonts/seguisb.ttf\':text=\'{kinetic[0]}\':fontsize=45:fontcolor=0xffe45d:x=35:y=265,drawtext=fontfile=\'C\\:/Windows/Fonts/seguisb.ttf\':text=\'{kinetic[1]}\':fontsize=38:fontcolor=0x53e6ff:x=1050:y=305,setpts=PTS-STARTPTS+{c["start"]}/TB[cut{i}]',f'[v{counter}][cut{i}]overlay=160:260:enable=\'between(t,{c["start"]},{c["start"]+c["duration"]})\':eof_action=pass[v{counter+1}]'];counter+=1
for i,m in enumerate(memes,7):
 filters += [f'[v{counter}][{i}:v]overlay=160:260:enable=\'between(t,{m["start"]},{m["start"]+m["duration"]})\':eof_action=pass[v{counter+1}]'];counter+=1
filters += [f'[v{counter}][11:v]overlay=0:0:enable=\'gte(t,{duration-20})\'[vend]']
ass=F/'captions.ass'
def ass_stamp(ms):return f'{ms//360000:01}:{ms//6000%60:02}:{ms//100%60:02}.{ms%100:02}'
head='[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Segoe UI Semibold,44,&H00FFFFFF,&H00FFFFFF,&H00110A05,&H00110A05,-1,0,0,0,100,100,0,0,1,3,1,2,110,110,48,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
lines=[]
for chunk in (F/'captions.srt').read_text(encoding='utf-8').strip().split('\n\n'):
 rows=chunk.splitlines();match=re.fullmatch(r'(\d+):(\d+):(\d+),(\d+) --> (\d+):(\d+):(\d+),(\d+)',rows[1]);nums=list(map(int,match.groups()));a=(nums[0]*3600+nums[1]*60+nums[2])*100+nums[3]//10;b=(nums[4]*3600+nums[5]*60+nums[6])*100+nums[7]//10
 caption='\\N'.join(rows[2:]).replace('{','').replace('}','');effect='{\\fad(45,45)}'
 lines.append(f'Dialogue: 0,{ass_stamp(a)},{ass_stamp(b)},Default,,0,0,0,,{effect}{caption}')
ass.write_text(head+'\n'.join(lines)+'\n',encoding='utf-8')
escaped=ass.as_posix().replace(':','\\:');filters += [f"[vend]ass=filename='{escaped}',format=yuv420p[vout]",'[1:a][2:a]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.94[aout]']
filter_file=V/'final-filter.txt';filter_file.write_text(';\n'.join(filters),encoding='utf-8')
args+=['-filter_complex',';'.join(filters),'-map','[vout]','-map','[aout]','-t',str(duration),'-c:v','libx264','-preset','veryfast','-crf','19','-threads','6','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',str(out)]
print('Assembling actual footage, own-video callbacks, original memes and captions.',flush=True);run(args)
run([FF,'-v','error','-xerror','-i',str(out),'-f','null','-'])
probe=json.loads(subprocess.check_output([FP,'-v','error','-show_format','-show_streams','-of','json',str(out)]))
(F/'render-verification.json').write_text(json.dumps({'probe':probe,'full_decode':'passed','render_frames':total,'visual_and_audio_mix_review':'pending','publication_ready':False},indent=2)+'\n',encoding='utf-8')
print(json.dumps({'rendered':str(out),'full_decode':'passed','duration':duration,'final_visual_review_required':True}),flush=True)
