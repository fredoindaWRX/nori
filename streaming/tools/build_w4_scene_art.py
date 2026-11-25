import json,math,shutil
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-4/W4-MAIN')
O=P/'clear-visuals';O.mkdir(exist_ok=True)
BG='#f1eee7';INK='#172128';TEAL='#167b79';RED='#b63d40';GOLD='#b9780a'
def font(n):return ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf',n)
def center(d,xy,t,n=65,color=INK):
    while d.textlength(t,font=font(n))>1720:n-=1
    d.text(xy,t,font=font(n),fill=color,anchor='mm')
def robot(d,x,y,scale=1,hat=False):
    w=220*scale;h=190*scale
    d.rounded_rectangle((x-w/2,y-h/2,x+w/2,y+h/2),radius=int(25*scale),fill=INK,outline=TEAL,width=max(2,int(5*scale)))
    for eye in [-45,45]:d.ellipse((x+(eye-14)*scale,y-30*scale,x+(eye+14)*scale,y-2*scale),fill=BG)
    d.arc((x-40*scale,y+5*scale,x+40*scale,y+58*scale),5,175,fill=BG,width=max(2,int(5*scale)))
    if hat:
        d.rounded_rectangle((x-85*scale,y-125*scale,x+85*scale,y-83*scale),radius=6,fill='white',outline=INK,width=3)
        for hx,hy in [(-65,-140),(0,-165),(65,-140)]:d.ellipse((x+(hx-45)*scale,y+(hy-45)*scale,x+(hx+45)*scale,y+(hy+45)*scale),fill='white',outline=INK,width=3)
