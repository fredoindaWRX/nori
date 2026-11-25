import json,hashlib,shutil,re,urllib.request
from datetime import datetime,timezone
from pathlib import Path
R=Path('C:/Nori/streaming/channel-operator');F=R/'02-Calendar/Week-3/W3-MAIN';V=F/'voice-performance-inputs';V.mkdir(exist_ok=True)
plan=json.loads((F/'SHOT-PLAN.json').read_text(encoding='utf-8'));parts=[plan['shots'][0]['voice_text'],'\n\n'.join(s['voice_text'] for s in plan['shots'][1:3]),'\n\n'.join(s['voice_text'] for s in plan['shots'][3:])]
for i,text in enumerate(parts,1):(V/f'speech-{i:02d}.txt').write_text(text+'\n',encoding='utf-8')
original=R/'03-Production/Narrator-Comparison/Ethan/Fish-Ethan-Original.mp3'
if not (V/'speech-01.mp3').exists():shutil.copy2(original,V/'speech-01.mp3')
transcript=json.loads((R/'03-Production/Narrator-Comparison/Ethan/Ethan-Conversational-Opening.transcript.json').read_text(encoding='utf-8'))
def words(t):return re.findall(r"[a-z0-9']+",t.lower())
assert words(' '.join(s['text'] for s in transcript['segments']))==words(parts[0])
checks=[]
config=json.loads(Path('C:/Nori/nori/config.yaml').read_text(encoding='utf-8'));base=config['ollama_url'];assert base=='http://127.0.0.1:11435'
for suffix in ['/api/tags','/api/ps']:
 at=datetime.now(timezone.utc).isoformat()
 try:
  with urllib.request.urlopen(base+suffix,timeout=4) as response:
   data=json.loads(response.read(262144));status=response.status
  checks.append({'endpoint':suffix,'checked_at_utc':at,'reachable':True,'http_status':status,'model_names':[m.get('name',m.get('model')) for m in data.get('models',[])]})
 except Exception as error:checks.append({'endpoint':suffix,'checked_at_utc':at,'reachable':False,'error_type':type(error).__name__})
assert all(not c['reachable'] for c in checks),'Connection changed: revise narrated failure before rendering.'
evidence=F/'demonstration-evidence';evidence.mkdir(exist_ok=True)
(evidence/'actual-local-connection-checks.json').write_text(json.dumps({'scope':'Actual read-only requests to configured loopback model connection','checks':checks,'ai_answer_generated':False,'model_missing_proven':False},indent=2)+'\n',encoding='utf-8')
source=Path('C:/Nori/nori/main.py').read_text(encoding='utf-8-sig');start=source.index('            if self.path == "/live":');end=source.index('                "work_available":',start)
(evidence/'worker-health-source-excerpt.txt').write_text(source[start:end],encoding='utf-8')
queue_path=R/'03-Production/Fish-Ready-Scripts/GENERATION-QUEUE.json';queue=json.loads(queue_path.read_text(encoding='utf-8-sig'))
for entry in queue:
 if entry['video_id']=='W3-MAIN':entry.update(voice_name='Ethan',model_id='536d3a5e000945adb7038665781a4aca',engine='s2.1-pro-free',chunks=3,characters_per_chunk=[len(t) for t in parts],script_sha256=plan['script_sha256'],status='Rewritten for clarity; different narrator selected, opening generated, remaining two blocks generating; no final MP4 yet')
queue_path.write_text(json.dumps(queue,indent=2)+'\n',encoding='utf-8')
record={'voice_name':'Ethan','voice_id':'536d3a5e000945adb7038665781a4aca','generation_model':'s2.1-pro-free','paid_spend':0,'chunks_planned':3,'generated_chunks':[{'index':1,'blob_id':'d4bc6ac2-077c-41ba-94eb-0205fb775479','script_words_matched_by_recognition':True}],'subjective_naturalness_verified':False,'owner_avatar_used':False}
(V/'GENERATION-RECORD.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'actual_connection_checks_saved':2,'source_excerpt_saved':True,'opening_recognition_words_match':True,'planned_narration_blocks':3,'full_video_complete':False}))
