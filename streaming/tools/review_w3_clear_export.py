import json,subprocess
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-3/W3-MAIN');D=P/'clear-review';D.mkdir(exist_ok=True)
T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'));M=json.loads((P/'EDIT-MANIFEST.json').read_text(encoding='utf-8'));video=P/'Nori-One-Task-Three-Checks-Ethan.mp4'
samples=[{'name':f'scene-{s["index"]:02}','time':s['start']+min(.8,(s['end']-s['start'])/2)} for s in M['scenes']]
samples += [{'name':'blink-'+str(i),'time':t} for i,t in enumerate([1.85,5.9,73.85,129.9],1)]
samples += [{'name':'outro-'+str(i),'time':t} for i,t in enumerate([172,182,188],1)]
for row in samples:
 p=D/(row['name']+'.jpg');subprocess.run([T['ffmpeg'],'-v','error','-ss',str(row['time']),'-i',str(video),'-frames:v','1','-q:v','2','-y',str(p)],check=True);row['file']=str(p)
contacts=[];ft=ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf',20)
for page,start in enumerate(range(0,len(samples),12),1):
 im=Image.new('RGB',(1920,924),'#172128');d=ImageDraw.Draw(im)
 for i,row in enumerate(samples[start:start+12]):
  x=i%4*480;y=i//4*308;im.paste(Image.open(row['file']).resize((480,270)),(x,y));d.text((x+10,y+279),f'{row["name"]} / {row["time"]:.2f}s',font=ft,fill='#ffffff')
 p=D/f'contact-{page:02}.jpg';im.save(p,quality=95);contacts.append(str(p))
record={'actual_export_frames':samples,'contacts':contacts,'visual_inspection_status':'Pending image inspection','human_audio_listening_verified':False,'owner_feedback_on_this_revision_received':False}
(D/'REVIEW.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'actual_frames':len(samples),'contacts':contacts}))
