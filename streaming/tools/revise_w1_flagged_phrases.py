import hashlib, json, shutil
from pathlib import Path

root=Path('C:/Nori/streaming/channel-operator')
folder=root/'02-Calendar/Week-1/W1-MAIN'
perf=folder/'voice-performance-inputs'
backup=Path('C:/Nori/streaming/tools/verification/pre-performance-revision/W1-MAIN/first-generated-long-form')
backup.mkdir(parents=True,exist_ok=True)
plan=json.loads((folder/'SHOT-PLAN.json').read_text(encoding='utf-8'))
changes={
 2:[('during a stream','during a live broadcast')],
 3:[('is a clue.','is only a clue.')],
 6:[('For a plain full-screen scene, Fit to Screen is a useful starting point.','For a plain full-screen scene, choose the option called Fit to Screen. That gives you a useful starting point.')],
 9:[('If your microphone or Discord guests disappear, fix that before the stream.','If your microphone or the Discord call goes silent, fix that before going live.')],
 10:[('before you trust a Break scene.','before you trust your pause screen.')]
}
for filename in ['narration.txt','SHOT-PLAN.json']:
 if not (backup/filename).exists():shutil.copy2(folder/filename,backup/filename)
for item in perf.iterdir():
 if item.is_file() and not (backup/item.name).exists():shutil.copy2(item,backup/item.name)
for shot in plan['shots']:
 for before,after in changes.get(shot['index'],[]):
  assert before in shot['voice_text'], (shot['index'],before)
  shot['voice_text']=shot['voice_text'].replace(before,after)
script=' '.join(s['voice_text'] for s in plan['shots'])
(folder/'narration.txt').write_text(script+'\n',encoding='utf-8')
plan['script_sha256']=hashlib.sha256(script.encode()).hexdigest()
plan['status']='Flagged phrases rewritten for clear speech. Four revised free-model narration blocks require generation and verification.'
(folder/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
record=json.loads((perf/'GENERATION-RECORD.json').read_text(encoding='utf-8'))
record.update(script_sha256=plan['script_sha256'],finished_video=False,revision_reason='Clarify uncertain stream/screen, menu-name and article phrases without accepting recognition guesses as proof.')
for block in record['blocks']:
 i=block['index'];spoken='\n\n'.join(s['voice_text'] for s in plan['shots'][(i-1)*3:i*3])
 (perf/f'speech-{i:02d}.txt').write_text(spoken+'\n',encoding='utf-8')
 (perf/f'performance-{i:02d}.txt').write_text('[conversational, clear, unhurried] '+spoken+'\n',encoding='utf-8')
 block['status']='Revised source ready; first audio take retained for reference, revised audio not generated.'
 block['words']=len(spoken.split());block['characters']=len(spoken)
 block['normalized_source_word_match']=False
 block['current_audio_matches_revised_source']=False
 queue=root/f'03-Production/Fish-Ready-Scripts/W1-MAIN/speech-{i:02d}.txt'
 queue.write_text(spoken+'\n',encoding='utf-8')
(perf/'GENERATION-RECORD.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'rewritten_shots':list(changes),'words':len(script.split()),'original_takes_preserved':str(backup)}))
