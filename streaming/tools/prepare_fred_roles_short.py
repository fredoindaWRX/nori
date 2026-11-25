import json,re,subprocess
from pathlib import Path
root=Path('C:/Nori/streaming');p=root/'channel-operator/02-Calendar/Week-3/W3-S2/Fred-MiniMax'
trans=json.loads((p/'narration-fred-original.transcript.json').read_text())
words=[w for s in trans['segments'] for w in s['words'] if w['word'].strip()!='uh']
trim=.30;duration=trans['duration']-trim
def timestamp(t):
 ms=round(max(0,t)*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
cues=[]
for i in range(0,len(words),5):
 group=words[i:i+5];text=' '.join(w['word'].strip() for w in group).replace('ai','AI').replace('nori','Nori')
 cues.append(f'{len(cues)+1}\n{timestamp(group[0]["start"]-trim)} --> {timestamp(group[-1]["end"]-trim)}\n{text}')
(p/'captions.srt').write_text('\n\n'.join(cues)+'\n',encoding='utf8')
def phrase_start(phrase):
 tokens=phrase.split();plain=[w['word'].strip().lower() for w in words]
 for i in range(len(plain)-len(tokens)+1):
  if plain[i:i+len(tokens)]==tokens:return max(0,words[i]['start']-trim)
 raise ValueError(phrase)
phrases=['12','one unfinished','this is','calling an','calling another','give one','watch the']
starts=[phrase_start(x) for x in phrases];starts[0]=0
titles=['12 JOB TITLES','ONE UNFINISHED TASK','GROUP PROJECT ENERGY','CODER NEEDS TOOLS','REVIEWER NEEDS PROOF','ONE JOB. SHOW THE RESULT.','WATCH THE FULL EPISODE']
shots=[dict(index=i+1,title=t,start_seconds=s,duration_seconds=(starts[i+1] if i<6 else duration)-s) for i,(s,t) in enumerate(zip(starts,titles))]
(p/'SHOT-PLAN.json').write_text(json.dumps({'video_id':'W3-S2','shots':shots,'illustration_only':True},indent=2))
(p/'publishing-package.json').write_text(json.dumps({'video_id':'W3-S2','title':'12 AI Job Titles. Who Actually Did the Work?','video_asset':'Nori-Twelve-Jobs-Fred-Final.mp4','related_video_id':'ntKcYA5jqtM','published':False},indent=2))
ff=json.loads((root/'tools/media-tools.json').read_text(encoding='utf-8-sig'))['ffmpeg']
subprocess.run([ff,'-v','error','-ss',str(trim),'-i',str(p/'narration-fred-original.wav'),'-af','loudnorm=I=-16:TP=-2:LRA=11','-ar','48000',str(p/'narration-fred-final.mp3')],check=True)
source=(root/'tools/build_comic_short.py').read_text(encoding='utf8').replace('topic=folder.name',"topic='W4-S1'")
source=source.replace("else:card(d,(180,1260,850,1390),'NEXT BUILD →',GREEN)","else:card(d,(180,1260,850,1390),'WATCH FULL EPISODE',GREEN)")
source=source.replace("elif index==5:sticker(im,'SHOW THE RECEIPT',(530,1445),GREEN)","elif index==5:sticker(im,'SHOW THE RESULT',(530,1445),GREEN)")
(root/'tools/build_fred_roles_short.py').write_text(source,encoding='utf8')
print(json.dumps({'prepared':str(p),'duration':duration,'starts':starts,'caption_cues':len(cues)}))
