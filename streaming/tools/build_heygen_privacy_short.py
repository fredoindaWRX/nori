"""Finish the owner's official HeyGen export while preserving its performance."""
import json, math, random, subprocess, wave
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

D=Path('C:/Nori/streaming/channel-operator/03-Production/Human-Reactions/Privacy-Milk/HeyGen-Updated-Avatar')
T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'))
ff,fp=T['ffmpeg'],T['ffprobe']
source=D/'HeyGen-Owner-Avatar-Original.mp4'
from presenter_policy import enforce_presenter_source
enforce_presenter_source(source)
out=D/'Keep-The-Group-Chat-Off-Stream-HeyGen-Final.mp4'
assert source.exists() and not out.exists(), 'Preserve existing exports'
probe=json.loads(subprocess.check_output([fp,'-v','error','-show_streams','-show_format','-of','json',str(source)]))
video=next(s for s in probe['streams'] if s['codec_type']=='video')
assert (video['width'],video['height'],video['avg_frame_rate'])==(720,1280,'25/1')
W,H,FPS=720,1280,25
duration=float(probe['format']['duration'])
cues=[(0,.96,'Your group chat'),(.96,1.78,'did not apply'),(1.78,2.60,'to be your co-host.'),(3.14,4.06,'If OBS captures'),(4.06,4.90,'your whole monitor,'),(5.28,5.98,'private windows can'),(5.98,6.54,'show up too.'),(7,7.72,'Use Game Capture'),(7.72,8.40,'when it works,'),(8.70,9.76,'then record ten seconds'),(9.76,10.66,'and watch it'),(10.66,11.50,'before going live.'),(12.08,12.80,'Save the chaos'),(12.80,13.32,'for the game.')]

def stamp(t):
 m=round(t*1000)
 return f'{m//3600000:02d}:{m//60000%60:02d}:{m//1000%60:02d},{m%1000:03d}'
(D/'captions.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(a)} --> {stamp(b)}\n{s}' for i,(a,b,s) in enumerate(cues))+'\n',encoding='utf-8')

# Two original, quiet sounds placed in measured pauses; no music bed.
rate=48000
rng=random.Random(20261001)
samples=[]
for i in range(math.ceil(duration*rate)):
 t=i/rate; x=0.0
 u=t-2.70
 if 0<=u<.14:
  envelope=math.sin(math.pi*u/.14)**2
  x=.045*envelope*(.7*math.sin(2*math.pi*(850*u-2100*u*u))+.3*rng.uniform(-1,1))
 u=t-8.46
 if 0<=u<.085:
  x+=.035*math.exp(-u*75)*math.sin(2*math.pi*1100*u)
 samples.append(max(-32768,min(32767,round(x*32767))))
import array
with wave.open(str(D/'original-reaction-sfx.wav'),'wb') as wav:
 wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(rate)
 wav.writeframes(array.array('h',samples).tobytes())

caption_font=ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf',39)
label_font=ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf',24)
small_font=ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf',19)

def compose(raw,t):
 im=Image.frombytes('RGB',(W,H),raw); d=ImageDraw.Draw(im)
 # Actual final-source face can extend to y1020. Captions occupy clear
 # ceiling above the cap, rather than covering the beard or watermark.
 for a,b,s in cues:
  if a<=t<b:
   color='#83ffd0' if 'Game Capture' in s else 'white'
   d.text((360,64),s,font=caption_font,fill=color,anchor='mm',stroke_width=3,stroke_fill='#07101b')
 if 7<=t<8.40:
  # Generic illustration; no private messages or claim of a live OBS test.
  for x,label,sub,color in [(35,'GAME','ON STREAM','#83ffd0'),(255,'PRIVATE','OFF STREAM','#ffd08c')]:
   d.rounded_rectangle((x,1090,x+200,1198),radius=12,fill='#10202c',outline=color,width=3)
   d.text((x+100,1124),label,font=label_font,fill=color,anchor='mm')
   d.text((x+100,1168),sub,font=small_font,fill='white',anchor='mm')
 return im

