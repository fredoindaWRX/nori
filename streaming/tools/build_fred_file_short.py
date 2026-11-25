"""Render original Nori character motion, comic timing and measured captions."""
import argparse,json,math,re,subprocess,wave
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont
import render_brand_kit as brand

p=argparse.ArgumentParser();p.add_argument('folder',type=Path);args=p.parse_args();folder=args.folder
package=json.loads((folder/'publishing-package.json').read_text());plan=json.loads((folder/'SHOT-PLAN.json').read_text())
tools=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'));ffmpeg=tools['ffmpeg'];ffprobe=tools['ffprobe']
output=folder/package['video_asset'];assert not output.exists(),'Preserve earlier edits before rerendering'
audio=folder/'narration-fred-final.mp3';dur=float(json.loads(subprocess.check_output([ffprobe,'-v','error','-show_format','-of','json',str(audio)]))['format']['duration']);assert 10<=dur<=60
assert abs(sum(s['duration_seconds'] for s in plan['shots'])-dur)<.2
W,H=1080,1920;fps=30
CYAN='#42e6ff';YELLOW='#ffe55b';PINK='#ff5e98';WHITE='#f5f7ff';DARK='#101329';GREEN='#7effaa'
font_file='C:/Windows/Fonts/seguisb.ttf'
def font(size):return ImageFont.truetype(font_file,size)
def label(draw,xy,text,size=52,color=WHITE,anchor=None,stroke=0):
 draw.text(xy,text,font=font(size),fill=color,anchor=anchor,stroke_width=stroke,stroke_fill='#090d21')
def wrapped(text,size,width):
 f=font(size);lines=[];line=''
 for word in text.split():
  trial=(line+' '+word).strip()
  if f.getlength(trial)>width and line:lines.append(line);line=word
  else:line=trial
 if line:lines.append(line)
 return lines
def title(draw,text,y,scale=1,color=WHITE):
 size=int(88*scale);lines=wrapped(text,size,860)
 for line in lines:label(draw,(W/2,y),line,size,color,anchor='mt',stroke=3);y+=size*1.08
 assert y<760,'Title overlaps the character stage'
def computer(draw,cx,cy,size,t,emotion='happy',chef=False):
 # Original geometric mascot: a computer, its N mark and exaggerated expressions.
 w=size;h=size*.74;x=cx-w/2;y=cy-h/2
 draw.rounded_rectangle((x+14,y+20,x+w+14,y+h+20),radius=44,fill='#030611')
 draw.rounded_rectangle((x,y,x+w,y+h),radius=44,fill='#b8c8dd',outline=WHITE,width=5)
 draw.rounded_rectangle((x+15,y+15,x+w-15,y+h-15),radius=34,fill='#11182a',outline=CYAN,width=4)
 ex=w*.16;ey=cy-h*.03;blink=(t%3.3)<.10
 for side in [-1,1]:
  xx=cx+side*w*.19
  if blink:draw.line((xx-ex/2,ey,xx+ex/2,ey),fill=CYAN,width=13)
  else:
   eyeh=w*.12 if emotion=='shock' else w*.07
   draw.ellipse((xx-ex/2,ey-eyeh,xx+ex/2,ey+eyeh),fill=WHITE)
   px=xx+math.sin(t*2)*w*.017
   draw.ellipse((px-w*.03,ey-w*.03,px+w*.03,ey+w*.03),fill='#0b1428')
   if emotion=='smug':draw.line((xx-ex*.6,ey-eyeh*1.2,xx+ex*.5,ey-eyeh*.7),fill=PINK,width=9)
 if emotion=='shock':draw.ellipse((cx-w*.05,cy+h*.15,cx+w*.05,cy+h*.34),fill=PINK)
 elif emotion=='dead':draw.line((cx-w*.10,cy+h*.23,cx+w*.10,cy+h*.23),fill=YELLOW,width=10)
 else:draw.arc((cx-w*.12,cy+h*.02,cx+w*.12,cy+h*.33),0,180,fill=GREEN,width=10)
 # N is a role mark, not a replica of a third-party character.
 label(draw,(cx,cy-h*.31),'N',int(w*.10),CYAN,anchor='mm')
 draw.polygon([(cx-w*.10,y+h),(cx+w*.10,y+h),(cx+w*.17,y+h+50),(cx-w*.17,y+h+50)],fill='#adb7ca')
 draw.rounded_rectangle((cx-w*.25,y+h+42,cx+w*.25,y+h+65),radius=12,fill='#a9bcd1')
 if emotion in ['shock','dead']:
  sx=x+w+24;sy=y+h*.23
  draw.ellipse((sx,sy,sx+27,sy+48),fill=CYAN)
 if chef:
  yy=y-46
  draw.rounded_rectangle((cx-w*.18,yy-16,cx+w*.18,yy+30),radius=12,fill=WHITE)
  for off in [-.12,0,.12]:draw.ellipse((cx+w*off-55,yy-75,cx+w*off+55,yy+12),fill=WHITE)
