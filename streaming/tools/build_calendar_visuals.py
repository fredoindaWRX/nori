"""Create the complete scene-art and shot registry for all twelve planned videos."""
import hashlib
import json
from pathlib import Path
import re

from PIL import Image, ImageDraw, ImageFont
import render_brand_kit as brand

OPS=Path('C:/Nori/streaming/channel-operator')
HOOKS={
 'W1-MAIN':'OBS repeating itself? Capture your other screen.',
 'W1-S1':'OBS inside OBS? Capture the other screen.',
 'W1-S2':'Your Break scene should stop your microphone and guests.',
 'W2-MAIN':'Your microphone and Discord need separate volume controls.',
 'W2-S1':"One loud guest shouldn't control your microphone.",
 'W2-S2':"A moving meter doesn't prove your recording sounds right.",
 'W3-MAIN':'An AI service can be alive and unable to answer.',
 'W3-S1':'A listening service can still have a missing model.',
 'W3-S2':"Twelve workers don't mean twelve models in GPU memory.",
 'W4-MAIN':"An agent diagram doesn't prove a working system.",
 'W4-S1':"Routing a task doesn't mean executing it.",
 'W4-S2':'Choose one task. Define exactly what passing looks like.',
}
LABELS={
 'W1-MAIN':['STOP THE MIRROR','WHY IT REPEATS','GIVE EACH SCREEN A JOB','IDENTIFY THE DISPLAY','SELECT YOUR WORK SCREEN','MOVE OBS OFF CAPTURE','FIT THE FRAME','CHECK ALL FOUR EDGES','CLEAR WHAT YOU SHARE','REHEARSE THE SWITCH','KEEP THE JOBS SEPARATE','WHAT SHOULD WE BUILD NEXT?'],
 'W2-MAIN':['SEPARATE YOUR AUDIO','CONTROL EACH VOICE','NAME THE SOURCES','SELECT YOUR MICROPHONE','CHECK SONAR PROCESSING','TARGET DISCORD','TEST ONE VOICE AT A TIME','AVOID DOUBLE CAPTURE','CHECK RECORDING TRACKS','RECORD A REAL EXCHANGE','LISTEN AND ADJUST','PROVE THE FINAL MIX','WHAT SHOULD WE BUILD NEXT?'],
 'W3-MAIN':["ALIVE ISN'T READY",'A PROCESS IS ONE CHECK','ASK TWO QUESTIONS','CHECK THE LISTENER','CHECK TASK DEPENDENCIES','READ THE ACTUAL CODE','SHOW THE MISSING MODEL','CHECK THE HEALTHY PATH','TEST BOTH CONDITIONS','ACT ON THE HEALTH RESULT','TRACE THE REAL GATE','START WITH ONE TASK','WHAT SHOULD WE BUILD NEXT?'],
 'W4-MAIN':['SHOW THE REAL PATH','ARROWS NEED EVIDENCE','ROLE / ROUTE / RUN / CHECK','A ROLE IS A DESCRIPTION','ROUTING CHOOSES A RECIPIENT','DELIVERY IS A SEPARATE STEP','EXECUTION NEEDS TOOLS','CHECK THE ACTUAL OUTPUT','A CONNECTION IN NORI CODE','TEST ONE COMPLETE PATH','ADD WORKERS AFTER PROOF','SHOW THE GAP AND THE RESULT','WHAT SHOULD WE BUILD NEXT?'],
 'W1-S2':['TAKE A REAL BREAK','A GRAPHIC IS NOT A MUTE','CHECK THE SOURCES','RECORD THE SCENE SWITCH','LISTEN TO THE RESULT','REHEARSE BEFORE LIVE','SEE THE WALKTHROUGH'],
 'W2-S1':['TWO SOURCES','MIC AND GUESTS','TEST THE HOST','TEST THE GUEST','CONTROL THE LEVELS','CHECK DUPLICATES','SEE THE WALKTHROUGH'],
 'W2-S2':['LISTEN BACK','THE FILE NEEDS THE TRACK','RECORD THREE SECTIONS','USE HEADPHONES','FIND THE AUDIO PROBLEM','CHECK SEPARATE TRACKS','THE FILE IS THE TEST','SEE THE WALKTHROUGH'],
 'W3-S1':['ALIVE AND READY','LIVENESS','READINESS',"NORI'S HEALTH BOUNDARY",'DEGRADED IS A REAL STATE','CHECK THE TASK CONDITIONS','VERIFY THE OUTPUT','SEE THE WALKTHROUGH'],
 'W3-S2':['WORKERS ARE NOT MODELS','A WORKER HAS A ROLE','INFERENCE IS SEPARATE','SHARE MODEL CAPACITY','COUNT REQUESTS AND MEMORY','MEASURE THE REAL PATH','SEE THE WALKTHROUGH'],
 'W4-S1':['ROUTING IS NOT EXECUTION','NAMING IS NOT DELIVERY','ACCEPTED IS NOT FINISHED','TRACE THE FIVE STEPS','SHOW WHERE IT STOPS','MATCH ARROWS TO CONNECTIONS','SEE THE WALKTHROUGH'],
 'W4-S2':['ONE REAL TEST','DEFINE THE OUTPUT','RECORD THE WHOLE PATH','TEST ONE FAILURE','CONFIDENCE IS NOT A TEST','EVIDENCE IS','START WITH A SMALL PATH','SEE THE WALKTHROUGH'],
}


