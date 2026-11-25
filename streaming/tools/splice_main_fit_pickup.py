import json,re,shutil,subprocess
from pathlib import Path
F=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-1/W1-MAIN');P=F/'voice-performance-inputs';B=Path('C:/Nori/streaming/tools/verification/pre-performance-revision/W1-MAIN/first-generated-long-form')
T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'))
ws=[w for s in json.loads((B/'speech-02-fred.transcript.json').read_text(encoding='utf-8'))['segments'] for w in s['words']]
norm=lambda s:re.sub('[^a-z0-9]','',s.lower())
boundary=None
for i in range(len(ws)-3):
 if [norm(w['word']) for w in ws[i:i+4]]==['now','check','the','size']:boundary=ws[i]['start']-.07;break
assert boundary is not None
take=P/'speech-02-fred.mp3';saved=B/'revision-two-before-splice.mp3';assert not saved.exists();shutil.copy2(take,saved)
out=P/'speech-02-edited.wav';flt=f'[0:a]atrim=end={boundary},asetpts=PTS-STARTPTS[a];[1:a]asetpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=0:a=1[out]'
subprocess.run([T['ffmpeg'],'-v','error','-i',str(B/'speech-02-fred.mp3'),'-i',str(P/'scene-06-pickup-fred.mp3'),'-filter_complex',flt,'-map','[out]','-ac','1','-ar','48000','-y',str(out)],check=True)
subprocess.run([T['ffmpeg'],'-v','error','-i',str(out),'-c:a','libmp3lame','-b:a','192k','-y',str(take)],check=True)
(P/'speech-02-edit-provenance.json').write_text(json.dumps({'source_takes':[str(B/'speech-02-fred.mp3'),str(P/'scene-06-pickup-fred.mp3')],'prefix_end_seconds':boundary,'reason':'Keep original verified scene-selection instructions and replace ambiguous menu-name speech with a clear fit-option explanation.'},indent=2)+'\n',encoding='utf-8')
print('Fit pickup inserted; final recognition required.')
