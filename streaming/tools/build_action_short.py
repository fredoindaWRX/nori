"""Render original Nori character motion, comic timing and measured captions."""
import argparse,json,math,re,subprocess,wave
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont
import render_brand_kit as brand

p=argparse.ArgumentParser();p.add_argument('folder',type=Path);args=p.parse_args();folder=args.folder
package=json.loads((folder/'publishing-package.json').read_text(encoding='utf-8'));plan=json.loads((folder/'SHOT-PLAN.json').read_text(encoding='utf-8'))
tools=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'));ffmpeg=tools['ffmpeg'];ffprobe=tools['ffprobe']
output=folder/package['video_asset'];assert not output.exists(),'Preserve earlier edits before rerendering'
audio=folder/'narration-fred-final.mp3';dur=float(json.loads(subprocess.check_output([ffprobe,'-v','error','-show_format','-of','json',str(audio)]))['format']['duration']);assert 12<=dur<=60
assert abs(sum(s['duration_seconds'] for s in plan['shots'])-dur)<.2
W,H=1080,1920;fps=30
voice_pcm=np.frombuffer(subprocess.check_output([ffmpeg,'-v','error','-i',str(audio),'-f','f32le','-ac','1','-ar','16000','pipe:1']),dtype='<f4')
speech_energy=np.array([np.sqrt(np.mean(voice_pcm[i:i+320]**2)) for i in range(0,len(voice_pcm),320)])
speech_energy=np.clip(speech_energy/max(.001,float(np.percentile(speech_energy,95))),0,1)
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
 else:
  opening=float(speech_energy[min(len(speech_energy)-1,int(t/.02))])
  if opening>.19:
   mh=w*(.018+.07*opening)
   draw.ellipse((cx-w*.11,cy+h*.22-mh,cx+w*.11,cy+h*.22+mh),fill='#030711',outline=GREEN,width=7)
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
 size=52;f=font(size)
 while f.getlength(text)>760 and size>26:size-=2;f=font(size)
 width=int(f.getlength(text))+60
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
def old_frame(seconds):
 index=max(i for i,start in enumerate(starts) if start<=seconds);local=seconds-starts[index];shot=plan['shots'][index]
 im=base.copy();d=ImageDraw.Draw(im)
 # A brief camera shove on every cut, plus a continuing motion beat.
 entrance=math.exp(-local*13);bounce=math.sin(local*6)*math.exp(-local*3)
 tx=70*entrance;title_scale=1+.09*bounce
 topic=folder.name
 opening=shot['title']
 if index==0 and topic=='W3-S1':opening='GREEN LIGHT' if seconds<hook_starts[1] else ('NO BRAIN' if seconds<hook_starts[2] else 'EXCELLENT TEAMWORK')
 if index==0 and topic=='W3-S2':opening='12 JOB TITLES' if seconds<hook_starts[1] else ('ONE BRAIN' if seconds<hook_starts[2] else 'GROUP PROJECT ENERGY')
 label(d,(70,230),f'{index+1:02d}',45,PINK)
 title(d,opening,330,title_scale,YELLOW if index==0 else WHITE)
 cx=520+tx;cy=(1020 if topic=='W3-S2' else 920)+math.sin(seconds*2.3)*16
 hero=470 if topic=='W3-S2' else (680 if index==0 else 600)
 size=hero*(1+.05*math.sin(local*8)*math.exp(-local*3))
 emotion='happy';chef=False
 if topic=='W3-S1':
  emotion='smug' if index in [0,2,6] else ('shock' if index in [1,4] else 'happy')
  if index==0:emotion='smug' if local<.6 else 'dead'
  chef=index==4
  computer(d,cx,cy,size,seconds,emotion,chef)
  if index in [0,1]:
   card(d,(180,1260,850,1380),'MODEL: 404' if index==1 or local>.6 else 'STATUS: GREEN',PINK if index==1 or local>.6 else GREEN)
  elif index==2:card(d,(160,1260,890,1380),'SERVICE: ALIVE',GREEN)
  elif index==3:card(d,(120,1260,930,1380),'MODEL + DEPENDENCIES + REQUEST?',CYAN,34)
  elif index==4:card(d,(160,1260,890,1380),'OPEN ≠ CHEF',YELLOW)
  elif index==5:
   for j,text in enumerate(['INPUT','AI','RESULT']):card(d,(100+j*300,1250,350+j*300,1370),text,GREEN if j==2 else CYAN,38)
  else:card(d,(180,1260,850,1380),'NEXT BUILD →',GREEN)
 elif topic=='W3-S2':
  computer(d,cx,cy,size,seconds,'shock' if index<2 else 'happy')
  if index in [0,1,2]:
   for j in range(12):
    yy=660+(j%6)*107;xx=60 if j<6 else 790
    card(d,(xx,yy,xx+210,yy+90),'ROLE '+str(j+1),PINK if j%2 else YELLOW,32)
   card(d,(220,1290,820,1400),'SHARED MODEL',CYAN)
  elif index==3:card(d,(180,1260,850,1390),'WHO IS ACTIVE?',YELLOW)
  elif index==4:card(d,(120,1260,930,1390),'ROSTER ≠ CONCURRENCY',PINK,39)
  elif index==5:card(d,(120,1260,930,1390),'MEMORY + LATENCY: MEASURE',GREEN,37)
  else:card(d,(180,1260,850,1390),'NEXT BUILD →',GREEN)
 elif topic=='W4-S1':
  computer(d,cx,cy,size,seconds,'dead' if index<2 else 'happy')
  for j,text in enumerate(['INPUT','DELIVER','DO','CHECK']):
   xx=85+j*247;yy=1260
   color=GREEN if index>=4 and j<=int((local*2)%4) else CYAN
   card(d,(xx,yy,xx+210,yy+110),text,color,32)
  if index in [0,1,3]:sticker(im,'TASK: STILL WAITING',(530,1435),PINK)
  elif index==5:sticker(im,'SHOW THE RECEIPT',(530,1445),GREEN)
 else:
  computer(d,cx,cy,size,seconds,'smug' if index in [0,2] else ('shock' if index==4 else 'happy'))
  if index==0:sticker(im,'TRUST ME BRO',(530,1310),YELLOW)
  elif index==1:card(d,(140,1270,900,1390),'ONE TASK. ONE PASS CHECK.',GREEN,37)
  elif index==2:sticker(im,'CONFIDENCE: 100%',(530,1320),PINK)
  elif index==3:card(d,(140,1270,900,1390),'INPUT → PATH → OUTPUT',CYAN,38)
  elif index==4:sticker(im,'DEPENDENCY LEFT THE CHAT',(530,1350),PINK)
  elif index==5:card(d,(140,1270,900,1390),'SMALL TASK. VISIBLE RESULT.',GREEN,37)
  else:card(d,(180,1260,850,1390),'NEXT BUILD →',GREEN)
 # Graphic burst lines are brief accents, never full-screen flashes.
 if local<.30:
  d=ImageDraw.Draw(im)
  for j in range(9):
   a=j*math.pi*2/9;r=310+local*190
   x=520+math.cos(a)*r;y=1020+math.sin(a)*r
   d.line((x,y,x+math.cos(a)*90,y+math.sin(a)*90),fill=YELLOW,width=5)
 return im.convert('RGB')