decoder=subprocess.Popen([ff,'-v','error','-i',str(source),'-an','-pix_fmt','rgb24','-f','rawvideo','pipe:1'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
cmd=[ff,'-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','720x1280','-r','25','-i','pipe:0','-i',str(source),'-i',str(D/'original-reaction-sfx.wav'),'-filter_complex','[1:a][2:a]amix=inputs=2:duration=first:normalize=0[a]','-map','0:v','-map','[a]','-c:v','libx264','-crf','18','-preset','fast','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-t',str(duration),'-movflags','+faststart',str(out)]
review_times=[.5,1.35,2.2,3.65,4.5,5.65,6.2,7.35,8.05,9.25,10.3,11.1,12.45,13.05]
reviews={round(t*FPS):n+1 for n,t in enumerate(review_times)}
with (D/'assembly.log').open('wb') as log:
 encoder=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=log)
 try:
  for i in range(int(video['nb_frames'])):
   raw=decoder.stdout.read(W*H*3)
   assert len(raw)==W*H*3, 'Incomplete source frame'
   im=compose(raw,i/FPS)
   encoder.stdin.write(im.tobytes())
   if i in reviews:im.save(D/f'review-caption-{reviews[i]:02d}.png')
   if i==12:im.save(D/'cover-frame.png')
 finally:encoder.stdin.close()
 assert encoder.wait()==0, 'Inspect assembly.log'
 decoder.stdout.close();assert decoder.wait()==0
subprocess.run([ff,'-v','error','-xerror','-i',str(out),'-map','0','-f','null','-'],check=True)
final_probe=json.loads(subprocess.check_output([fp,'-v','error','-show_streams','-show_format','-of','json',str(out)]))
v=next(s for s in final_probe['streams'] if s['codec_type']=='video')
a=next(s for s in final_probe['streams'] if s['codec_type']=='audio')
assert (v['width'],v['height'],v['codec_name'],a['codec_name'],v['nb_frames'])==(720,1280,'h264','aac',video['nb_frames'])
proof={'full_decode':'passed','source_full_decode':'passed','source':'HeyGen-Owner-Avatar-Original.mp4','final_video':out.name,'resolution':[720,1280],'fps':25,'frames':int(v['nb_frames']),'duration_seconds':float(final_probe['format']['duration']),'video_codec':'h264','audio_codec':'aac','actual_owner_digital_twin':True,'voice_id':'2a3e8a799bf949898594b507bed1aac9','actual_source_motion_preserved':True,'camera_zoom_added':False,'speech_speed_changed':False,'source_video_upscaled':False,'provider_watermark_preserved':True,'caption_cues':14,'caption_timing_source':'Local word timestamps from completed source audio','music_bed':False,'original_sfx_count':2,'visual_review_completed':False,'perceptual_voice_acceptance':False,'owner_quality_acceptance':False,'youtube_published':False}
(D/'FINAL-VERIFICATION.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8')
(D/'publishing-package.json').write_text(json.dumps({'title':'Your Group Chat Did Not Apply to Be Your Co-Host','description':'Your game belongs on stream. Your private windows need their own space. Use Game Capture when it works for your game, and review a short recording before going live.\n\nFull OBS guide: https://www.youtube.com/watch?v=wQCuI-5i0iQ\n\nMade with my own HeyGen digital twin and updated cloned voice. This is an AI-generated performance, not a recording of an actual private-chat leak. The two-screen graphic is illustrative. Original reaction sounds; provider watermark retained.\n\nSubscribe for Nori projects and practical creator tools.\n\n#OBS #StreamingTips #FredoIndaWRX','tags':['OBS','Game Capture','stream privacy','creator tools','Nori'],'visibility':'Public','scheduled':False,'ai_disclosure':True,'playlist':'Creator Tools','related_video_id':'wQCuI-5i0iQ'},indent=2)+'\n',encoding='utf-8')
print(json.dumps(proof))
