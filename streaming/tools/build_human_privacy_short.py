"""Finished Fred Short: photoreal reactions, kinetic captions, original comic audio."""
import json,math,subprocess,wave,shutil
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont
R=Path('C:/Nori/streaming/channel-operator/03-Production/Human-Reactions/Privacy-Milk')
G=Path('C:/Users/Studio/.codex/generated_images/01a0f370-36c0-7972-9ce2-b849b5dc19bd')
assets={'reaction.png':'exec-128115c1-ab6b-43bc-aec1-5b94275c4d31.png','milk.png':'exec-5d6f0f59-56d8-41f8-b9b1-f6b00222242f.png','happy.png':'exec-cd43034a-e81b-47b2-bc9b-6067602a456f.png'}
for name,source in assets.items(): shutil.copy2(G/source,R/name)
tools=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'));ffmpeg=tools['ffmpeg'];ffprobe=tools['ffprobe']
audio=R/'narration-fred-final.wav';out=R/'Your-Stream-Leaked-The-Group-Chat-Fred-Final.mp4'
assert not out.exists(),'Preserve earlier final exports'
tempo=.94
subprocess.run([ffmpeg,'-v','error','-i',str(R/'narration-fred-original.wav'),'-af',f'atempo={tempo},loudnorm=I=-16:TP=-2:LRA=9','-ar','48000','-ac','2',str(audio)],check=True)
duration=float(json.loads(subprocess.check_output([ffprobe,'-v','error','-show_format','-of','json',str(audio)]))['format']['duration'])
cues=[(0,1.5,'You just livestreamed'),(1.5,2.28,'the group chat.'),(2.36,3.18,'Oh, no.'),(3.38,4.55,'I need more milk?'),(4.74,5.3,'Bro...'),(5.4,6.78,'you need Game Capture.'),(6.86,7.91,'Keep OBS'),(7.92,8.8,'and private windows'),(8.8,10.4,'on your other monitor.'),(10.62,12.1,'Capture the game\nwhen you can,'),(12.22,13.48,'then record 10 seconds'),(13.48,14.05,'and watch it'),(14.05,15.05,'before going live.'),(15.26,16.16,'The only leak we want'),(16.16,16.937,'is the milk.')]
cues=[(a/tempo,min(duration,b/tempo),s) for a,b,s in cues]
def stamp(sec):
 ms=round(sec*1000);return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}'
(R/'captions.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(a)} --> {stamp(b)}\n{s}' for i,(a,b,s) in enumerate(cues))+'\n',encoding='utf-8')
shots=[(0,'reaction','GROUP CHAT: LIVE.'),(3.25,'milk','MORE MILK?'),(4.74,'reaction','GAME CAPTURE.'),(6.86,'monitors','KEEP IT OFF-STREAM.'),(10.5,'happy','CAPTURE THE GAME.'),(12.22,'record','CHECK THE RECORDING.'),(15.2,'milk','NO DM LEAKS.')]
shots=[(s/tempo,k,t) for s,k,t in shots]
W,H,FPS=1080,1920,30
photos={k:Image.open(R/(k+'.png')).convert('RGB').resize((W,H),Image.Resampling.LANCZOS) for k in ['reaction','milk','happy']}
def font(n):return ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf',n)
def text(d,xy,s,size=56,color='white',anchor='mm'):
 d.text(xy,s,font=font(size),fill=color,anchor=anchor,stroke_width=4,stroke_fill='#12121b')
