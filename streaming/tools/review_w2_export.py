"""Extract actual exported frames across every beat, meme, cutaway and ending."""
import json,subprocess
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-2/W2-MAIN');D=P/'review';D.mkdir(exist_ok=True)
T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'));M=json.loads((P/'EDIT-MANIFEST.json').read_text(encoding='utf-8'))
video=P/M['final_output'];assert video.is_file()
samples=[{'name':f'beat-{b["scene"]:02}-{b["beat"]:02}','time':b['start']+min(.7,(b['end']-b['start'])/2)} for b in M['motion_beats']]
samples += [{'name':'meme-'+str(i+1),'time':m['start']+.8} for i,m in enumerate(M['memes'])]
samples += [{'name':'own-cutaway-'+str(i+1),'time':c['start']+.8} for i,c in enumerate(M['own_channel_cutaways'])]
samples += [{'name':'ending-'+str(i+1),'time':M['duration_seconds']-t} for i,t in enumerate([18,9,1])]
for row in samples:
 target=D/(row['name']+'.jpg')
 subprocess.run([T['ffmpeg'],'-v','error','-ss',str(row['time']),'-i',str(video),'-frames:v','1','-q:v','2','-y',str(target)],check=True)
 row['file']=str(target)
pages=[];ft=ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf',20)
for page,start in enumerate(range(0,len(samples),12),1):
 im=Image.new('RGB',(1920,924),'#08111e');d=ImageDraw.Draw(im)
 for i,row in enumerate(samples[start:start+12]):
  x=i%4*480;y=i//4*308;im.paste(Image.open(row['file']).resize((480,270)),(x,y));d.text((x+10,y+277),f'{row["name"]}  {row["time"]:.2f}s',font=ft,fill='#53e6ff')
 path=D/f'export-contact-{page:02}.jpg';im.save(path,quality=95);pages.append(str(path))
record={'export':str(video),'actual_export_frames':samples,'contacts':pages,'inspection_status':'Pending actual image inspection','human_audio_listening_verified':False}
(D/'REVIEW.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
print(json.dumps({'actual_frames':len(samples),'contacts':pages}))
