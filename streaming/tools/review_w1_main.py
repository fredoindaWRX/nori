import json,subprocess
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
F=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-1/W1-MAIN');R=F/'review';R.mkdir(exist_ok=True)
T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'));plan=json.loads((F/'SHOT-PLAN.json').read_text(encoding='utf-8'));edit=json.loads((F/'EDIT-MANIFEST.json').read_text(encoding='utf-8'))
v=F/edit['final_output'];shots=[]
for s in plan['shots']:
 for j in range(4):shots.append((s['start_seconds']+s['duration_seconds']*(j+.5)/4,f"SCENE {s['index']:02d} • BEAT {j+1}"))
for m in edit['memes']:shots.append((m['start']+m['duration']/2,m['headline']))
for c in edit['own_channel_cutaways']:shots.append((c['start']+c['duration']/2,'OWN SHORT CUTAWAY'))
for sec in [1,7,16,19]:shots.append((plan['shots'][9]['start_seconds']+sec,'ACTUAL OBS FOOTAGE'))
shots.append((edit['duration_seconds']-8,'END SCREEN + CAPTIONS'))
for i,(at,title) in enumerate(shots):
 asset=R/f'frame-{i+1:02d}.jpg';subprocess.run([T['ffmpeg'],'-v','error','-ss',str(at),'-i',str(v),'-frames:v','1','-q:v','2','-y',str(asset)],check=True,capture_output=True)
for page in range((len(shots)+11)//12):
 contact=Image.new('RGB',(1920,924),'#0c1420');d=ImageDraw.Draw(contact)
 for k,(at,title) in enumerate(shots[page*12:page*12+12]):
  frame=Image.open(R/f'frame-{page*12+k+1:02d}.jpg');frame.thumbnail((480,270));x=k%4*480;y=k//4*308;contact.paste(frame,(x,y));d.text((x+8,y+274),f'{at:.2f}s • {title[:32]}',font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',20),fill='#eaf3ff')
 contact.save(R/f'contact-{page+1:02d}.jpg',quality=92)
res={'actual_video_frames_extracted':len(shots),'contacts':(len(shots)+11)//12,'full_review':'pending visual inspection','frames': [{'time':at,'label':title} for at,title in shots]}
(R/'REVIEW.json').write_text(json.dumps(res,indent=2)+'\n',encoding='utf-8');print(json.dumps({k:res[k] for k in ['actual_video_frames_extracted','contacts','full_review']}))