def frame(t):
 index=max(i for i,(start,_,_) in enumerate(shots) if start<=t);start,kind,title=shots[index];local=t-start
 photo=photos[kind if kind in photos else 'happy'];zoom=1.01+min(.035,local*.011)
 if kind=='reaction' and index==2:zoom=1.13+min(.035,local*.015)
 cw,ch=int(W/zoom),int(H/zoom);cx=W/2;cy=H*.47
 im=photo.crop((int(cx-cw/2),int(cy-ch/2),int(cx+cw/2),int(cy+ch/2))).resize((W,H),Image.Resampling.BICUBIC).convert('RGBA')
 overlay=Image.new('RGBA',(W,H));d=ImageDraw.Draw(overlay)
 d.rectangle((0,0,W,275),fill=(8,10,19,160));d.rectangle((0,1480,W,H),fill=(8,10,19,200))
 text(d,(70,74),'FredoIndaWRX',30,'#65efff','lm');text(d,(W-70,74),'AI DRAMATIZATION',25,'#f0e2c6','rm')
 text(d,(W/2,185),title,58,'#ffe762' if index in [0,1,6] else 'white')
 if kind=='monitors':
  d.rounded_rectangle((55,835,1025,1430),radius=30,fill=(8,13,28,238))
  for x,label,sub,color in [(85,'MONITOR 1','GAME','#69f7b4'),(565,'MONITOR 2','OBS + PRIVATE','#ffb788')]:
   d.rounded_rectangle((x,965,x+420,1225),radius=16,fill='#151e32',outline=color,width=5)
   text(d,(x+210,1050),label,32,color);text(d,(x+210,1130),sub,37,color)
  text(d,(540,900),'DISPLAY CAPTURE SHOWS EVERYTHING',31,'white')
  text(d,(295,1325),'ON STREAM',36,'#69f7b4');text(d,(775,1325),'OFF STREAM',36,'#ffb788')
 elif kind=='record':
  d.rounded_rectangle((100,940,980,1400),radius=30,fill=(8,13,28,238))
  text(d,(540,1015),'TEST BEFORE GOING LIVE',38,'#65efff')
  text(d,(540,1160),'10 SECONDS',83,'#ffe762')
  text(d,(540,1300),'RECORD  >  WATCH  >  FIX',37,'white')
 for a,b,s in cues:
  if a<=t<b:
   lines=s.split('\n')
   for n,line in enumerate(lines):text(d,(540,1580+n*72),line,57,'#ffe762' if 'milk' in line.lower() else 'white')
 text(d,(70,1838),'Original reactions + Fred narration',28,'#d2e4ee','lm')
 return Image.alpha_composite(im,overlay).convert('RGB')
# Original synthesized sound design: scratch, boing, whooshes, confirmation chime.
sr=48000;bed=np.zeros(math.ceil(duration*sr));rng=np.random.default_rng(1235813);effects=[]
def add(start,signal,name):
 at=int(start*sr);n=min(len(signal),len(bed)-at)
 if n>0:bed[at:at+n]+=signal[:n]
 if name:effects.append({'time':round(start,3),'effect':name,'source':'original synthesis'})
for beat in np.arange(0,duration,60/126):
 tt=np.arange(int(sr*.1))/sr;add(beat,.013*np.sin(2*np.pi*(90*tt-180*tt**2))*np.exp(-tt*40),None)
 tt=np.arange(int(sr*.04))/sr;add(beat+.23,.007*rng.normal(size=len(tt))*np.exp(-tt*100),None)
for start in [0,6.86/tempo,12.22/tempo]:
 tt=np.arange(int(sr*.16))/sr;add(start,.055*rng.normal(size=len(tt))*np.sin(np.pi*tt/.16)**2,'transition whoosh')
tt=np.arange(int(sr*.28))/sr;add(2.12/tempo,.1*np.sin(2*np.pi*(1700*tt-2450*tt**2))*rng.normal(size=len(tt))*np.exp(-tt*10),'record scratch')
for start in [3.24/tempo,15.05/tempo]:
 tt=np.arange(int(sr*.26))/sr;add(start,.085*np.sin(2*np.pi*(380*tt+25*np.sin(2*np.pi*6*tt)))*np.exp(-tt*14),'rubber boing')
for off,frequency in [(0,659),(.09,880)]:
 tt=np.arange(int(sr*.16))/sr;add(6.57/tempo+off,.06*np.sin(2*np.pi*frequency*tt)*np.exp(-tt*22),'confirmation chime')
bed=np.clip(bed,-.4,.4)
with wave.open(str(R/'original-music-and-reaction-sfx.wav'),'wb') as w:
 w.setnchannels(2);w.setsampwidth(2);w.setframerate(sr);w.writeframes((np.column_stack([bed,bed])*32767).astype('<i2').tobytes())
