import json,re,difflib,csv
from pathlib import Path
R=Path('C:/Nori/streaming/channel-operator');F=R/'02-Calendar/Week-3/W3-MAIN'
plan=json.loads((F/'SHOT-PLAN.json').read_text(encoding='utf-8'));transcript=json.loads((F/'narration-ethan.transcript.json').read_text(encoding='utf-8'))
def tokens(text):return re.findall(r"[a-z0-9']+",text.lower())
def norm(t):return 'twelve' if t=='12' else t
expected=[norm(t) for t in tokens((F/'narration.txt').read_text(encoding='utf-8'))]
heard=[]
for segment in transcript['segments']:
 for word in segment['words']:
  heard.extend({'token':norm(t),'start':word['start'],'end':word['end'],'original':word['word']} for t in tokens(word['word']))
matcher=difflib.SequenceMatcher(None,expected,[w['token'] for w in heard],autojunk=False)
mapping={};flags=[]
for tag,a,b,c,d in matcher.get_opcodes():
 if tag=='equal':mapping.update({i:c+i-a for i in range(a,b)})
 else:flags.append({'kind':tag,'script':' '.join(expected[a:b]),'recognized':' '.join(w['token'] for w in heard[c:d]),'script_word_index':a})
offset=0
for shot in plan['shots']:
 idx=mapping.get(offset)
 if idx is None:idx=mapping[min(k for k in mapping if k>=offset)]
 shot['start_seconds']=round(heard[idx]['start'],3)
 offset+=len(tokens(shot['voice_text']))
for i,shot in enumerate(plan['shots']):shot['end_seconds']=plan['shots'][i+1]['start_seconds'] if i+1<len(plan['shots']) else transcript['duration']
plan['timing_status']='Five section starts aligned to actual recorded word timing; final video not rendered'
(F/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2)+'\n',encoding='utf-8')
review={'script_words':len(expected),'recognized_tokens':len(heard),'similarity':matcher.ratio(),'differences':flags,'human_listening_verified':False,'all_words_exactly_recognized':not flags,'subjective_naturalness_verified':False,'review_note':'Recognition differences are flagged for listening/edit review; export metrics do not establish viewer clarity.'}
(F/'NARRATION-WORD-CHECK.json').write_text(json.dumps(review,indent=2)+'\n',encoding='utf-8')
p=F/'publishing-package.json'
if p.exists():
 package=json.loads(p.read_text(encoding='utf-8-sig'));package.update(title=plan['title'],narrator='Ethan',voice_id='536d3a5e000945adb7038665781a4aca',publication_status='Not uploaded; revised narration ready, final video and refreshed metadata required',old_description_superseded=True,script_sha256=plan['script_sha256']);p.write_text(json.dumps(package,indent=2)+'\n',encoding='utf-8')
with (R/'calendar.csv').open(encoding='utf-8-sig',newline='') as f:rows=list(csv.DictReader(f));fields=list(rows[0])
for row in rows:
 if row['ID']=='W3-MAIN':
  for key in ['WorkingTitle','Title','Working title']:
   if key in row:row[key]=plan['title']
  row['MediaStatus']='Rewritten for clarity; complete Ethan narration checked; final MP4 not rendered'
with (R/'calendar.csv').open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=fields,quoting=csv.QUOTE_ALL);w.writeheader();w.writerows(rows)
print(json.dumps({'sections':[{'title':s['title'],'start':s['start_seconds']} for s in plan['shots']],'recognition_differences':flags,'video_ready':False}))