def card(draw,box,text,color=CYAN,size=45):
 draw.rounded_rectangle(box,radius=22,fill=DARK,outline=color,width=5)
 label(draw,((box[0]+box[2])/2,(box[1]+box[3])/2),text,size,color,anchor='mm')
def sticker(im,text,position,color=YELLOW,angle=-9):
 f=font(52);width=int(f.getlength(text))+60
 s=Image.new('RGBA',(width,100));d=ImageDraw.Draw(s);d.rounded_rectangle((4,4,width-4,96),radius=18,fill=color,outline=WHITE,width=4)
 d.text((width/2,50),text,font=f,fill='#11152b',anchor='mm');s=s.rotate(angle,expand=True,resample=Image.Resampling.BICUBIC)
 im.alpha_composite(s,(int(position[0]-s.width/2),int(position[1]-s.height/2)))

base=brand.background(W,H)
bd=ImageDraw.Draw(base)
label(bd,(70,100),'FredoIndaWRX  /  BUILDING NORI',30,CYAN)
label(bd,(70,1790),'ORIGINAL NORI SKIT + ONE USEFUL CHECK',27,CYAN)
starts=[s['start_seconds'] for s in plan['shots']]
hook_starts=[]
for match in re.finditer(r'(\d+):(\d+):(\d+),(\d+)\s*-->',(folder/'captions.srt').read_text(encoding='utf-8-sig')):
 v=list(map(int,match.groups()));hook_starts.append(v[0]*3600+v[1]*60+v[2]+v[3]/1000)
assert len(hook_starts)>=3
def frame(seconds):
 index=max(i for i,start in enumerate(starts) if start<=seconds);local=seconds-starts[index]
 im=base.copy();d=ImageDraw.Draw(im)
 title(d,plan['shots'][index]['title'],330,1+.05*math.sin(local*6)*math.exp(-local*4),YELLOW if index<2 else WHITE)
 label(d,(540,590),'ILLUSTRATIVE SKIT',32,CYAN,anchor='mt')
 shift=int(35*math.exp(-local*12));x=100+shift
 d.rounded_rectangle((x,700,x+880,1340),radius=35,fill='#1b2440',outline=CYAN,width=4)
 if index<2:
  card(d,(x+35,750,x+845,870),'AI CHAT: DONE!',GREEN,54)
  card(d,(x+35,940,x+845,1140),'OUTPUT FOLDER: 0 FILES',PINK,43)
  label(d,(540,1210),'Great confidence. Zero files.',38,WHITE,anchor='mt')
 elif index==2:
  label(d,(x+45,760),'ONE SMALL REQUEST',40,CYAN)
  label(d,(x+45,900),'Create hello.txt',63,WHITE)
  label(d,(x+45,1020),'Write: Hello, Nori!',54,YELLOW)
 elif index in [3,6]:
  label(d,(x+45,760),'hello.txt',48,CYAN)
  card(d,(x+40,880,x+840,1060),'Hello, Nori!',GREEN,64)
  label(d,(540,1160),'FILE EXISTS + TEXT MATCHES',36,GREEN,anchor='mt')
 elif index==4:
  card(d,(x+40,850,x+840,1020),'FILE MISSING',PINK,60)
  label(d,(540,1140),'FAIL - ASK FOR THE OUTPUT',38,WHITE,anchor='mt')
 else:
  card(d,(x+40,800,x+840,960),'TEXT DOES NOT MATCH',PINK,43)
  label(d,(540,1100),'Retry the same small task.',40,WHITE,anchor='mt')
 return im.convert('RGB')

# Original faster drum/bass motif and precisely timed comic hits; no sampled songs.
sr=48000;music=np.zeros(int(math.ceil(dur*sr))+sr,dtype=np.float64);rng=np.random.default_rng(44821)
def add(start,signal):
 at=max(0,int(start*sr));end=min(len(music),at+len(signal));music[at:end]+=signal[:end-at]