filters='[1:a]asplit=2[voc][duck];[2:a][duck]sidechaincompress=threshold=0.025:ratio=3:attack=10:release=100[quiet];[voc][quiet]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89:level=false[a]'
cmd=[ffmpeg,'-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','1080x1920','-r',str(FPS),'-i','pipe:0','-i',str(audio),'-i',str(R/'original-music-and-reaction-sfx.wav'),'-filter_complex',filters,'-map','0:v','-map','[a]','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-t',str(duration),'-movflags','+faststart',str(out)]
with (R/'render.log').open('wb') as log:
 proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=log)
 try:
  for i in range(math.ceil(duration*FPS)):proc.stdin.write(frame(i/FPS).tobytes())
 finally:proc.stdin.close()
 assert proc.wait()==0,'Review render.log'
subprocess.run([ffmpeg,'-v','error','-xerror','-i',str(out),'-f','null','-'],check=True,stderr=subprocess.PIPE)
probe=json.loads(subprocess.check_output([ffprobe,'-v','error','-show_streams','-show_format','-of','json',str(out)]))
v=next(s for s in probe['streams'] if s['codec_type']=='video');a=next(s for s in probe['streams'] if s['codec_type']=='audio');assert (v['width'],v['height'],v['codec_name'],a['codec_name'])==(W,H,'h264','aac')
proof={'full_decode':'passed','duration_seconds':float(probe['format']['duration']),'resolution':[W,H],'video_codec':v['codec_name'],'audio_codec':a['codec_name'],'shots':len(shots),'caption_cues':len(cues),'motion_frames':math.ceil(duration*FPS),'photoreal_ai_reaction_images':3,'lip_sync':False,'real_event_claimed':False,'sfx':effects,'final_scene_review':False,'published':False}
(R/'FINAL-VERIFICATION.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8')
(R/'SHOT-PLAN.json').write_text(json.dumps([{'start':s,'visual':k,'title':title} for s,k,title in shots],indent=2),encoding='utf-8')
for i,(s,k,title) in enumerate(shots):frame(min(duration-.1,s+.25)).save(R/f'review-scene-{i+1}.jpg',quality=93)
frame(.75).save(R/'cover-frame.png')
(R/'publishing-package.json').write_text(json.dumps({'title':'Your Stream Just Leaked the Group Chat','description':"Wrong screen, very wrong audience. A quick OBS privacy check with a milk detour: keep private windows off the captured monitor, use Game Capture when it works for your game, and review a short recording before going live.\n\nFull setup guide: https://www.youtube.com/watch?v=wQCuI-5i0iQ\n\nAI-dramatized reaction images based on my photos; this is a fictional skit, not footage of a real private-message leak. Narrated with fred, my own voice clone. Original synthesized music and sound effects.\n\nSubscribe for Nori projects and practical creator tools.\n\n#OBS #StreamingTips #FredoIndaWRX",'tags':['OBS','Game Capture','streaming setup','stream privacy','Nori'],'thumbnail_text':'GROUP CHAT: LIVE.','visibility':'Public','scheduled':False,'ai_disclosure':True,'related_video_id':'wQCuI-5i0iQ','video_asset':out.name},indent=2),encoding='utf-8')
(R/'GENERATION-RECORD.json').write_text(json.dumps({'narrator':'MiniMax fred owner voice clone','model':'speech-2.8-hd','source_audio':'MiniMax_2026-10-01_11_51_49_fred.wav','credits_before':1279,'credits_after':747,'correct_script_credits':265,'accidental_old_script_regeneration_credits':267,'image_tool':'built-in image_gen','face_reference':'User-supplied solo portrait in black coat','reference_file':'C:/Users/Studio/Pictures/488924936_1977117449486040_3193506081902290240_n.jpg','other_people_from_photos_used':False,'image_prompts':'Identity-preserving horrified streamer at two-monitor desk; deadpan milk-carton reaction; smiling thumbs-up. Warm natural photographic look, cap, sunglasses, stud and pendant preserved.','ai_people_are_animated_stills':True,'published':False},indent=2),encoding='utf-8')
print(json.dumps(proof))
