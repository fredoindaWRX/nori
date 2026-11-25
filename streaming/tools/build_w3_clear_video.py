"""A complete word-timed edit with original character motion and measured evidence."""
import json,re,math,subprocess,hashlib
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-3/W3-MAIN');O=P/'clear-visuals';V=P/'render-work-clear';O.mkdir(exist_ok=True);V.mkdir(exist_ok=True)
T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'));FF=T['ffmpeg'];FP=T['ffprobe']
tr=json.loads((P/'narration-ethan.transcript.json').read_text(encoding='utf-8'));duration=tr['duration'];words=[w for s in tr['segments'] for w in s['words']]
def tok(t):return ['12' if x=='twelve' else x for x in re.findall(r"[a-z0-9']+",t.lower())]
flat=[]
for w in words:
 for t in tok(w['word']):flat.append((t,w['start'],w['end']))
def when(phrase):
 target=tok(phrase)
 for i in range(len(flat)-len(target)+1):
  if [x[0] for x in flat[i:i+len(target)]]==target:return flat[i][1]
 raise ValueError('Timing phrase not recognized: '+phrase)
def font(n):return ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf',n)
BG='#f1eee7';INK='#172128';TEAL='#167b79';RED='#b63d40';GOLD='#b9780a'
def center(d,y,t,size=70,color=INK):
 while d.textlength(t,font=font(size))>1740:size-=1
 d.text((960,y),t,font=font(size),fill=color,anchor='mm')
def plate(title,body='',tag='ILLUSTRATED EXAMPLE',kind='plain'):
 im=Image.new('RGB',(1920,1080),BG);d=ImageDraw.Draw(im)
 d.rectangle((0,0,1920,85),fill=INK);d.text((60,24),'FredoIndaWRX / NORI',font=font(29),fill='#ffffff');d.text((1850,42),tag,font=font(26),fill='#f5d475',anchor='rm')
 center(d,185,title,76)
 d.rounded_rectangle((560,320,1830,850),radius=36,fill='#ffffff',outline='#d4d0c6',width=4)
 for i,line in enumerate(body.split('|')):d.text((1195,435+i*100),line,font=font(56 if len(line)<25 else 42),fill=TEAL if i==0 else INK,anchor='mm')
 if kind=='connection':
  for i,line in enumerate(['/api/tags  →  NO CONNECTION','/api/ps     →  NO CONNECTION']):d.text((650,590+i*85),line,font=font(37),fill=RED)
  d.text((650,775),'Two actual read-only checks / Sep 30, 2026',font=font(30),fill=INK)
 if kind=='phone':
  d.rounded_rectangle((790,520,1080,770),radius=32,outline=INK,width=9);d.arc((800,480,1090,770),190,350,fill=RED,width=10);d.text((1370,620),'NO ANSWER',font=font(60),fill=RED,anchor='mm')
 if kind=='car':
  d.rounded_rectangle((830,560,1570,730),radius=35,fill=TEAL);d.polygon([(970,560),(1090,460),(1380,460),(1490,560)],fill=TEAL)
  for x in [1000,1400]:d.ellipse((x-60,670,x+60,790),fill=INK)
 if kind=='code':
  source=(P/'demonstration-evidence/worker-health-source-excerpt.txt').read_text(encoding='utf-8')
  assert '"status":"listening"' in source and '"model_ready":ready' in source
  for i,line in enumerate(['/live   →   "listening"','/health →   model_ready','ready / degraded']):d.text((680,535+i*82),line,font=font(41),fill=INK)
 d.rounded_rectangle((35,945,1885,1060),radius=18,fill=INK)
 return im