def update_scripts():
    for id,hook in HOOKS.items():
        folder=OPS/'02-Calendar'/f'Week-{id[1]}'/id
        path=folder/'narration.txt'
        text=path.read_text(encoding='utf-8-sig').strip()
        if id.endswith('MAIN'):
            paragraphs=re.split(r'\n\s*\n',text)
            paragraphs[0]=hook
            if id=='W3-MAIN':
                paragraphs[5]="Nori's current local worker code makes the boundary concrete. Its live endpoint reports whether the worker listener responds. Its health endpoint reports model readiness and returns a ready or degraded state. The ordinary path checks whether the assigned model is available; the native inference path asks its provider for readiness. This is evidence from the current code, not a claim that every integration has passed a live test."
            if id=='W4-MAIN':
                paragraphs[8]="I traced a specific connection in Nori's current worker request handler. Both chat and task requests pass through the council gateway's submit method. The handler refuses the request if that gateway is missing. That shows a connection implemented in this code path. It still does not prove that every model, permission, or tool needed for a real task is ready. I need to test the actual action and inspect its output."
            text='\n\n'.join(paragraphs)
        else:
            # Preserve all content after the old first sentence.
            if not text.startswith(hook):
                text=re.sub(r'^.*?[.!?]\s+',hook+' ',text,count=1)
        path.write_text(text+'\n',encoding='utf-8')
        package=folder/'production-package.txt'
        copy=package.read_text(encoding='utf-8-sig')
        old=re.search(r'^FIRST FIVE SECONDS: (.+)$',copy,re.M).group(1)
        copy=copy.replace('FIRST FIVE SECONDS: '+old,'FIRST FIVE SECONDS: '+hook)
        copy=copy.replace('DESCRIPTION COPY:\n'+old,'DESCRIPTION COPY:\n'+hook)
        package.write_text(copy,encoding='utf-8')


def text_lines(draw,text,xy,size,width,color):
    x,y=xy
    for line in brand.wrap(draw,text,size,width):
        draw.text((x,y),line,font=brand.font(size),fill=color)
        y+=size*1.18
    return y


def scene_art(id,title,copy,index):
    short=not id.endswith('MAIN')
    w,h=(1080,1920) if short else (1920,1080)
    im=brand.background(w,h)
    d=ImageDraw.Draw(im)
    pillar='BUILDING NORI' if id.startswith(('W3','W4')) else 'CREATOR SYSTEMS'
    d.text((80,130 if short else 88),'FredoIndaWRX  /  '+pillar,font=brand.font(28),fill=brand.CYAN)
    d.text((80,240 if short else 178),f'{index:02d}',font=brand.font(54),fill=brand.PURPLE)
    yy=350 if short else 280
    size=78 if short else 72
    title_end=text_lines(d,title,(80,yy),size,890 if short else 940,brand.WHITE)
    assert title_end < (710 if short else 550), (id,index,'title exceeds layout')
    if short:
        brand.diagram_topic(im,(100,760,770,440),id)
        if copy and len(brand.wrap(d,copy,36,870))<=3:
            copy_end=text_lines(ImageDraw.Draw(im),copy,(80,1295),36,870,brand.WHITE)
            assert copy_end < 1450, (id,index,'copy exceeds caption-safe area')
        ImageDraw.Draw(im).text((80,1740),'BUILD / TEST / EXPLAIN',font=brand.font(27),fill=brand.CYAN)
    else:
        if copy:
            copy_end=text_lines(d,copy,(85,570),35,900,brand.WHITE)
            assert copy_end < 850, (id,index,'copy exceeds layout')
        brand.diagram_topic(im,(1170,290,600,430),id)
        d=ImageDraw.Draw(im)
        d.text((1170,778),'ONE DECISION. ONE VISIBLE RESULT.',font=brand.font(25),fill=brand.CYAN)
    folder=OPS/'02-Calendar'/f'Week-{id[1]}'/id/'visuals'
    folder.mkdir(parents=True,exist_ok=True)
    path=folder/f'scene-{index:02d}.png'
    im.convert('RGB').save(path)
    return path


