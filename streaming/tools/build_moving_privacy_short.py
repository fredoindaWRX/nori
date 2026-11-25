"""Assemble the full moving presenter Short at the narration's original speed."""
import argparse, json, math, re, subprocess
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

p=argparse.ArgumentParser(); p.add_argument('presenter'); args=p.parse_args()
R=Path('C:/Nori/streaming/channel-operator/03-Production/Human-Reactions/Privacy-Milk')
D=R/'Moving-Presenter'; D.mkdir(exist_ok=True)
T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'))
ff,fp=T['ffmpeg'],T['ffprobe']; source=Path(args.presenter)
assert source.exists()
out=D/'Your-Stream-Leaked-The-Group-Chat-Moving-Fred-Final.mp4'
assert not out.exists(), 'Preserve existing exports'
audio=D/'narration-original-speed-normalized.wav'
subprocess.run([ff,'-v','error','-i',str(R/'narration-fred-original.wav'),'-af','loudnorm=I=-16:TP=-2:LRA=9','-ar','48000','-ac','2','-y',str(audio)],check=True)
duration=float(json.loads(subprocess.check_output([fp,'-v','error','-show_format','-of','json',str(audio)]))['format']['duration'])
cues=[(0,1.5,'You just livestreamed'),(1.5,2.28,'the group chat.'),(2.36,3.18,'Oh, no.'),(3.38,4.55,'I need more milk?'),(4.74,5.3,'Bro...'),(5.4,6.78,'you need Game Capture.'),(6.86,7.91,'Keep OBS'),(7.92,8.8,'and private windows'),(8.8,10.4,'on your other monitor.'),(10.62,12.1,'Capture the game\nwhen you can,'),(12.22,13.48,'then record 10 seconds'),(13.48,14.05,'and watch it'),(14.05,15.05,'before going live.'),(15.26,16.16,'The only leak we want'),(16.16,16.937,'is the milk.')]
beats=[(0,'GROUP CHAT: LIVE.'),(3.25,'MORE MILK?'),(4.74,'GAME CAPTURE.'),(6.86,'KEEP IT OFF-STREAM.'),(10.5,'CAPTURE THE GAME.'),(12.22,'CHECK BEFORE LIVE.'),(15.2,'NO DM LEAKS.')]
def stamp(t):
 m=round(t*1000); return f'{m//3600000:02d}:{m//60000%60:02d}:{m//1000%60:02d},{m%1000:03d}'
(D/'captions.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(a)} --> {stamp(min(b,duration))}\n{s}' for i,(a,b,s) in enumerate(cues))+'\n',encoding='utf-8')
W,H,FPS=1080,1920,30
def font(n): return ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf',n)
def txt(d,xy,s,n=54,fill='white',anchor='mm'): d.text(xy,s,font=font(n),fill=fill,anchor=anchor,stroke_width=3,stroke_fill='#0a101d')
def compose(raw,t):
 im=Image.new('RGB',(W,H),'#090e1c'); im.paste(Image.frombytes('RGB',(W,W),raw),(0,230)); d=ImageDraw.Draw(im)
 i=max(i for i,(a,s) in enumerate(beats) if a<=t)
 txt(d,(50,65),'FredoIndaWRX',29,'#74e6ff','lm'); txt(d,(1030,65),'AI ANIMATED PRESENTER',21,'#dde6f1','rm')
 txt(d,(540,159),beats[i][1],56,'#ffe562' if i in [0,1,6] else 'white')
 d.rounded_rectangle((30,1325,1050,1525),radius=26,fill='#121d30',outline='#294562',width=2)
 for a,b,s in cues:
  if a<=t<b:
   for j,line in enumerate(s.split('\n')): txt(d,(540,1395+j*70),line,53,'#ffe562' if 'milk' in line.lower() else 'white')
 if i in [1,6]:
  d.polygon([(451,1620),(502,1594),(585,1594),(629,1620),(629,1790),(451,1790)],fill='#f5f8fc',outline='#63cdf2',width=5)
  d.rectangle((451,1638,629,1690),fill='#2c7ead'); txt(d,(540,1738),'MILK',33,'#15354b')
 elif i in [3,4]:
  for x,label,color in [(50,'GAME CAPTURE','#74edb1'),(560,'PRIVATE + OBS','#ffb788')]:
   d.rounded_rectangle((x,1595,x+470,1790),radius=18,fill='#121d30',outline=color,width=4)
   txt(d,(x+235,1657),label,31,color); txt(d,(x+235,1730),'ON STREAM' if x==50 else 'OFF STREAM',28,'white')
 elif i==5:
  txt(d,(540,1620),'10-SECOND TEST',51,'#74e6ff'); txt(d,(540,1720),'RECORD  >  WATCH  >  FIX',39,'white')
 else: txt(d,(540,1690),'Wrong screen. Very wrong audience.',39,'#d4deed')
 txt(d,(540,1853),'Full OBS guide linked below',31,'#b5c9df')
 return im
