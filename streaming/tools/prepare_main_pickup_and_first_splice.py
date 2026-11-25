import hashlib,json,re,subprocess,shutil
from pathlib import Path
F=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-1/W1-MAIN');P=F/'voice-performance-inputs'
B=Path('C:/Nori/streaming/tools/verification/pre-performance-revision/W1-MAIN/first-generated-long-form')
T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'))
plan=json.loads((F/'SHOT-PLAN.json').read_text(encoding='utf-8'))
before='For a plain full-screen scene, choose the option called Fit to Screen. That gives you a useful starting point.'
after='For a plain full-screen scene, use the fit option in the Transform menu. That gives you a useful starting point.'
assert before in plan['shots'][5]['voice_text']
plan['shots'][5]['voice_text']=plan['shots'][5]['voice_text'].replace(before,after)
script=' '.join(s['voice_text'] for s in plan['shots']);plan['script_sha256']=hashlib.sha256(script.encode()).hexdigest()
(F/'narration.txt').write_text(script+'\n',encoding='utf-8');(F/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
(P/'scene-06-performance.txt').write_text('[conversational, clear, unhurried] '+plan['shots'][5]['voice_text']+'\n',encoding='utf-8')
spoken='\n\n'.join(s['voice_text'] for s in plan['shots'][3:6]);(P/'speech-02.txt').write_text(spoken+'\n',encoding='utf-8');(P/'performance-02.txt').write_text('[conversational, clear, unhurried] '+spoken+'\n',encoding='utf-8')
def word_rows(path):return [w for s in json.loads(path.read_text(encoding='utf-8'))['segments'] for w in s['words']]
def norm(s):return re.sub('[^a-z0-9]','',s.lower())
def think_start(rows):
 for i in range(len(rows)-3):
  if [norm(w['word']) for w in rows[i:i+4]]==['think','of','one','monitor']:return rows[i]['start']
 raise RuntimeError('Scene boundary not found')
old=word_rows(B/'speech-01-fred.transcript.json');new=word_rows(P/'speech-01-fred.transcript.json')
old_end=think_start(old)-.07;new_begin=think_start(new)-.07
prefix=[w for w in old if w['start']<old_end]
assert ''.join(norm(w['word']) for w in prefix)==''.join(norm(w) for w in plan['shots'][0]['voice_text'].split())
take=P/'speech-01-fred.mp3';revised_backup=B/'revision-one-before-splice.mp3'
assert not revised_backup.exists();shutil.copy2(take,revised_backup)
out=P/'speech-01-edited.wav'
flt=f'[0:a]atrim=end={old_end},asetpts=PTS-STARTPTS[a];[1:a]atrim=start={new_begin},asetpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=0:a=1[out]'
subprocess.run([T['ffmpeg'],'-v','error','-i',str(B/'speech-01-fred.mp3'),'-i',str(take),'-filter_complex',flt,'-map','[out]','-ac','1','-ar','48000','-y',str(out)],check=True)
subprocess.run([T['ffmpeg'],'-v','error','-i',str(out),'-c:a','libmp3lame','-b:a','192k','-y',str(take)],check=True)
(P/'speech-01-edit-provenance.json').write_text(json.dumps({'source_takes':[str(B/'speech-01-fred.mp3'),str(revised_backup)],'old_scene_one_end_seconds':old_end,'new_scene_two_start_seconds':new_begin,'reason':'Keep the verified original opening; use the clearer revised second and third scenes. Final edited audio needs fresh recognition.'},indent=2)+'\n',encoding='utf-8')
print(json.dumps({'first_section_spliced':True,'scene_six_pickup_ready':True,'script_words':len(script.split())}))
