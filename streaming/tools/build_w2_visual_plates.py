"""Original, caption-safe visual assets for the complete microphone episode."""
import json,math
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageOps
P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-2/W2-MAIN')
O=P/'edit-plates';O.mkdir(exist_ok=True)
W,H=1920,1080; C='#53e6ff';V='#b797ff';Y='#ffe45d';G='#88ffbc';R='#ff6f99';WHITE='#f3f6ff'
def font(n):return ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf',n)
def text(d,x,y,s,size=40,color=WHITE,anchor=None):d.text((x,y),s,font=font(size),fill=color,anchor=anchor)
def box(d,b,color=C):d.rounded_rectangle(b,radius=24,fill='#111a2c',outline=color,width=5)
def label(d,b,s,color=C,size=40):
 box(d,b,color)
 while d.textlength(s,font=font(size))>b[2]-b[0]-36:size-=1
 text(d,(b[0]+b[2])/2,(b[1]+b[3])/2,s,size,color,'mm')
def arrow(d,x1,y1,x2,y2,color=Y):
 d.line((x1,y1,x2,y2),fill=color,width=10);a=math.atan2(y2-y1,x2-x1)
 d.polygon([(x2,y2),(x2-32*math.cos(a-.5),y2-32*math.sin(a-.5)),(x2-32*math.cos(a+.5),y2-32*math.sin(a+.5))],fill=color)
def base(n,title,tag='ILLUSTRATED ROUTING'):
 im=Image.new('RGB',(W,H),'#08111e');d=ImageDraw.Draw(im)
 for x in range(0,W,100):d.line((x,0,x,H),fill='#142133')
 for y in range(0,H,100):d.line((0,y,W,y),fill='#142133')
 d.rectangle((0,0,W,83),fill='#0c1525');text(d,60,23,'FredoIndaWRX  /  CREATOR TOOLS',28,C);text(d,1860,26,tag,25,V,'ra')
 text(d,65,123,f'{n:02}',47,V)
 size=57
 while d.textlength(title,font=font(size))>1680:size-=1
 text(d,175,118,title,size);d.line((60,206,1860,206),fill=C,width=3)
 d.rounded_rectangle((32,926,1888,1050),radius=20,fill='#060b13')
 return im,d
