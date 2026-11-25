import hashlib,json,shutil
from pathlib import Path
P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-2/W2-MAIN');V=P/'voice-performance-inputs'
B=Path('C:/Nori/streaming/tools/verification/pre-performance-revision/W2-MAIN/unclear-first-voice');B.mkdir(parents=True,exist_ok=True)
for name in ['speech-02.mp3','speech-02.transcript.json','speech-02.base-en.transcript.json','speech-02.txt','performance-02.txt']:
 assert not (B/name).exists();shutil.copy2(V/name,B/name)
plan=json.loads((P/'SHOT-PLAN.json').read_text(encoding='utf-8'))
changes={
 'The goal is a clear voice, not a red bar with confidence.':'Keep your voice clear. Keep normal speech out of the red.',
 'Start with a natural voice and make small changes.':'Begin with simple processing and make small changes.',
 'Stacking several aggressive filters can make every word sound like it was assembled in a microwave.':'Too many heavy filters may leave your voice sounding like it was assembled in a microwave.',
 'the guest audio coming from your speakers':'the guest audio playing through loudspeakers'}
for s in plan['shots']:
 for old,new in changes.items():s['voice_text']=s['voice_text'].replace(old,new)
text='\n\n'.join(s['voice_text'] for s in plan['shots'])+'\n';plan['script_sha256']=hashlib.sha256(text.encode()).hexdigest();plan['word_count']=len(text.split())
(P/'narration.txt').write_text(text,encoding='utf-8');(P/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2),encoding='utf-8')
block='\n\n'.join(s['voice_text'] for s in plan['shots'][3:6]);(V/'speech-02.txt').write_text(block+'\n',encoding='utf-8');(V/'performance-02.txt').write_text('[calm] '+block+'\n',encoding='utf-8')
(V/'speech-02-revision-reason.json').write_text(json.dumps({'reason':'Two independent recognizers flagged goal/gold, can/to, and speakers/speaker. Simplify wording and regenerate; preserve both raw recognitions.', 'changes':changes,'previous_files':str(B)},indent=2),encoding='utf-8')
print(json.dumps({'revised_block_words':len(block.split()),'episode_words':plan['word_count']}))