def panel(d):d.rounded_rectangle((535,300,1840,865),radius=32,fill='white',outline='#d4d0c6',width=3)
def scene(title,body,kind='plain',tag='ILLUSTRATION'):
    im=Image.new('RGB',(1920,1080),BG);d=ImageDraw.Draw(im)
    d.rectangle((0,0,1920,85),fill=INK);d.text((60,24),'FredoIndaWRX / NORI',font=font(29),fill='white');d.text((1850,42),tag,font=font(25),fill='#f5d475',anchor='rm')
    center(d,(960,185),title,76);panel(d)
    if kind=='plain':
        for i,line in enumerate(body.split('|')):center(d,(1190,460+i*105),line,57,TEAL if i==0 else INK)
    elif kind=='managers':
        d.rounded_rectangle((750,650,1580,790),radius=20,fill=BG,outline=RED,width=4);center(d,(1165,720),'CHECKLIST: STILL EMPTY',40,RED)
        for x,name in zip([770,1040,1310,1580],['PLANNER','RESEARCH','CODER','REVIEW']):
            robot(d,x,465,.66);center(d,(x,580),name,25)
    elif kind=='chef':
        robot(d,955,580,1.2,hat=True)
        d.line((720,760,1690,760),fill=TEAL,width=12);center(d,(1460,530),'GREAT HAT.',45);center(d,(1460,615),'NO KITCHEN.',45,RED)
    elif kind=='package':
        d.rectangle((790,450,1110,740),fill='#c99962',outline=INK,width=5);d.polygon([(790,450),(950,360),(1270,360),(1110,450)],fill='#dbb382',outline=INK);d.polygon([(1110,450),(1270,360),(1270,650),(1110,740)],fill='#af7d4f',outline=INK)
        d.rectangle((860,525,1050,640),fill='white');center(d,(955,580),'TO: CODER',26)
        center(d,(1530,500),'ADDRESS WRITTEN',35,TEAL);center(d,(1530,615),'DELIVERED?',52,RED)
    elif kind=='handoff':
        robot(d,810,560,.8);robot(d,1575,560,.8)
        d.line((970,560,1380,560),fill=TEAL,width=12);d.polygon([(1380,560),(1330,525),(1330,595)],fill=TEAL)
        d.rectangle((1110,450,1250,635),fill='#c99962',outline=INK,width=4);center(d,(1180,680),'RECEIVED?',38,TEAL)
    elif kind=='pizza':
        d.polygon([(740,480),(1440,430),(1640,720),(900,780)],fill='#c99962',outline=INK)
        d.polygon([(745,475),(860,325),(1520,300),(1445,425)],fill='#dbb382',outline=INK)
        d.rectangle((940,475,1420,700),fill='white',outline=INK,width=3)
        center(d,(1180,520),'THE IMPORTANCE',30);center(d,(1180,570),'OF CHEESE',39,TEAL);center(d,(1600,795),'STILL HUNGRY.',31,RED)
    elif kind=='checklist':
        for i,t in enumerate(['File exists','Right location','Three requested items']):
            y=435+i*125;d.rounded_rectangle((700,y-30,770,y+40),radius=10,outline=TEAL,width=4);d.line((714,y+4,733,y+22,761,y-17),fill=TEAL,width=7);d.text((820,y-24),t,font=font(45),fill=INK)
    elif kind=='code':
        record=json.loads((P/'demonstration-evidence/SOURCE-CHECK.json').read_text())
        assert record['live_execution_verified'] is False
        for i,t in enumerate(['Missing gateway → error','Chat / task → gateway.submit','This branch is implemented.']):center(d,(1190,420+i*115),t,43,TEAL if i<2 else INK)
        center(d,(1190,795),'Live checklist result: not demonstrated',30,RED)
    elif kind=='four':
        for i,t in enumerate(['1  Assigned','2  Received','3  Created','4  Checked']):
            x=800+(i%2)*650;y=470+(i//2)*230;center(d,(x,y),t,49,TEAL)
    d.rounded_rectangle((35,945,1885,1060),radius=18,fill=INK)
    return im
entries=[
('Your AI team','WHO DID THE JOB?','','managers','ILLUSTRATION'),
('Because sometimes','YOUR TASK HAS MANAGEMENT','','managers','ORIGINAL REACTION'),
("Here's the question",'ONE SIMPLE REQUEST','Make a three-item checklist.','plain','ILLUSTRATION'),
('This checklist example','EXAMPLE, NOT A LIVE RESULT','Follow one pretend task.','plain','ILLUSTRATION'),
('First, somebody','GIVE SOMEBODY THE JOB','A role needs the right tools.','plain','EXPLANATION'),
("It's like handing",'CHEF HAT EQUIPPED','','chef','ORIGINAL ANALOGY'),
('Next, pick','PICKING A WORKER','Chosen ≠ delivered','plain','EXPLANATION'),
('Think about a package','ADDRESS ≠ DELIVERY','','package','ORIGINAL ANALOGY'),
('For our checklist','SHOW THE HANDOFF','','handoff','ILLUSTRATION'),
('Now comes','DO THE THING','Create the actual file.','plain','ILLUSTRATION'),
('The worker needs','RIGHT TOOL. RIGHT PLACE.','Can it write the file?','plain','EXPLANATION'),
('That would be like','PIZZA ORDER: ESSAY RECEIVED','','pizza','ORIGINAL REACTION'),
('So our example','OPEN THE RESULT','','checklist','EXAMPLE — NOT A NORI RESULT'),
('If the worker','SAY WHERE IT STOPPED','Tool unavailable?|Waiting?|Write failed?','plain','ILLUSTRATION'),
("Here's the real",'ONE NORI CODE PATH','','code','SOURCE CODE SUMMARY'),
('That tells us','CODE CONNECTION ≠ FINISHED JOB','One branch / not the whole system','plain','EXPLANATION'),
("We'll put the code",'LABEL THE EVIDENCE','Source check / illustration / live result','plain','EXPLANATION'),
('The next useful','SHOW THE REAL PATH','Request in. Result out.','plain','NEXT TEST'),
("Here's the checklist",'ONE JOB. FOUR CHECKS.','','four','EXPLANATION'),
("That's the whole",'ARROWS ARE NOT THE RECEIPT','The result is.','plain','EXPLANATION'),
('Once one worker','ONE WORKING PATH FIRST','Then add more workers.','plain','BUILD APPROACH'),
('For Nori','SHOW WHAT HAPPENED','Keep the useful failures in.','plain','BUILD APPROACH')]
manifest=[]
for i,(phrase,title,body,kind,tag) in enumerate(entries,1):
    p=O/f'scene-{i:02d}.png';scene(title,body,kind,tag).save(p)
    manifest.append(dict(index=i,timing_phrase=phrase,title=title,kind=kind,tag=tag,asset=str(p)))
end=scene('WHAT SHOULD NORI PROVE NEXT?','','plain','WATCH NEXT');d=ImageDraw.Draw(end);d.rectangle((560,320,1830,865),fill=BG);d.rounded_rectangle((660,330,1550,820),radius=24,outline=TEAL,width=7);d.ellipse((215,460,455,700),outline=TEAL,width=8);center(d,(335,580),'N',120,TEAL);center(d,(1105,880),'WATCH THE READINESS EPISODE',32)
end.save(O/'end-screen.png')
source=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-3/W3-MAIN/clear-visuals/robot')
shutil.copytree(source,O/'robot',dirs_exist_ok=True)
(P/'SCENE-ART-MANIFEST.json').write_text(json.dumps(dict(scenes=manifest,end_screen=str(O/'end-screen.png'),original_animation_frames=32,narration_timing_assigned=False,final_mp4_complete=False),indent=2),encoding='utf-8')
thumb=Image.new('RGB',(1280,720),BG);d=ImageDraw.Draw(thumb);d.rectangle((0,0,1280,75),fill=INK);d.text((45,20),'BUILDING NORI',font=font(30),fill='white');robot(d,960,385,1.4);d.text((60,190),'AI SAYS',font=font(100),fill=INK);d.text((60,315),'“DONE.”',font=font(125),fill=TEAL);d.text((60,530),'WHERE’S THE FILE?',font=font(58),fill=RED);thumb.save(P/'thumbnail.png')
contact=Image.new('RGB',(960,math.ceil(len(manifest)/3)*195),BG)
for i,s in enumerate(manifest):
    tile=Image.open(s['asset']).resize((320,180));contact.paste(tile,((i%3)*320,(i//3)*195));ImageDraw.Draw(contact).text(((i%3)*320+8,(i//3)*195+180),str(i+1),fill=INK)
contact.save(O/'layout-contact.jpg')
print(json.dumps(dict(scene_art=len(manifest),animated_mascot_frames=32,thumbnail=str(P/'thumbnail.png'),contact=str(O/'layout-contact.jpg'),final_mp4_complete=False)))
