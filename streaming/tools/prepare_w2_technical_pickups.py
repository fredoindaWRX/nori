import hashlib,json,shutil
from pathlib import Path
P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-2/W2-MAIN');V=P/'voice-performance-inputs'
B=Path('C:/Nori/streaming/tools/verification/pre-performance-revision/W2-MAIN/before-technical-pickups');B.mkdir(parents=True,exist_ok=True)
for path in [P/'SHOT-PLAN.json',P/'narration.txt',V/'speech-01.txt',V/'performance-01.txt',V/'speech-03.txt',V/'performance-03.txt',V/'GENERATION-RECORD.json']:
 assert not (B/path.name).exists();shutil.copy2(path,B/path.name)
plan=json.loads((P/'SHOT-PLAN.json').read_text(encoding='utf-8'))
plan['shots'][2]['voice_text']="On this computer, I selected the Sonar microphone device from SteelSeries. For guests, I selected the Discord application. The mixer has a microphone control and a guest control. Clear labels are easier to read during a stream. Both sources are muted in the saved collection right now. This video explains the configuration. It does not show a real guest conversation. Before you stream, make the short recording test at the end. That test checks what people will actually hear."
plan['shots'][8]['voice_text']="Here is the part that trips people up. Separate mixer controls and separate recording tracks are different things. In this saved setup, the microphone is assigned to tracks one and two. Discord is assigned to tracks one and three. But this OBS profile uses Simple output mode. It records track one only. So the saved file contains the shared mix. The other source assignments do not create extra tracks by themselves. It is like putting three plates on the table and only serving one. The configuration has to agree at both ends."
text='\n\n'.join(s['voice_text'] for s in plan['shots'])+'\n';plan.update(script_sha256=hashlib.sha256(text.encode()).hexdigest(),word_count=len(text.split()),status='Two technical pronunciation pickups required before final voice assembly')
for n in [1,3]:
 plain='\n\n'.join(s['voice_text'] for s in plan['shots'][(n-1)*3:n*3]);(V/f'speech-{n:02}.txt').write_text(plain+'\n',encoding='utf-8');(V/f'performance-{n:02}.txt').write_text('[calm] '+plain+'\n',encoding='utf-8')
pickup='[calm] '+plan['shots'][2]['voice_text']+'\n\n'+plan['shots'][8]['voice_text']+'\n'
(V/'technical-pickups.txt').write_text(pickup,encoding='utf-8')
(P/'narration.txt').write_text(text,encoding='utf-8');(P/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2),encoding='utf-8')
record=json.loads((V/'GENERATION-RECORD.json').read_text(encoding='utf-8'));record.update(status='Previous 340-second master retained. Technical pronunciation pickups in progress; current master does not yet match the revised script.',pending_pickup_scenes=[3,9]);(V/'GENERATION-RECORD.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
state=json.loads((P/'PRODUCTION-STATE.json').read_text(encoding='utf-8'));state.update(script_words=plan['word_count'],technical_pickups_pending=[3,9],voice_master_matches_current_script=False);(P/'PRODUCTION-STATE.json').write_text(json.dumps(state,indent=2),encoding='utf-8')
print(json.dumps({'pickup_words':len(pickup.split())-1,'episode_words':plan['word_count'],'scenes':[3,9]}))