decoder=subprocess.Popen([ff,'-v','error','-i',str(source),'-an','-vf','scale=1080:1080:flags=lanczos,fps=30','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
mix='[1:a]asplit=2[voc][duck];[2:a]atempo=1.063829787[sfx];[sfx][duck]sidechaincompress=threshold=0.025:ratio=3:attack=10:release=100[quiet];[voc][quiet]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89:level=false[a]'
cmd=[ff,'-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','1080x1920','-r','30','-i','pipe:0','-i',str(audio),'-i',str(R/'original-music-and-reaction-sfx.wav'),'-filter_complex',mix,'-map','0:v','-map','[a]','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-t',str(duration),'-movflags','+faststart',str(out)]
reviews={round(t*FPS):i+1 for i,(t,_) in enumerate(beats)}
with (D/'assembly.log').open('wb') as log:
 encoder=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=log); last=None
 try:
  for i in range(math.ceil(duration*FPS)):
   raw=decoder.stdout.read(W*W*3)
   if len(raw)==W*W*3: last=raw
   elif not raw and last is not None: raw=last
   else: raise RuntimeError('Incomplete decoded presenter frame')
   frame=compose(raw,i/FPS); encoder.stdin.write(frame.tobytes())
   if i in reviews: frame.save(D/f'review-scene-{reviews[i]}.jpg',quality=94)
   if i==22: frame.save(D/'cover-frame.png')
 finally: encoder.stdin.close()
 assert encoder.wait()==0, 'Inspect assembly.log'
 decoder.stdout.close(); decoder.wait()
subprocess.run([ff,'-v','error','-xerror','-i',str(out),'-map','0','-f','null','-'],check=True)
probe=json.loads(subprocess.check_output([fp,'-v','error','-show_streams','-show_format','-of','json',str(out)]))
v=next(s for s in probe['streams'] if s['codec_type']=='video'); a=next(s for s in probe['streams'] if s['codec_type']=='audio')
assert (v['width'],v['height'],v['codec_name'],a['codec_name'])==(W,H,'h264','aac')
proof={'full_decode':'passed','duration_seconds':float(probe['format']['duration']),'resolution':[W,H],'video_codec':'h264','audio_codec':'aac','narration_speed_unchanged':True,'presenter_source':str(source),'actual_model_facial_motion':True,'camera_zoom_substitute':False,'full_body_gestures':False,'caption_cues':len(cues),'visual_review_completed':False,'lip_sync_quality_review_completed':False,'published':False}
(D/'FINAL-VERIFICATION.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8')
(D/'publishing-package.json').write_text(json.dumps({'title':'Your Stream Leaked the Group Chat. Now What?','description':"Wrong screen, very wrong audience. Keep private windows off the captured monitor, use Game Capture when it works for your game, and review a short recording before going live.\n\nFull OBS setup guide: https://www.youtube.com/watch?v=wQCuI-5i0iQ\n\nAI-animated presenter based on my photo, narrated with fred, my own voice clone. This is a fictional skit, not footage of a real private-message leak. Original synthesized music and sound effects.\n\nSubscribe for Nori projects and practical creator tools.\n\n#OBS #StreamingTips #FredoIndaWRX",'tags':['OBS','Game Capture','streaming setup','stream privacy','Nori'],'visibility':'Public','scheduled':False,'ai_disclosure':True,'related_video_id':'wQCuI-5i0iQ','video_asset':out.name},indent=2)+'\n',encoding='utf-8')
print(json.dumps(proof))