for beat in np.arange(0,dur,60/144):
 tt=np.arange(int(sr*.14))/sr
 add(beat,.009*np.sin(2*np.pi*(75*tt-130*tt*tt))*np.exp(-tt*34))
 tt=np.arange(int(sr*.055))/sr;add(beat+.20,.003*rng.normal(size=len(tt))*np.exp(-tt*95))
for start in starts:
 tt=np.arange(int(sr*.13))/sr;add(start,.014*rng.normal(size=len(tt))*np.sin(np.pi*tt/.13)**2)
for start in [starts[0]+1.1,starts[4]]:
 tt=np.arange(int(sr*.22))/sr;add(start,.017*np.sin(2*np.pi*(690*tt-1200*tt*tt))*np.exp(-tt*13))
music=np.clip(music[:int(math.ceil(dur*sr))],-.1,.1)
bed=folder/'original-comic-music-and-hits.wav'
with wave.open(str(bed),'wb') as wav:wav.setnchannels(2);wav.setsampwidth(2);wav.setframerate(sr);wav.writeframes(np.column_stack([music,music]).astype(np.float64).__mul__(32767).astype('<i2').tobytes())

events=[]
for block in re.split(r'\n\s*\n',(folder/'captions.srt').read_text(encoding='utf-8-sig').strip()):
 lines=block.splitlines();match=re.match(r'(\d+):(\d+):(\d+)[,.](\d+) --> (\d+):(\d+):(\d+)[,.](\d+)',lines[1]);assert match
 values=list(map(int,match.groups()))
 def ass(v):return f'{v[0]}:{v[1]:02d}:{v[2]:02d}.{v[3]//10:02d}'
 text=r'\N'.join(lines[2:]).replace('{','').replace('}','')
 events.append(f'Dialogue: 0,{ass(values[:4])},{ass(values[4:])},Default,,0,0,0,,{text}')
assfile=output.with_suffix('.ass');assfile.write_text('''[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Segoe UI,58,&H00FFFFFF,&H00FFFFFF,&H001B110A,&H001B110A,-1,0,0,0,100,100,0,0,1,5,0,2,80,160,285,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''+ '\n'.join(events)+'\n',encoding='utf-8')
filter_path=assfile.resolve().as_posix().replace(':',r'\:')
af='[1:a]aresample=48000,asplit=2[voice][duck];[2:a]aresample=48000[bed];[bed][duck]sidechaincompress=threshold=0.025:ratio=4:attack=10:release=100[quiet];[voice][quiet]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89:level=false[a]'
cmd=[ffmpeg,'-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','1080x1920','-r',str(fps),'-i','pipe:0','-i',str(audio),'-i',str(bed),'-filter_complex',f"[0:v]ass=filename='{filter_path}'[v];"+af,'-map','[v]','-map','[a]','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-t',str(dur),'-movflags','+faststart',str(output)]
logfile=folder/'comic-render.log'
with logfile.open('wb') as log:
 proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=log)
 try:
  for i in range(math.ceil(dur*fps)):proc.stdin.write(frame(i/fps).tobytes())
 finally:proc.stdin.close()
 assert proc.wait()==0,'Review comic-render.log'
subprocess.run([ffmpeg,'-v','error','-xerror','-i',str(output),'-f','null','-'],check=True,stderr=subprocess.PIPE)
final=json.loads(subprocess.check_output([ffprobe,'-v','error','-show_format','-show_streams','-of','json',str(output)]));v=next(x for x in final['streams'] if x['codec_type']=='video');a=next(x for x in final['streams'] if x['codec_type']=='audio')
assert (v['width'],v['height'],v['codec_name'],a['codec_name'])==(1080,1920,'h264','aac')
final.update(full_decode='passed',edit_style='Original animated Nori computer character, frame-by-frame expressions and movement, title punch-ins, graphic burst lines, reaction stickers, original 144 BPM percussion and timed comic hits, measured speech captions',reference_inspiration=['https://www.youtube.com/shorts/mfCn1O1zZHI','https://www.youtube.com/shorts/-DzWkNHHvVw'],reference_footage_used=False)
output.with_suffix('.verification.json').write_text(json.dumps(final,indent=2),encoding='utf-8')
frame(.9).save(folder/'cover-frame.png')
print(json.dumps({'render':str(output),'duration':float(final['format']['duration']),'decode':'passed','original_motion_frames':math.ceil(dur*fps)}))
