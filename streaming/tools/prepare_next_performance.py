import argparse,hashlib,json,shutil
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('video',choices=['W3-S2','W4-S1']);args=p.parse_args()
root=Path('C:/Nori/streaming/channel-operator');folder=root/('02-Calendar/Week-3/W3-S2' if args.video=='W3-S2' else '02-Calendar/Week-4/W4-S1')
assert not (folder/'publication-record.json').exists(),'Do not change a published calendar source'
backup=Path('C:/Nori/streaming/tools/verification/pre-performance-revision')/args.video;backup.mkdir(parents=True,exist_ok=True)
for name in ['narration.txt','SHOT-PLAN.json','publishing-package.json','narration-fred-final.mp3','narration-fred-final.transcript.json','captions.srt']:
 src=folder/name
 if src.exists() and not (backup/name).exists():shutil.copy2(src,backup/name)
plan=json.loads((folder/'SHOT-PLAN.json').read_text(encoding='utf-8'));package=json.loads((folder/'publishing-package.json').read_text(encoding='utf-8'))
old=folder/package['video_asset']
if old.exists():
 assert not (backup/old.name).exists();old.rename(backup/old.name)
if args.video=='W3-S2':
 groups=[('12 JOB TITLES','Twelve job titles. One brain.'),('GROUP PROJECT ENERGY','Bro, that is a group project.'),('JOB DESCRIPTIONS','AI roles are job descriptions.'),('MODELS ARE NOT MAGIC','They do not magically spawn twelve loaded models.'),('WHO IS ACTIVE?','Check who is active and which model is loaded.'),('SHOW THE NUMBERS','Before calling it a supercomputer, show memory and latency.'),('RESUME IS NOT A BENCHMARK','The resume is not the benchmark.')]
 directed='[excited] Twelve job titles. One brain. [sarcastic] Bro, that is a group project. [conversational] AI roles are job descriptions. They do not magically spawn twelve loaded models. Check who is active and which model is loaded. [skeptical] Before calling it a supercomputer, show memory and latency. [deadpan] The resume is not the benchmark.'
 package.update(title='12 AI Jobs. One Brain. Group Project Energy',thumbnail_overlay='12 JOB TITLES',description="Twelve roles do not automatically mean twelve loaded AI models. Roles describe jobs; check which roles are active, which model is loaded, and measured memory and latency before making performance claims.\n\nAn original animated Nori comedy. Examples are illustrations, not a completed live benchmark. Narration is AI-generated from my own voice.\n\nSubscribe for the next Building Nori episode.\n\n#BuildingNori #AIComedy #LocalAI")
else:
 groups=[('NICE ARROWS','Nice arrows. Did anybody do the job?'),('SUPERHERO TEAM','Your agent diagram looks like a superhero team.'),('STILL IN RECEPTION','Meanwhile, the task is still in reception.'),('DELIVER THE REQUEST','Picking a worker is not delivering the request.'),('QUEUED IS NOT DONE','And a queue is not a finished job.'),('FOLLOW THE RESULT','Follow the input to the actual result.'),('NO VICTORY DANCE','No receipt? No victory dance.')]
 directed='[sarcastic] Nice arrows. Did anybody do the job? [animated] Your agent diagram looks like a superhero team. [deadpan] Meanwhile, the task is still in reception. [conversational] Picking a worker is not delivering the request. And a queue is not a finished job. Follow the input to the actual result. [emphasis] No receipt? [deadpan] No victory dance.'
 package.update(title='Your AI Agent Team Has Great Arrows. Where Is the Work?',thumbnail_overlay='NICE ARROWS',description="An agent diagram can look impressive while the task is still waiting. Picking a worker, delivering the request, doing the action, and checking the actual result are different steps.\n\nAn original animated Nori comedy with hypothetical examples. No completed live agent task is claimed. Narration is AI-generated from my own voice.\n\nSubscribe for the next Building Nori episode.\n\n#BuildingNori #AIComedy #AIAgents")
script=' '.join(voice for title,voice in groups)
for shot,(title,voice) in zip(plan['shots'],groups):
 for key in ['start_seconds','duration_seconds']:shot.pop(key,None)
 shot.update(title=title,voice_text=voice,asset_role='Original animated comic metaphor; not a completed live test')
plan.update(script_sha256=hashlib.sha256(script.encode()).hexdigest(),timing_status='Awaiting new expressive speech alignment',status='Revised for conversational performance and action editing')
package.update(actual_upload_status='Not uploaded; performance revision in progress',publishing_hold='Awaiting expressive voice, action render and review',edit_direction='Seven distinct action setups, expressive own-voice narration, animated props, spoken-word highlights and original timed sounds')
for name,data in [('SHOT-PLAN.json',plan),('publishing-package.json',package)]:
 (folder/name).write_text(json.dumps(data,indent=2,ensure_ascii=False),encoding='utf-8')
(folder/'narration.txt').write_text(script+'\n',encoding='utf-8');(folder/'voice-performance-input.txt').write_text(directed+'\n',encoding='utf-8')
print(json.dumps({'folder':str(folder),'words':len(script.split()),'earlier_edit_preserved':str(backup)}))