entries=[
 (0,'A GREEN LIGHT','RUNNING ≠ FINISHED','ILLUSTRATED EXAMPLE','plain'),
 (when('one tiny job'),'ONE TINY JOB','Answer a question.','ILLUSTRATED EXAMPLE','plain'),
 (when('because an app'),'AWAKE. ZERO THOUGHTS.','Anybody home?','ORIGINAL REACTION','plain'),
 (when('Here is what happened'),'THE REAL CHECK','Local AI connection','ACTUAL REQUEST RESULTS','connection'),
 (when('It does not tell us'),'WHAT THIS RESULT MEANS','Connection failed.|Model status: still unknown.','ACTUAL REQUEST RESULTS','plain'),
 (when('Imagine calling a restaurant'),'CALLING THE RESTAURANT','The phone is ringing.','ORIGINAL ANALOGY','phone'),
 (when('Ordering a twelve'),'TWELVE COURSES?','Nobody even picked up.','ORIGINAL REACTION','phone'),
 (when("Now let's make"),'THREE SIMPLE QUESTIONS','Examples next / not live AI answers','ILLUSTRATED EXAMPLE','plain'),
 (when('Question one'),'1. DOES THE APP RESPOND?','Can we reach it?','ILLUSTRATED EXAMPLE','plain'),
 (when('Question two'),'2. CAN IT USE THE MODEL?','Is the answering part available?','ILLUSTRATED EXAMPLE','plain'),
 (when('Question three'),'3. IS THE ANSWER RIGHT?','2 + 2 = ?','ILLUSTRATED EXAMPLE','plain'),
 (when('The expected answer'),'EXPECTED: FOUR','2 + 2 = 4','ILLUSTRATED EXAMPLE','plain'),
 (when('An answer of five'),'FIVE FAILS THE TASK','A green light cannot fix that.','ILLUSTRATED EXAMPLE','plain'),
 (when('These are three'),'RESPONSE. MODEL. RESULT.','Each check answers one question.','ILLUSTRATED EXAMPLE','plain'),
 (when('There is a small example'),'WHAT NORI CHECKS','Two different worker checks','SOURCE CODE SUMMARY','code'),
 (when('If a model is unavailable'),'SAY WHICH PART FAILED','Model unavailable.|Connection down.|Wrong answer.','ILLUSTRATED EXAMPLE','plain'),
 (when('A message that says'),'MECHANIC OF THE YEAR','“Yep. Car.”','ORIGINAL REACTION','car'),
 (when('Tell people which part'),'NAME THE PROBLEM','Fix it. Then repeat the small test.','ILLUSTRATED EXAMPLE','plain'),
 (when('That is the approach'),'ONE JOB. ONE RESULT.','Show what actually happened.','BUILD APPROACH','plain'),
 (when("Today's actual"),'TODAY: CONNECTION FAILED','No AI answer generated.','ACTUAL REQUEST RESULTS','connection'),
 (when('Watching a project'),'KEEP THE FAILURES IN','The build is the story.','BUILD APPROACH','plain')]
end_start=duration-20
entries=[e for e in entries if e[0]<end_start]
end=plate('WHAT SHOULD NORI DO NEXT?','','WATCH NEXT','plain');d=ImageDraw.Draw(end);d.rounded_rectangle((660,330,1550,820),radius=24,outline=TEAL,width=7);d.ellipse((215,460,455,700),outline=TEAL,width=8);d.text((335,580),'N',font=font(120),fill=TEAL,anchor='mm');d.text((1105,870),'MORE NORI BUILDS',font=font(36),fill=INK,anchor='mm');end.save(O/'end-screen.png')
entries.append((end_start,'WHAT SHOULD NORI DO NEXT?','','WATCH NEXT','end'))
entries.sort(key=lambda x:x[0]);manifest=[]
for i,(start,title,body,tag,kind) in enumerate(entries):
 target=O/f'scene-{i+1:02d}.png';(end.copy() if kind=='end' else plate(title,body,tag,kind)).save(target)
 stop=entries[i+1][0] if i+1<len(entries) else duration
 manifest.append({'index':i+1,'start':start,'end':stop,'title':title,'tag':tag,'asset':str(target),'kind':kind})
# Original mascot: bouncing antenna, blinking eyes, no simulated human lip-sync.
robot=O/'robot';robot.mkdir(exist_ok=True)
for i in range(32):
 im=Image.new('RGBA',(470,510),(0,0,0,0));d=ImageDraw.Draw(im);y=120+round(8*math.sin(i*math.pi/16))
 d.rounded_rectangle((65,y,395,y+255),radius=45,fill=INK,outline=TEAL,width=9)
 d.line((230,y,230,y-55),fill=TEAL,width=11);d.ellipse((214,y-83,246,y-51),fill=GOLD)
 for x in [160,300]:
  if i in [14,15]:d.line((x-25,y+89,x+25,y+89),fill='#f1eee7',width=9)
  else:d.ellipse((x-22,y+65,x+22,y+109),fill='#f1eee7')
 d.arc((180,y+124,282,y+207),5,175,fill='#f1eee7',width=9);d.text((230,y+226),'N',font=font(34),fill='#f1eee7',anchor='mm')
 d.line((100,y+258,78,y+320),fill=TEAL,width=18);d.line((360,y+258,382,y+320),fill=TEAL,width=18)
 im.save(robot/f'frame-{i:03d}.png')