def main():
    update_scripts()
    registry=[]
    for id in HOOKS:
        folder=OPS/'02-Calendar'/f'Week-{id[1]}'/id
        text=(folder/'narration.txt').read_text(encoding='utf-8').strip()
        if id=='W1-S1':
            sentences=re.split(r'(?<=[.!?])\s+',text)
            # The new hook has two sentences; include both in the first visual.
            groups=[sentences[:3],sentences[3:5],sentences[5:6],sentences[6:8],sentences[8:]]
            shots=[{'index':i,'title':title,'voice_text':' '.join(words),'asset':f'visuals/scene-{i:02d}.png','asset_role':'Explanatory illustration; not an application capture'} for i,(title,words) in enumerate(zip(['OBS IN OBS?','SPLIT THE SCREENS','CHECK THE DISPLAY','RECORD. WATCH. CHECK.','BUILD THE NEXT THING'],groups),start=1)]
            assert ' '.join(' '.join(s['voice_text'] for s in shots).split())==' '.join(text.split())
        else:
            pieces=re.split(r'\n\s*\n',text) if id.endswith('MAIN') else re.split(r'(?<=[.!?])\s+',text)
            labels=LABELS[id]
            # W4-S2's deliberately two-sentence hook stays in one opening shot.
            if id=='W4-S2': pieces=[' '.join(pieces[:2])]+pieces[2:]
            shots=[]
            for index,piece in enumerate(pieces,start=1):
                title=labels[min(index-1,len(labels)-1)]
                first=re.split(r'(?<=[.!?])\s+',piece)[0]
                if first==HOOKS[id]: first=''
                if len(first)>180: first=''
                path=scene_art(id,title,first,index)
                shots.append({'index':index,'title':title,'voice_text':piece,'asset':str(path.relative_to(folder)).replace('\\','/'),'asset_role':'Explanatory illustration; not a live test or application capture'})
        for shot in shots:
            image=Image.open(folder/shot['asset'])
            assert image.size==((1920,1080) if id.endswith('MAIN') else (1080,1920))
        plan={'video_id':id,'voice_provider':'Fish Audio','model_id':'b27ff51a95a14d02973baec32ba7a643','script_sha256':hashlib.sha256(text.encode()).hexdigest(),'shots':shots,'timing_status':'Assign durations from actual generated speech; no estimated timing is presented as final.','required_remaining_inputs':['User voice narration generated in Fish Audio','Actual word-aligned captions','Relevant live demonstration footage and configured avatar for the originally requested presenter format','Full watching/listening and applicable publishing rights'],'status':'Scene art and shot plan complete; final episode not rendered.'}
        (folder/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2),encoding='utf-8')
        registry.append({'video_id':id,'shots':len(shots),'scene_assets_checked':True,'hook_words':len(HOOKS[id].split())})
    out=OPS/'03-Production'
    (out/'SCENE-ASSET-REGISTER.json').write_text(json.dumps(registry,indent=2),encoding='utf-8')
    (out/'SCRIPT-SOURCE-REVIEW.txt').write_text("Review date: 2026-09-30. Nori README and STARTUP are behind the current worker request-handler code on gateway integration. W3-MAIN now describes the live/health boundary in current main.py; W4-MAIN now describes the implemented gateway.submit connection without claiming a successful live task. Source reviewed: C:/Nori/nori/main.py, model_ready, Worker.chat and handler.do_GET/do_POST. Exact output and end-to-end capability claims still require recorded task evidence. All twelve opening hooks are ten words or fewer. Delivery must be measured before the five-second opening is accepted.\n",encoding='utf-8')
    print(json.dumps({'videos':len(registry),'scene_assets':sum(v['shots'] for v in registry),'maximum_hook_words':max(v['hook_words'] for v in registry)}))


if __name__=='__main__': main()
