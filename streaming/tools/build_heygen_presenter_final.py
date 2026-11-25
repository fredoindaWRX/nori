"""Finish the actual owner avatar with captions outside the moving face."""
from pathlib import Path
import json, subprocess, math, random, wave, array, hashlib
from PIL import Image, ImageDraw, ImageFont

BASE=Path('C:/Nori/streaming/channel-operator/03-Production/Human-Reactions/Privacy-Milk/HeyGen-Updated-Avatar')
D=BASE/'Presenter-Final'; D.mkdir(exist_ok=True)
T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'))
ff,fp=T['ffmpeg'],T['ffprobe']; source=BASE/'HeyGen-Owner-Avatar-Original.mp4'
from presenter_policy import enforce_presenter_source
enforce_presenter_source(source)
out=D/'Fredo-Group-Chat-Presenter-Final.mp4'
assert source.exists() and not out.exists(), 'Preserve exports'
probe=json.loads(subprocess.check_output([fp,'-v','error','-show_streams','-show_format','-of','json',str(source)]))
v=next(s for s in probe['streams'] if s['codec_type']=='video')
assert (v['width'],v['height'],v['avg_frame_rate'])==(720,1280,'25/1')
W,H,FPS=720,1280,25; duration=float(probe['format']['duration'])
cues=[(0,2.6,'Your group chat did not apply\nto be your co-host.'),(3.14,4.9,'If OBS captures\nyour whole monitor,'),(5.28,6.54,'private windows\ncan show up too.'),(7,8.4,'Use Game Capture\nwhen it works,'),(8.7,9.76,'then record ten seconds'),(9.76,11.5,'and watch it\nbefore going live.'),(12.08,13.32,'Save the chaos\nfor the game.')]
font=ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf',36)
small=ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf',22)
label=ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf',19)
def stamp(t):
 m=round(t*1000); return f'{m//3600000:02d}:{m//60000%60:02d}:{m//1000%60:02d},{m%1000:03d}'
(D/'captions.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(a)} --> {stamp(b)}\n{s}' for i,(a,b,s) in enumerate(cues))+'\n',encoding='utf-8')

# Two original quiet cues stay in actual speech pauses.
rate=48000; rng=random.Random(20261001); samples=[]
for i in range(math.ceil(duration*rate)):
 t=i/rate; x=0
 u=t-2.72
 if 0<=u<.12: x=.045*math.sin(math.pi*u/.12)**2*(.7*math.sin(2*math.pi*(850*u-2100*u*u))+.3*rng.uniform(-1,1))
 u=t-11.65
 if 0<=u<.08: x+=.035*math.exp(-u*75)*math.sin(2*math.pi*1100*u)
 samples.append(round(x*32767))
sfx=D/'original-reaction-sfx.wav'
with wave.open(str(sfx),'wb') as wav:
 wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(rate);wav.writeframes(array.array('h',samples).tobytes())

review_frames={round(t*FPS):i+1 for i,t in enumerate([.5,1.4,2.3,3.6,4.5,5.8,6.3,7.3,8.05,9.2,10.3,11.1,12.4,13.1])}
checks=[]
def compose(raw,t):
 # Uniform fit preserves the entire source and its provider mark.
 src=Image.frombytes('RGB',(720,1280),raw).resize((612,1088),Image.Resampling.LANCZOS)
 im=Image.new('RGB',(W,H),'#091624');im.paste(src,(54,122));d=ImageDraw.Draw(im)
 for a,b,s in cues:
  if a<=t<b:
   color='#83ffd0' if 'Game Capture' in s else 'white'
   box=d.multiline_textbbox((360,58),s,font=font,anchor='mm',align='center',spacing=6)
   assert box[0]>=24 and box[2]<=696 and box[1]>=4 and box[3]<116, (s,box)
   d.multiline_text((360,58),s,font=font,fill=color,anchor='mm',align='center',spacing=6)
 # A compact illustration stays below the face and left of the source watermark.
 if 7<=t<8.4:
  for x,head,sub,color in [(76,'GAME','Capture this','#83ffd0'),(262,'PRIVATE','Keep out','#ffd08c')]:
   d.rounded_rectangle((x,1050,x+170,1145),radius=12,fill='#10202c',outline=color,width=2)
   d.text((x+85,1079),head,font=small,fill=color,anchor='mm')
   d.text((x+85,1118),sub,font=label,fill='white',anchor='mm')
 d.text((54,1237),'FREDOINDAWRX',font=small,fill='#83ffd0',anchor='lm')
 d.text((666,1237),'AI PRESENTER',font=label,fill='#b7c5d4',anchor='rm')
 return im

