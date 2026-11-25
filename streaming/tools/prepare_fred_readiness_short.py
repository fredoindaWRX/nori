import json, subprocess
from pathlib import Path

root=Path('C:/Nori/streaming')
p=root/'channel-operator/02-Calendar/Week-3/W3-S1/Fred-MiniMax'
record=json.loads((p/'GENERATION-RECORD.json').read_text())
trans=json.loads((p/'narration-fred-original.transcript.json').read_text())
words=[w for s in trans['segments'] for w in s['words']]
def timestamp(t):
    ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
cues=[]
for i in range(0,len(words),5):
    group=words[i:i+5]
    text=' '.join(w['word'].strip() for w in group).replace('nori','Nori')
    cues.append(f'{len(cues)+1}\n{timestamp(group[0]["start"])} --> {timestamp(group[-1]["end"])}\n{text}')
(p/'captions.srt').write_text('\n\n'.join(cues)+'\n',encoding='utf8')
starts=[0,2.32,5.98,8.76,12.5,16.34,21.18]
titles=['READY?','NOBODY HOME','APP IS AWAKE','CAN IT ANSWER?','LIGHTS ON. DINNER?','CHECK THE ANSWER','WATCH THE FULL CHECK']
duration=record['duration_seconds']
shots=[dict(index=i+1,title=t,start_seconds=s,duration_seconds=(starts[i+1] if i<6 else duration)-s) for i,(s,t) in enumerate(zip(starts,titles))]
(p/'SHOT-PLAN.json').write_text(json.dumps({'video_id':'W3-S1','shots':shots,'illustration_only':True},indent=2))
(p/'publishing-package.json').write_text(json.dumps({'video_id':'W3-S1','title':'Your AI Is Awake. Can It Actually Answer?','video_asset':'Nori-Ready-Fred-Revision.mp4','caption_asset':'captions.srt','related_video_id':'34dGUmC_4U0','voice':'MiniMax Fred','published':False},indent=2))
ff=json.loads((root/'tools/media-tools.json').read_text(encoding='utf-8-sig'))['ffmpeg']
subprocess.run([ff,'-v','error','-i',str(p/'narration-fred-original.wav'),'-af','loudnorm=I=-16:TP=-2:LRA=11','-ar','48000',str(p/'narration-fred-final.mp3')],check=True)
source=(root/'tools/build_comic_short.py').read_text()
source=source.replace("topic=folder.name","topic='W3-S1'")
source=source.replace("if index==0 and topic=='W3-S1':opening='GREEN LIGHT' if seconds<hook_starts[1] else ('NO BRAIN' if seconds<hook_starts[2] else 'EXCELLENT TEAMWORK')","if index==0 and topic=='W3-S1':opening='READY?'")
source=source.replace("'MODEL: 404' if index==1 or local>.6 else 'STATUS: GREEN'","'NO ANSWER?' if index==1 else 'STATUS: GREEN'")
source=source.replace("'MODEL + DEPENDENCIES + REQUEST?'","'MODEL AVAILABLE? ANSWER RIGHT?'")
source=source.replace("'OPEN ≠ CHEF'","'LIGHTS ≠ DINNER'")
(root/'tools/build_fred_readiness_short.py').write_text(source,encoding='utf8')
print(json.dumps({'prepared':str(p),'cues':len(cues),'shots':len(shots),'duration':duration}))
