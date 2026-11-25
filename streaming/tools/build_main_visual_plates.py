"""Original 16:9 edit plates. Diagrams are labeled; actual OBS captures retain provenance."""
import json,math
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont,ImageOps

F=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-1/W1-MAIN')
O=F/'edit-plates';O.mkdir(exist_ok=True)
W,H=1920,1080
C='#53e6ff';P='#b797ff';Y='#ffe45d';G='#88ffbc';R='#ff6f99';WHITE='#f3f6ff';DARK='#111a2c'
FONT='C:/Windows/Fonts/seguisb.ttf'
def font(s):return ImageFont.truetype(FONT,s)
def text(d,xy,s,size=42,color=WHITE,anchor=None):d.text(xy,s,font=font(size),fill=color,anchor=anchor)
def box(d,b,color=C,fill=DARK,r=24):d.rounded_rectangle(b,radius=r,fill=fill,outline=color,width=4)
def label(d,b,s,color=C,size=42):box(d,b,color);text(d,((b[0]+b[2])/2,(b[1]+b[3])/2),s,size,color,'mm')
def arrow(d,a,b,color=Y):
 d.line((a,b),fill=color,width=12);ang=math.atan2(b[1]-a[1],b[0]-a[0]);d.polygon([b,(b[0]-32*math.cos(ang-.5),b[1]-32*math.sin(ang-.5)),(b[0]-32*math.cos(ang+.5),b[1]-32*math.sin(ang+.5))],fill=color)
def monitor(d,b,title,color=C,content='PROJECT'):
 box(d,b,color,r=20);inner=(b[0]+18,b[1]+48,b[2]-18,b[3]-22);box(d,inner,color,'#07101e',12)
 text(d,((b[0]+b[2])/2,b[1]+25),title,28,color,'mm');text(d,((b[0]+b[2])/2,(b[1]+b[3])/2+12),content,48,color,'mm')
 cx=(b[0]+b[2])/2;d.rectangle((cx-18,b[3],cx+18,b[3]+28),fill=color);d.rounded_rectangle((cx-95,b[3]+24,cx+95,b[3]+40),radius=7,fill=color)
def mascot(d,cx,cy,emotion='happy'):
 box(d,(cx-95,cy-72,cx+95,cy+72),P,'#12172c',24)
 for x in [cx-37,cx+37]:d.ellipse((x-17,cy-21,x+17,cy+13),fill=C)
 if emotion=='shock':d.ellipse((cx-15,cy+27,cx+15,cy+53),fill=R)
 else:d.arc((cx-33,cy+10,cx+33,cy+54),0,180,fill=G,width=7)
 text(d,(cx,cy-53),'N',23,P,'mm')
def base(n,title,tag='ILLUSTRATED SETUP'):
 im=Image.new('RGB',(W,H),'#08111e');d=ImageDraw.Draw(im)
 for x in range(0,W,100):d.line((x,0,x,H),fill='#142133')
 for y in range(0,H,100):d.line((0,y,W,y),fill='#142133')
 d.rectangle((0,0,W,83),fill='#0c1525');text(d,(60,23),'FredoIndaWRX  /  CREATOR TOOLS',28,C);text(d,(W-60,26),tag,25,P,'ra')
 text(d,(65,123),f'{n:02d}',47,P);text(d,(175,118),title,57)
 d.line((60,206,1860,206),fill=C,width=3)
 d.rounded_rectangle((32,926,1888,1050),radius=20,fill='#060b13')
 return im,d