# Distinct comic staging replaces the repeated centered mascot layout.
spoken=json.loads((folder/'spoken-words.json').read_text(encoding='utf-8'))
caption_groups=[];word_cursor=0
for block in re.split(r'\n\s*\n',(folder/'captions.srt').read_text(encoding='utf-8-sig').strip()):
 lines=block.splitlines();numbers=list(map(int,re.findall(r'\d+',lines[1])))
 a=numbers[0]*3600+numbers[1]*60+numbers[2]+numbers[3]/1000
 b=numbers[4]*3600+numbers[5]*60+numbers[6]+numbers[7]/1000
 count=len(' '.join(lines[2:]).split());group=spoken[word_cursor:word_cursor+count]
 assert ' '.join(x['word'] for x in group)==' '.join(lines[2:])
 caption_groups.append((a,b,group));word_cursor+=count
assert word_cursor==len(spoken)

def bubble(draw,box,text,color=WHITE,size=64):
 draw.rounded_rectangle(box,radius=40,fill=color,outline='#101329',width=8)
 draw.polygon([(box[0]+80,box[3]-2),(box[0]+115,box[3]+40),(box[0]+155,box[3]-2)],fill=color)
 lines=wrapped(text,size,box[2]-box[0]-60)
 for j,line in enumerate(lines):label(draw,((box[0]+box[2])/2,(box[1]+box[3])/2+(j-(len(lines)-1)/2)*size*1.1),line,size,'#101329',anchor='mm')

def receipt(draw,x,y,text,color=WHITE,tilt=0):
 # Oversized paper prop with a clear outcome; the examples are hypothetical.
 draw.rounded_rectangle((x,y,x+620,y+300),radius=20,fill=color,outline='#131b2e',width=7)
 label(draw,(x+45,y+38),'TEST RECEIPT',30,'#11152b')
 label(draw,(x+310,y+155),text,72,'#11152b',anchor='mm')
 for j in range(3):draw.line((x+50,y+240+j*14,x+250+j*70,y+240+j*14),fill='#4b5266',width=4)

