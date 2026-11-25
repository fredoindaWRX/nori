import json,re,shutil,subprocess
from pathlib import Path
F=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-1/W1-MAIN');P=F/'voice-performance-inputs'
B=Path('C:/Nori/streaming/tools/verification/pre-performance-revision/W1-MAIN/first-generated-long-form')
T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'))
def rows(p):return [w for s in json.loads(p.read_text(encoding='utf-8'))['segments'] for w in s['words']]
def boundary(ws):
 norm=lambda s:re.sub('[^a-z0-9]','',s.lower())
 for i in range(len(ws)-3):
  if [norm(w['word']) for w in ws[i:i+4]]==['the','routine','is','simple']:return ws[i]['start']-.07
 raise RuntimeError('Missing closing boundary')
old=boundary(rows(B/'speech-04-fred.transcript.json'));new=boundary(rows(P/'speech-04-fred.transcript.json'))
take=P/'speech-04-fred.mp3';saved=B/'revision-four-before-splice.mp3';assert not saved.exists();shutil.copy2(take,saved)
out=P/'speech-04-edited.wav';flt=f'[0:a]atrim=end={new},asetpts=PTS-STARTPTS[a];[1:a]atrim=start={old},asetpts=PTS-STARTPTS[b];[a][b]concat=n=2:v=0:a=1[out]'
subprocess.run([T['ffmpeg'],'-v','error','-i',str(take),'-i',str(B/'speech-04-fred.mp3'),'-filter_complex',flt,'-map','[out]','-ac','1','-ar','48000','-y',str(out)],check=True)
subprocess.run([T['ffmpeg'],'-v','error','-i',str(out),'-c:a','libmp3lame','-b:a','192k','-y',str(take)],check=True)
(P/'speech-04-edit-provenance.json').write_text(json.dumps({'source_takes':[str(saved),str(B/'speech-04-fred.mp3')],'new_scene_ten_end':new,'old_scene_eleven_start':old,'reason':'Use the clearer revised pause-screen line and retain the original verified work-screen recap and CTA.'},indent=2)+'\n',encoding='utf-8')
print('Closing section edited; needs fresh recognition.')