beats={
1:['OBS IS CAPTURING OBS','THIS IS A PREVIEW LOOP','TWO SCREENS. TWO JOBS.','CLOSE THE PORTAL'],
2:['THE STAGE','THE CONTROL ROOM','KEEP OBS OFF THE STAGE','A BORDER WILL NOT FIX IT'],
3:['OPEN SOURCE PROPERTIES','READ THE ACTUAL DISPLAY','USE A HARMLESS TEST WINDOW','THE PREVIEW IS THE ANSWER'],
4:['CHOOSE YOUR WORK SCREEN','OBS ON ONE → SHARE TWO','OBS ON TWO → SHARE ONE','CHECK BEFORE YOU SWITCH'],
5:['STILL A TUNNEL?','CHECK THE DISPLAY TARGET','IS THE SOURCE VISIBLE?','SCENE NAMES ARE ONLY LABELS'],
6:['DIFFERENT RESOLUTIONS','TRANSFORM → FIT TO SCREEN','FIT INSIDE YOUR CONTENT FRAME','KEEP THE ASPECT RATIO'],
7:['CHECK THE FOUR EDGES','CAN YOU READ THE CONTROLS?','DOES THE OVERLAY HIDE A BUTTON?','MAKE THE USEFUL PART BIGGER'],
8:['CLEAR THE SHARED SCREEN','PRIVATE CONTROLS STAY OFF STAGE','SWITCHING CHANGES THE SHOT','CHECK BEFORE YOU SHARE'],
9:['RECORD BEFORE GOING LIVE','SWITCH BOTH WORK SCREENS','PLAY THE ACTUAL RECORDING','CHECK THE SOUND TOO'],
10:['ACTUAL OBS RECORDING','STARTING SOON → BREAK','GRAPHICS ONLY IN THESE SCENES','TEST ACTIVE AUDIO SEPARATELY'],
11:['CHOOSE THE WORK SCREEN','KEEP OBS ON THE OTHER DISPLAY','CHECK THE FRAMING','TEST THE RECORDED FILE'],
12:['PICTURE SORTED? FIX THE AUDIO.','WHAT IS FIGHTING YOUR SETUP?','PRACTICAL BUILDS + NORI','NOW GO CLOSE THE PORTAL']}
plan=json.loads((F/'SHOT-PLAN.json').read_text(encoding='utf-8'))
manifest=[]
for s in plan['shots']:
 n=s['index']
 for j,beat in enumerate(beats[n]):
  actual=n in [3,5,10]
  im,d=base(n,beat,'ACTUAL OBS CAPTURE' if actual else 'ILLUSTRATED SETUP')
  if n==1:
   for k in range(7):
    x=190+k*85;y=280+k*44;ww=1050-k*126;hh=520-k*61
    if ww>130:box(d,(x,y,x+ww,y+hh),R if k<2 else P,'#07101e',15)
   text(d,(1100,350),'OBS',90,Y);text(d,(1100,450),'OBS',70,P);text(d,(1100,535),'OBS...',55,R)
   mascot(d,1550,530,'shock');label(d,(1230,710,1790,820),['PORTAL: OPEN','FAMILY TREE: TOO BIG','GIVE EACH SCREEN A JOB','PORTAL: CLOSED'][j],Y,31)
  elif n in [2,4,8,11]:
   share_two=not (n==4 and j==2)
   monitor(d,(140,320,890,720),'MONITOR 1',C if share_two else G,'OBS + NOTES' if share_two else 'PROJECT')
   monitor(d,(1030,320,1780,720),'MONITOR 2',G if share_two else C,'PROJECT' if share_two else 'OBS + NOTES')
   label(d,(440,790,1480,884),['STAGE + CONTROL ROOM','CONTROLS STAY ON THE OTHER SCREEN','PREVIEW BEFORE SWITCHING','TEST THE ACTUAL FILE'][j],Y,40)
   if n==4 and j==0:
    for k,title in enumerate(['Coding — Monitor 1','Coding — Monitor 2','Nori Demo — Monitor 1','Nori Demo — Monitor 2']):
     label(d,(260+(k%2)*790,385+(k//2)*100,865+(k%2)*790,467+(k//2)*100),title,C,30)
   if n==8:
    label(d,(240,390,800,490),'PRIVATE CONTROLS',P,35);label(d,(1110,510,1700,610),'HARMLESS TEST WINDOW',G,30)
  elif n in [3,5]:
   asset=F/'live-captures'/('monitor-two-properties.png' if j%2 else 'monitor-one-properties.png')
   capture=ImageOps.contain(Image.open(asset).convert('RGB'),(1110,610),Image.Resampling.LANCZOS);im.paste(capture,(95,263))
   label(d,(1260,315,1810,425),'READ THIS DISPLAY',Y,34)
   label(d,(1260,465,1810,575),'SOURCE → PROPERTIES',C,32)
   label(d,(1260,615,1810,725),'CONFIRM THE PREVIEW',G,31)
   text(d,(100,887),'Actual configured display selector • monitor numbers alone are not proof',27,P)
  elif n==6:
   box(d,(105,282,1100,826),C,'#080f1c');box(d,(180,345,1025,760),G,'#142238')
   d.ellipse((490,440,720,670),outline=Y,width=15)
   if j==3:
    d.ellipse((1310,425,1760,655),outline=R,width=15);text(d,(1535,729),'EGG = STRETCHED',38,R,'mm')
   else:
    label(d,(1200,335,1810,445),'3840 × 2160',C,45);label(d,(1200,505,1810,615),'2560 × 1440',P,45)
    text(d,(1495,734),'FIT. KEEP SHAPE.',41,Y,'mm')
   text(d,(600,856),'FIT INSIDE THE CONTENT FRAME',38,G,'mm')
  elif n==7:
   box(d,(190,278,1730,800),C,'#0d1625');box(d,(250,345,1670,740),G,'#13273c')
   for x,y,txt in [(960,296,'TOP'),(960,782,'BOTTOM'),(204,540,'L'),(1718,540,'R')]:text(d,(x,y),txt,30,Y,'mm')
   label(d,(575,465,1345,575),'READABLE APP CONTROLS',G,44)
   text(d,(960,858),'VIEWERS SHOULD NOT NEED A MICROSCOPE',39,Y,'mm')
  elif n==9:
   for k,txt in enumerate(['SHOW WORK SCREEN 1','SWITCH TO WORK SCREEN 2','VISIT BREAK','PLAY BACK + CHECK AUDIO']):
    label(d,(180,272+k*139,1595,380+k*139),txt,G if k<=j else C,44)
   mascot(d,1740,690)
  elif n==10:
   # Actual moving recording is inserted here by the final renderer.
   d.rectangle((160,260,1760,890),fill='#03070d')
   text(d,(960,570),'ACTUAL STARTING SOON → BREAK RECORDING',40,C,'mm')
  elif n==12:
   label(d,(220,292,1130,440),'MICROPHONE + DISCORD NEXT',C,44)
   for k,txt in enumerate(['CAPTURE?','FRAMING?','SOUND?']):label(d,(220+k*350,510,530+k*350,620),txt,P,38)
   label(d,(220,724,1150,842),'SUBSCRIBE FOR PRACTICAL BUILDS',Y,39);mascot(d,1550,550)
  name=f'plate-{n:02d}-{j+1:02d}.png';im.save(O/name)
  manifest.append({'shot':n,'beat':j+1,'title':beat,'asset':str((O/name).relative_to(F)).replace('\\','/'),'provenance':'Original labeled illustration with actual OBS footage insert' if n==10 else ('Actual cropped OBS settings capture with original explanatory callouts' if actual else 'Original diagram generated locally'),'caption_safe_area':[32,926,1888,1050]})
(O/'manifest.json').write_text(json.dumps(manifest,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
thumb=Image.new('RGB',(1280,720),'#091423');d=ImageDraw.Draw(thumb)
text(d,(55,48),'STOP THE',94,WHITE);text(d,(55,149),'OBS MIRROR',110,Y)
for k in range(5):box(d,(75+k*67,324+k*27,710-k*30,644-k*16),P,'#08111e',12)
mascot(d,1030,469,'shock');text(d,(878,640),'2 MONITORS',36,C)
thumb.save(F/'thumbnail.png')
end,d=base(12,'KEEP BUILDING. KEEP THE PORTAL CLOSED.','MORE PRACTICAL BUILDS + NORI')
box(d,(180,315,1120,843),C,'#07101b');text(d,(650,285),'WATCH NEXT: MIC + DISCORD',36,C,'mm')
d.ellipse((1400,380,1680,660),outline=P,width=6);text(d,(1540,727),'SUBSCRIBE',46,Y,'mm')
text(d,(650,880),'MORE HELP FOR YOUR SETUP',25,P,'mm');end.save(O/'end-screen.png')
contact=Image.new('RGB',(1920,810),'#000000')
for k,n in enumerate([1,2,3,4,6,7,8,9,10,11,12,5]):
 im=Image.open(O/f'plate-{n:02d}-02.png');im.thumbnail((480,270));contact.paste(im,((k%4)*480,(k//4)*270))
contact.save(O/'visual-contact.jpg',quality=92)
print(json.dumps({'original_edit_plates':len(manifest),'contact':str(O/'visual-contact.jpg'),'finished_video':False}))