def captions(draw,t):
 for a,b,group in caption_groups:
  if a<=t<=b:
   lines=[];line=[];width=0;f=font(68);space=f.getlength(' ')
   for item in group:
    w=f.getlength(item['word'])
    if line and width+w+space>860:lines.append(line);line=[];width=0
    line.append(item);width+=w+space
   if line:lines.append(line)
   for j,items in enumerate(lines):
    width=sum(f.getlength(q['word']) for q in items)+space*(len(items)-1);x=(1000-width)/2;y=1505+j*82
    for item in items:
     active=item['start']-.04<=t<=item['end']+.06
     label(draw,(x,y),item['word'],68,YELLOW if active else WHITE,stroke=5)
     x+=f.getlength(item['word'])+space
   break

def roles_action(im,d,index,local,t):
 if index==0:
  bubble(d,(130,280,940,500),'12 JOB TITLES',YELLOW,80)
  for j in range(12):
   x=110+(j%4)*230;y=560+(j//4)*115
   card(d,(x,y,x+195,y+90),str(j+1),PINK if j%2 else CYAN,50)
  computer(d,530,1100,420,t,'shock')
  card(d,(200,1300,860,1410),'ONE BRAIN',YELLOW,65)
 elif index==1:
  label(d,(510,355),'GROUP PROJECT',86,YELLOW,anchor='mm')
  # Twelve empty title badges crowd the one worker doing the thinking.
  for j in range(12):
   a=j*math.pi/6;x=530+math.cos(a)*340;y=940+math.sin(a)*290
   card(d,(x-83,y-42,x+83,y+42),'BOSS '+str(j+1),CYAN,27)
  computer(d,530,945,370,t,'dead')
  sticker(im,"EVERYONE'S A MANAGER",(520,1350),PINK)
 elif index==2:
  bubble(d,(90,290,985,530),'JOB DESCRIPTIONS',YELLOW,72)
  receipt(d,140,680,'PLAN / WRITE',WHITE)
  computer(d,790,1220,270,t,'happy')
  card(d,(100,1280,670,1400),'A JOB IS A ROLE',GREEN,45)
 elif index==3:
  label(d,(520,345),'MODELS ARE NOT MAGIC',65,YELLOW,anchor='mm')
  for j in range(12):
   x=140+(j%4)*220;y=560+(j//4)*170
   card(d,(x,y,x+150,y+120),'?', '#596576',65)
  computer(d,535,1190,360,t,'shock')
  sticker(im,'NO AUTOMATIC MODEL SPAWN',(520,1360),PINK,5)
 elif index==4:
  bubble(d,(90,300,980,545),'WHO IS ACTIVE?',YELLOW,80)
  for j,text in enumerate(['ROLE: CHECK','MODEL: CHECK','PROCESS: CHECK']):
   card(d,(140,650+j*160,920,780+j*160),text,CYAN,58)
  x=680+math.sin(local*2)*70;y=1150
  d.ellipse((x-90,y-90,x+90,y+90),outline=YELLOW,width=15)
  d.line((x+68,y+70,x+170,y+174),fill=YELLOW,width=22)
 elif index==5:
  label(d,(510,365),'SHOW THE NUMBERS',76,YELLOW,anchor='mm')
  card(d,(130,650,920,850),'MEMORY: MEASURE',CYAN,62)
  card(d,(130,930,920,1130),'LATENCY: MEASURE',GREEN,62)
  computer(d,820,1310,235,t,'dead')
  sticker(im,'BENCHMARK BEFORE BRAGGING',(490,1250),PINK,4)
 else:
  receipt(d,200,380,'RESUME: 12 JOBS',YELLOW)
  computer(d,535,1020,690,t,'smug')
  card(d,(115,1280,930,1430),'BENCHMARK: WHERE?',PINK,58)
  if local>.8:sticker(im,'GREAT PAPERWORK THOUGH',(520,740),GREEN,-4)

def agent_action(im,d,index,local,t):
 if index==0:
  bubble(d,(130,285,945,550),'NICE ARROWS',YELLOW,87)
  for j in range(3):
   x=145+j*260;y=760
   d.line((x,y,x+150,y),fill=CYAN,width=22)
   d.polygon([(x+145,y-35),(x+200,y),(x+145,y+35)],fill=CYAN)
  computer(d,535,1135,430,t,'dead')
  card(d,(130,1310,920,1430),'WORK DONE: ???',PINK,60)
 elif index==1:
  label(d,(520,365),'SUPERHERO TEAM',86,YELLOW,anchor='mm')
  for j in range(3):
   x=230+j*305;y=1020+math.sin(local*5+j)*20
   d.polygon([(x-90,y-100),(x+90,y-100),(x+130,y+240),(x-130,y+240)],fill=[PINK,CYAN,YELLOW][j])
   computer(d,x,y,250,t,'smug')
  sticker(im,'GREAT ENTRANCE. ZERO RECEIPTS.',(535,1350),GREEN,3)
 elif index==2:
  # The task envelope waits at a reception desk while the team poses.
  label(d,(520,355),'STILL IN RECEPTION',74,YELLOW,anchor='mm')
  d.rectangle((120,1030,970,1360),fill='#563854',outline=WHITE,width=5)
  card(d,(290,1130,790,1260),'RECEPTION',YELLOW,50)
  d.rectangle((340,745,720,975),fill=WHITE,outline=CYAN,width=8)
  d.line((340,745,530,850,720,745),fill='#263652',width=6)
  label(d,(530,905),'TASK',60,'#11152b',anchor='mm')
  computer(d,830,875,225,t,'dead')
 elif index==3:
  bubble(d,(90,300,980,555),'DELIVER THE REQUEST',YELLOW,67)
  for j,text in enumerate(['PICK','DELIVER']):card(d,(100+j*480,810,470+j*480,1010),text,CYAN,60)
  x=170+min(local/2,1)*650
  d.rectangle((x,1130,x+150,1230),fill=WHITE,outline=PINK,width=6)
  label(d,(x+75,1180),'TASK',30,'#11152b',anchor='mm')
  sticker(im,'CHOOSING IS NOT SENDING',(530,1380),PINK,3)
 elif index==4:
  label(d,(520,375),'QUEUED IS NOT DONE',80,YELLOW,anchor='mm')
  for j in range(4):
   x=170+j*165;y=740+j*70
   card(d,(x,y,x+220,y+250),'TASK',YELLOW,45)
  computer(d,820,1240,290,t,'shock')
  card(d,(100,1300,640,1415),'STILL WAITING',PINK,48)
 elif index==5:
  label(d,(520,355),'FOLLOW THE RESULT',80,YELLOW,anchor='mm')
  for j,text in enumerate(['INPUT','DELIVER','ACTION','CHECK']):
   y=600+j*170;color=GREEN if j<=min(3,int(local*2)) else CYAN
   card(d,(240,y,820,y+135),text,color,64)
 else:
  computer(d,535,970,740,t,'dead')
  card(d,(140,340,930,550),'NO RECEIPT?',YELLOW,80)
  sticker(im,'NO VICTORY DANCE',(535,1300),PINK,5)
  if local>.8:sticker(im,'SAVE THE CONFETTI',(535,640),GREEN,-5)

def frame(seconds):
 index=max(i for i,start in enumerate(starts) if start<=seconds);local=seconds-starts[index]
 colors=['#143455','#57182e','#13392e','#172c46','#47251c','#13452c','#251743']
 im=Image.new('RGBA',(W,H),colors[index]);d=ImageDraw.Draw(im)
 # Moving diagonals and perspective floor establish a new location at each cut.
 drift=(seconds*50)%200
 line_color=tuple(min(255,int(colors[index][i:i+2],16)+15) for i in (1,3,5))
 for x in range(-200,1300,200):d.line((x+drift,0,x+drift-650,1450),fill=line_color,width=4)
 d.polygon([(0,1240),(1080,1240),(1080,1920),(0,1920)],fill='#080e21')
 for x in range(-500,1600,220):d.line((540,1190,x,1920),fill='#263652',width=3)
 for y in [1350,1520,1740]:d.line((0,y,1080,y),fill='#263652',width=3)
 label(d,(55,82),'FREDO / BUILDING NORI',30,CYAN)
 label(d,(55,135),'ORIGINAL AI SKIT',24,WHITE)
 move=math.sin(local*9)*math.exp(-local*3)*50
 if folder.name in ['W3-S2','W4-S1']:
  (roles_action if folder.name=='W3-S2' else agent_action)(im,d,index,local,seconds)
  captions(ImageDraw.Draw(im),seconds)
  return im.convert('RGB')
 if index==0:
  computer(d,520,935,740*(1+.025*math.sin(local*5)),seconds,'smug')
  bubble(d,(150,310,940,630),'TRUST ME BRO',YELLOW,85)
  # Trust meter ramps up while the speech raises a doubt.
  card(d,(170,1280,865,1400),'EVIDENCE: ???',PINK,48)
 elif index==1:
  # Literal red flag with Wi-Fi waves: a visual punchline rather than a title card.
  d.line((320,540,320,1290),fill=WHITE,width=16)
  points=[(330,550),(830,580+math.sin(local*5)*40),(770,940+math.sin(local*5+1)*40),(330,890)]
  d.polygon(points,fill='#ff3b63');label(d,(540,695),'RED FLAG',60,WHITE,anchor='mm')
  for r in [45,95,145]:d.arc((540-r,900-r,540+r,900+r),210,330,fill=WHITE,width=11)
  d.ellipse((530,901,550,921),fill=WHITE)
  computer(d,860,1210,250,seconds,'shock')
  label(d,(500,370),'WITH WI-FI',92,YELLOW,anchor='mm')
 elif index==2:
  bubble(d,(95,310,980,570),'ONE TINY JOB',YELLOW,76)
  computer(d,760,1040,370,seconds,'happy')
  receipt(d,70+move,730,'2 + 2 = ?')
  card(d,(90,1250,920,1400),'PASS CHECK: ANSWER IS 4',GREEN,46)
 elif index==3:
  receipt(d,190+move,630,'RESULT: 4',GREEN)
  # Animated magnifying glass inspects the actual paper result.
  lx=600+math.sin(local*2)*80;ly=1020
  d.ellipse((lx-145,ly-145,lx+145,ly+145),outline=CYAN,width=24)
  d.line((lx+105,ly+110,lx+260,ly+265),fill=CYAN,width=36)
  computer(d,210,1200,280,seconds,'happy')
  label(d,(500,360),'SHOW THE RESULT',78,WHITE,anchor='mm')
 elif index==4:
  receipt(d,100+move,400,'INPUT: INVALID',YELLOW)
  computer(d,535+math.sin(local*35)*9,1025,660,seconds,'shock')
  for j in range(4):
   yy=700+j*120;xx=75 if j%2==0 else 760
   label(d,(xx,yy),'ERROR',40,PINK,stroke=2)
  card(d,(175,1270,875,1390),'ONE BAD REQUEST',PINK,50)
 elif index==5:
  computer(d,535,1010,720*(1+.025*math.sin(local*8)),seconds,'smug')
  bubble(d,(130,330,940,610),'PERFECT!',GREEN,100)
  # Error paper remains in shot to make the false-success gag visibly intelligible.
  card(d,(150,1260,900,1390),'INPUT: STILL INVALID',PINK,46)
  if local>.25:sticker(im,'ARE YOU SERIOUS?',(530,690),YELLOW,5)
 else:
  # Final close-up gives the dry punchline space, then returns to the loop premise.
  computer(d,535,940,790,seconds,'smug')
  card(d,(80,360,990,555),'CONFIDENCE: MAXIMUM',YELLOW,60)
  card(d,(115,1260,930,1410),'EVIDENCE: ZERO',PINK,61)
  if local>1.1:sticker(im,'CERTIFIED BRO SCIENCE',(510,665),GREEN,-6)
 # Brief speed lines support the cut without full-frame flashes.
 if local<.18:
  for j in range(7):
   a=j*math.pi*2/7;d.line((530+math.cos(a)*390,970+math.sin(a)*350,530+math.cos(a)*490,970+math.sin(a)*470),fill=YELLOW,width=6)
 captions(ImageDraw.Draw(im),seconds)
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
# A deliberate music dropout makes the dry congratulations land.
music[max(0,int((starts[6]-.12)*sr)):int((starts[6]+.48)*sr)]=0
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
cmd=[ffmpeg,'-v','error','-f','rawvideo','-pix_fmt','rgb24','-s','1080x1920','-r',str(fps),'-i','pipe:0','-i',str(audio),'-i',str(bed),'-filter_complex','[0:v]null[v];'+af,'-map','[v]','-map','[a]','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-t',str(dur),'-movflags','+faststart',str(output)]
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
final.update(full_decode='passed',edit_style='Seven distinct comic setups, literal Wi-Fi red flag, paper test receipts, animated magnifying glass, error reactions, false success gag, close-up punchline, actual spoken-word highlights and original music dropout',reference_inspiration=['https://www.youtube.com/shorts/mfCn1O1zZHI','https://www.youtube.com/shorts/-DzWkNHHvVw'],reference_footage_used=False)
output.with_suffix('.verification.json').write_text(json.dumps(final,indent=2),encoding='utf-8')
frame(.9).save(folder/'cover-frame.png')
print(json.dumps({'render':str(output),'duration':float(final['format']['duration']),'decode':'passed','original_motion_frames':math.ceil(dur*fps)}))