beats={
1:['ONE LOUD FRIEND','GIVE EACH VOICE A CONTROL','TURN THE GUEST DOWN','KEEP YOUR VOICE STEADY'],
2:['CLEAR HOST + CLEAR GUESTS','ONE MIX = GROUP DECISION','SEPARATE THE JOBS','THE FILE GETS THE FINAL VOTE'],
3:['THE CONFIGURATION ON THIS PC','MIC: STEELSERIES SONAR','GUESTS: DISCORD','BOTH MUTED; LIVE TEST STILL NEEDED'],
4:['SELECT THE ACTUAL DEVICE','SPEAK FROM YOUR NORMAL POSITION','CHECK THE CORRECT METER','RED IS NOT A QUALITY BADGE'],
5:['CHECK PROCESSING BEFORE OBS','START WITH A NATURAL VOICE','COMPARE A SHORT RECORDING','MORE FILTERS ≠ MORE CLARITY'],
6:['TARGET THE DISCORD APP','CHECK THE TARGET FIRST','USE HEADPHONES','ONE GUEST. ZERO HAUNTED ECHOES.'],
7:['GUEST TALKS; HOST STAYS QUIET','HOST TALKS; GUEST STAYS QUIET','TEST EACH VOLUME CONTROL','TEST EACH MUTE'],
8:['CHECK FOR DOUBLE CAPTURE','APP AUDIO + DESKTOP AUDIO?','THIS COLLECTION: NO DEFAULT DESKTOP','INSPECT SOURCES INSIDE SCENES'],
9:['SEPARATE CONTROLS ≠ SEPARATE TRACKS','SOURCE ASSIGNMENTS: 1+2 AND 1+3','THIS PROFILE RECORDS TRACK 1','CHECK BOTH ENDS'],
10:['PLAN YOUR RECORDING TRACKS','TRACK 1: SHARED MIX','TRACK 2: MIC / TRACK 3: GUESTS','VERIFY THE ACTUAL FILE'],
11:['RECORD HOST, THEN GUEST','TRY MUTES + BREAK + RETURN','PLAY THE FILE WITH HEADPHONES','ONE CHANGE. THEN REPEAT.'],
12:['CLEAR CONTROLS + REAL EVIDENCE','KEEP MUSIC UNDER THE VOICES','NEXT: NORI READINESS CHECKS','MORE PROJECTS. FEWER MYSTERIES.']}
manifest=[]
for n in range(1,13):
 for j,title in enumerate(beats[n]):
  actual=n==9 and j==2
  im,d=base(n,title,'ACTUAL OBS SETTINGS' if actual else 'ILLUSTRATED ROUTING')
  if actual:
   shot=Image.open(P/'live-captures/obs-recording-track-one.png').convert('RGB')
   shot=ImageOps.contain(shot,(1090,665),Image.Resampling.LANCZOS);im.paste(shot,(80,239))
   label(d,(1240,300,1810,410),'OUTPUT MODE: SIMPLE',Y,39)
   label(d,(1240,470,1810,580),'RECORDING: TRACK 1',R,39)
   label(d,(1240,640,1810,750),'EXTRA TRACKS NOT SAVED',V,34)
  elif n in [9,10]:
   label(d,(110,285,600,405),'MIC',C,52);label(d,(110,485,600,605),'GUESTS',V,52)
   for k,name in enumerate(['1  SHARED MIX','2  MICROPHONE','3  GUESTS']):label(d,(1060,260+k*190,1790,390+k*190),name,[Y,C,V][k],44)
   arrow(d,620,345,1040,325,C);arrow(d,620,345,1040,515,C)
   arrow(d,620,545,1040,325,V);arrow(d,620,545,1040,705,V)
   label(d,(180,795,1740,890),'CURRENT OUTPUT: TRACK 1 ONLY' if n==9 else 'INTENDED ROUTING — TEST AFTER SELECTING OUTPUT TRACKS',R if n==9 else G,37)
  elif n==5:
   for k,name in enumerate(['MICROPHONE','SONAR','OBS','SAVED FILE']):
    label(d,(90+k*455,360,480+k*455,520),name,[C,V,Y,G][k],38)
    if k<3:arrow(d,490+k*455,440,530+k*455,440)
   label(d,(260,660,1660,805),['LISTEN BEFORE ADDING FILTERS','SMALL CHANGES, NATURAL SOUND','COMPARE THE RECORDINGS','DO NOT COOK THE CONSONANTS'][j],Y,44)
  elif n==8:
   label(d,(100,300,640,440),'DISCORD',V,55)
   label(d,(860,270,1710,410),'APPLICATION CAPTURE',C,45)
   label(d,(860,500,1710,640),'DESKTOP CAPTURE?',R,45)
   arrow(d,660,370,840,340,C);arrow(d,660,370,840,565,R)
   label(d,(240,735,1680,865),'CHECK WHETHER BOTH ROUTES CARRY THE SAME SOUND',Y,36)
  elif n in [11,12]:
   labels=(['HOST ALONE','GUEST ALONE','BOTH VOICES','PLAY IT BACK'] if n==11 else ['CLEAR CONTROLS','LISTEN TO THE FILE','NORI: NEXT BUILD','MONITORS: WATCH NEXT'])
   for k,name in enumerate(labels):label(d,(180+(k%2)*830,285+(k//2)*230,910+(k%2)*830,465+(k//2)*230),name,[C,V,Y,G][k],43)
   label(d,(340,805,1580,895),'THE RECORDING IS THE WITNESS' if n==11 else 'FredoIndaWRX  /  PROJECTS + NORI',Y,39)
  else:
   mic='STEELSERIES SONAR' if n in [3,4] else 'MICROPHONE'
   label(d,(160,300,860,445),mic,C,47);label(d,(1060,300,1760,445),'DISCORD GUESTS',V,47)
   for k,col in enumerate([C,V]):
    x=170+k*900
    box(d,(x,490,x+680,625),col)
    level=(0.32 if k==1 and n==1 and j==2 else 0.58)
    if n==3:level=0
    if n==7 and ((j==0 and k==0) or (j==1 and k==1)):level=0
    if n==7 and j==3 and k==0:level=0
    d.rounded_rectangle((x+25,530,x+25+int(620*level),580),radius=10,fill=col)
    text(d,x+340,672,'MUTED' if n==3 and j==3 else ('OWN CONTROL' if n not in [6,7] else ('HOST TEST' if k==0 else 'GUEST TEST')),37,col,'mm')
   label(d,(250,785,1670,888),['CONTROL EACH VOICE','SOURCE → PROPERTIES','CHECK WITH A SHORT RECORDING','LISTEN BEFORE GOING LIVE'][j],Y,40)
  target=O/f'scene-{n:02}-beat-{j+1:02}.png'; im.save(target)
  manifest.append({'scene':n,'beat':j+1,'title':title,'path':str(target),'provenance':'Actual OBS output screenshot' if actual else 'Original illustrated routing'})
memes=[('one-guy','A VOLUME KNOB','FOR THAT ONE GUY'),('microwave','FILTER STACK: 9000','VOICE: MICROWAVE'),('haunted-echo','ONE GUEST','TWO HAUNTINGS'),('three-plates','THREE PLATES','ONE DINNER')]
for stem,a,b in memes:
 im,d=base(0,a,'ORIGINAL REACTION CARD');label(d,(170,320,1750,550),b,Y,110)
 def robot(cx,cy,col,shout=False,ghost=False):
  box(d,(cx-120,cy-88,cx+120,cy+88),col)
  for x in [cx-50,cx+50]:d.ellipse((x-16,cy-29,x+16,cy+3),fill=WHITE)
  if shout:d.ellipse((cx-36,cy+20,cx+36,cy+63),fill=R)
  else:d.line((cx-38,cy+41,cx+38,cy+41),fill=G,width=9)
  d.line((cx,cy-90,cx,cy-135),fill=col,width=8);d.ellipse((cx-12,cy-151,cx+12,cy-127),fill=col)
  text(d,cx,cy-61,'N',24,col,'mm')
  if ghost:
   d.arc((cx-147,cy-119,cx+147,cy+105),180,360,fill=col,width=12)
   d.rectangle((cx-151,cy-9,cx-127,cy+53),fill=col);d.rectangle((cx+127,cy-9,cx+151,cy+53),fill=col)
 if stem=='one-guy':
  robot(580,745,V,True);robot(1350,745,C)
  for k in range(3):d.arc((745,640-k*25,900+k*55,835+k*25),280,80,fill=R,width=10)
  d.ellipse((1020,670,1200,850),outline=Y,width=12);d.line((1110,760,1060,800),fill=Y,width=13)
  text(d,1110,878,'TURN DOWN',31,Y,'mm')
 elif stem=='microwave':
  box(d,(890,625,1580,870),V);box(d,(925,665,1400,830),R)
  robot(600,750,C,True);text(d,1155,747,'VOICE.wav',55,R,'mm')
  for k in range(3):d.ellipse((1460,662+k*63,1500,702+k*63),fill=Y)
  text(d,1240,895,'PLEASE DO NOT REHEAT THE HOST',30,Y,'mm')
 elif stem=='haunted-echo':
  robot(560,750,C,True,True);robot(1300,750,V,True,True)
  for x in [1430,1470,1510]:d.line((x,645,x+45,825),fill=V,width=7)
  text(d,560,883,'ACTUAL GUEST',30,C,'mm');text(d,1320,883,'UNINVITED ECHO',30,V,'mm')
 elif stem=='three-plates':
  for k,col in enumerate([C,V,Y]):
   x=440+k*510;d.ellipse((x-130,650,x+130,845),outline=col,width=13)
   if k==0:
    d.ellipse((x-70,690,x+70,805),fill=G);text(d,x,747,'MIX',40,'#08111e','mm')
   else:text(d,x,747,'EMPTY',38,col,'mm')
   text(d,x,888,f'TRACK {k+1}',31,col,'mm')
 im.save(O/f'meme-{stem}.png')
end,d=base(12,'KEEP BUILDING','WATCH NEXT');box(d,(180,315,1120,843),C);d.ellipse((1400,380,1680,660),outline=V,width=6)
text(d,650,875,'DUAL-MONITOR OBS SETUP',34,C,'mm');text(d,1540,720,'SUBSCRIBE',34,V,'mm');end.save(O/'end-screen.png')
thumb=Image.new('RGB',(1280,720),'#08111e');d=ImageDraw.Draw(thumb)
text(d,65,40,'FredoIndaWRX / CREATOR TOOLS',26,C);text(d,65,115,'TURN THAT',105);text(d,65,225,'GUY DOWN',110,Y)
label(d,(70,410,610,585),'MIC',C,70);label(d,(680,410,1220,585),'DISCORD',V,65)
text(d,640,650,'TWO VOICES. TWO CONTROLS.',43,WHITE,'mm');thumb.save(P/'thumbnail.png')
contact=Image.new('RGB',(1920,1080),'#08111e')
for i,n in enumerate(range(1,13)):
 plate=Image.open(O/f'scene-{n:02}-beat-01.png');contact.paste(plate.resize((480,270)),((i%4)*480,(i//4)*270))
contact.save(O/'visual-contact.jpg',quality=90)
(O/'manifest.json').write_text(json.dumps({'beats':manifest,'original_memes':[x[0] for x in memes],
 'cutaway_sources':['W2-S1/Separate-Mic-Discord-Fredo.mp4','W2-S2/Test-The-Recording-Fredo.mp4'],
 'status':'Assets generated; visual inspection pending'},indent=2),encoding='utf-8')
print(json.dumps({'plates':len(manifest),'memes':len(memes),'thumbnail':str(P/'thumbnail.png'),'contact':str(O/'visual-contact.jpg')}))