def run(args):
 p=subprocess.run(args,capture_output=True)
 if p.returncode:(V/'last-error.txt').write_bytes(p.stderr);raise RuntimeError(p.stderr.decode(errors='replace')[-3500:])
parts=[];last=0;total=math.ceil(duration*30)
for m in manifest:
 stop=round(m['end']*30) if m!=manifest[-1] else total;n=stop-last
 part=V/f"scene-{m['index']:02d}.mp4"
 if not part.exists():run([FF,'-v','error','-loop','1','-framerate','30','-i',m['asset'],'-vf',f"zoompan=z='1+0.008*on/{n}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x1080:fps=30,format=yuv420p",'-frames:v',str(n),'-an','-c:v','libx264','-preset','veryfast','-crf','20','-threads','4',str(part)])
 parts.append(part);last=stop;print(json.dumps({'scene':m['index'],'frames':n}),flush=True)
lst=V/'concat.txt';lst.write_text(''.join("file '"+p.as_posix()+"'\n" for p in parts),encoding='utf-8');base=V/'base.mp4'
if not base.exists():run([FF,'-v','error','-f','concat','-safe','0','-i',str(lst),'-c','copy',str(base)])
# Caption timing comes from actual narration; one conjunction is supported by the independent source-block recognition.
for w in words:
 if w['start']>=62.54 and tok(w['word'])==['but']:
  at=words.index(w)
  if at+1<len(words) and tok(words[at+1]['word'])==['response']:w['word']=' A'
def stamp(t):
 ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
groups=[];cur=[]
for w in words:
 if cur and (len(cur)>=7 or w['end']-cur[0]['start']>3.3):groups.append(cur);cur=[]
 cur.append(w)
 if w['word'].strip().endswith(('.', '?','!')) and len(cur)>=3:groups.append(cur);cur=[]
if cur:groups.append(cur)
srt='';ass='[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Segoe UI Semibold,46,&H00FFFFFF,&H00FFFFFF,&H00282117,&H00282117,-1,0,0,0,100,100,0,0,1,2,0,2,100,100,42,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
def ast(t):return f'{int(t)//3600}:{int(t)//60%60:02}:{int(t)%60:02}.{int(t*100)%100:02}'
for i,g in enumerate(groups):
 a=max(0,g[0]['start']-.04);b=max(a+.55,g[-1]['end']+.08)
 if i+1<len(groups):b=min(b,groups[i+1][0]['start'])
 caption=' '.join(w['word'].strip() for w in g);srt+=f'{i+1}\n{stamp(a)} --> {stamp(b)}\n{caption}\n\n';ass+=f'Dialogue: 0,{ast(a)},{ast(b)},Default,,0,0,0,,{caption}\n'
(P/'captions.srt').write_text(srt,encoding='utf-8');(P/'captions.ass').write_text(ass,encoding='utf-8')
out=P/'Nori-One-Task-Three-Checks-Ethan.mp4';assert not out.exists()
escaped=(P/'captions.ass').as_posix().replace(':','\\:')
graph=f"[0:v][2:v]overlay=55:360:enable='lt(t,{end_start})':shortest=1[v];[v]ass=filename='{escaped}',format=yuv420p[out]"
run([FF,'-v','error','-i',str(base),'-i',str(P/'narration-ethan.wav'),'-stream_loop','-1','-framerate','8','-i',str(robot/'frame-%03d.png'),'-filter_complex',graph,'-map','[out]','-map','1:a','-t',str(duration),'-c:v','libx264','-preset','veryfast','-crf','19','-threads','6','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',str(out)])
run([FF,'-v','error','-xerror','-i',str(out),'-f','null','-'])
probe=json.loads(subprocess.check_output([FP,'-v','error','-show_format','-show_streams','-of','json',str(out)]))
(P/'EDIT-MANIFEST.json').write_text(json.dumps({'scenes':manifest,'original_character_animation_frames':32,'captions':len(groups),'music':'None; speech stays unobstructed','third_party_clips_used':False,'actual_evidence':'Two failed read-only connection requests and short source excerpt','successful_ai_answer_shown':False,'owner_avatar_used':False,'human_voice_naturalness_verified':False},indent=2)+'\n',encoding='utf-8')
(P/'render-verification.json').write_text(json.dumps({'probe':probe,'full_decode_passed':True,'video_sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'exported_frame_review':'pending','publication_ready':False},indent=2)+'\n',encoding='utf-8')
print(json.dumps({'video':str(out),'full_decode_passed':True,'caption_cues':len(groups),'visual_review_pending':True}),flush=True)