decoder=subprocess.Popen([ff,'-v','error','-i',str(source),'-an','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
cmd=[ff,'-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','720x1280','-r','25','-i','pipe:0','-i',str(source),'-i',str(sfx),'-filter_complex','[1:a][2:a]amix=inputs=2:duration=first:normalize=0[a]','-map','0:v','-map','[a]','-c:v','libx264','-crf','18','-preset','fast','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-t',str(duration),'-movflags','+faststart',str(out)]
with (D/'assembly.log').open('wb') as log:
 enc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=log)
 try:
  for i in range(int(v['nb_frames'])):
   raw=decoder.stdout.read(W*H*3);assert len(raw)==W*H*3
   im=compose(raw,i/FPS);enc.stdin.write(im.tobytes())
   if i in review_frames: im.save(D/f'review-{review_frames[i]:02d}.jpg',quality=94)
   if i==12: im.save(D/'cover-frame.png')
 finally: enc.stdin.close()
 assert enc.wait()==0
 decoder.stdout.close();assert decoder.wait()==0
subprocess.run([ff,'-v','error','-xerror','-i',str(out),'-map','0','-f','null','-'],check=True)
final=json.loads(subprocess.check_output([fp,'-v','error','-show_streams','-show_format','-of','json',str(out)]))
fv=next(s for s in final['streams'] if s['codec_type']=='video');fa=next(s for s in final['streams'] if s['codec_type']=='audio')
assert (fv['width'],fv['height'],fv['codec_name'],fa['codec_name'],fv['nb_frames'])==(720,1280,'h264','aac',v['nb_frames'])
images=[Image.open(f).resize((180,320)) for f in sorted(D.glob('review-*.jpg'))]
sheet=Image.new('RGB',(720,math.ceil(len(images)/4)*320),'#091624')
for i,im in enumerate(images):sheet.paste(im,((i%4)*180,(i//4)*320))
sheet.save(D/'contact-sheet.jpg',quality=94)
proof={'full_decode':'passed','source_full_decode':'passed','final_video':out.name,'source':str(source),'duration_seconds':float(final['format']['duration']),'resolution':[720,1280],'fps':25,'frames':int(fv['nb_frames']),'actual_owner_digital_twin':True,'voice_id':'2a3e8a799bf949898594b507bed1aac9','source_motion_preserved':True,'source_frame_order_preserved':True,'full_source_frame_fitted':[54,122,666,1210],'source_upscaled':False,'voice_replaced':False,'speech_speed_changed':False,'provider_watermark_preserved':True,'caption_cues':len(cues),'all_caption_bounds_checked':True,'captions_outside_source_frame':True,'original_sfx_count':2,'visual_review_completed':False,'perceptual_lip_sync_review_completed':False,'owner_quality_acceptance':False,'youtube_published':False,'paid_spend':0,'sha256':hashlib.sha256(out.read_bytes()).hexdigest()}
(D/'FINAL-VERIFICATION.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8')
package=json.loads((BASE/'Readable-Revision'/'publishing-package.json').read_text(encoding='utf-8-sig'))
package.update({'final_video':out.name,'published':False,'publication_gate':'Visual and voice quality review for the actual updated presenter; no substitute narrator or graphic-only version.'})
(D/'publishing-package.json').write_text(json.dumps(package,indent=2)+'\n',encoding='utf-8')
print(json.dumps(proof))
