"""Replace only the two unclear technical passages, preserving clip provenance."""
import json,re,subprocess,wave,hashlib,shutil
from pathlib import Path
P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-2/W2-MAIN');V=P/'voice-performance-inputs'
B=Path('C:/Nori/streaming/tools/verification/pre-performance-revision/W2-MAIN/before-technical-pickups')
T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'))
def words(path):return [w for s in json.loads(path.read_text(encoding='utf-8'))['segments'] for w in s['words']]
def phrase_index(ws,phrase):
 n=[re.sub('[^a-z0-9]','',w['word'].lower()) for w in ws];hits=[i for i in range(len(n)-len(phrase)+1) if n[i:i+len(phrase)]==phrase]
 assert len(hits)==1,(phrase,hits);return hits[0]
pickup=V/'technical-pickups.mp3';pw=words(pickup.with_suffix('.transcript.json'))
boundary=phrase_index(pw,['here','is','the','part']);split=(pw[boundary-1]['end']+pw[boundary]['start'])/2
def pcm(path):return subprocess.check_output([T['ffmpeg'],'-v','error','-i',str(path),'-ar','48000','-ac','1','-f','s16le','pipe:1'])
new=pcm(pickup);split_sample=round(split*48000)*2
for n,phrase,suffix in [(1,['on','this','computer'],new[:split_sample]),(3,['here','is','the','part'],new[split_sample:])]:
 original=V/f'speech-{n:02}.mp3';tr=original.with_suffix('.transcript.json');ow=words(tr);idx=phrase_index(ow,phrase);cut=(ow[idx-1]['end']+ow[idx]['start'])/2
 for path in [original,tr]:
  assert not (B/path.name).exists();shutil.copy2(path,B/path.name)
 raw=pcm(original)[:round(cut*48000)*2]+suffix;out=V/f'speech-{n:02}-edited.wav'
 with wave.open(str(out),'wb') as f:f.setnchannels(1);f.setsampwidth(2);f.setframerate(48000);f.writeframes(raw)
 # Decode/encode after preserving the original. The WAV edit remains available.
 temporary=V/f'speech-{n:02}-technical-edit.mp3'
 subprocess.run([T['ffmpeg'],'-v','error','-i',str(out),'-c:a','libmp3lame','-b:a','192k',str(temporary)],check=True)
 temporary.replace(original)
 (V/f'speech-{n:02}-edit-provenance.json').write_text(json.dumps({'original_audio':str(B/original.name),'original_sha256':hashlib.sha256((B/original.name).read_bytes()).hexdigest(),'prefix_end_seconds':cut,'pickup_audio':str(pickup),'pickup_split_seconds':split,'pickup_part':1 if n==1 else 2,'edited_wav':str(out),'note':'Only the unclear technical scene was replaced. Raw recognition remains preserved.'},indent=2),encoding='utf-8')
for name in ['narration-fred-raw.wav','narration-fred-clear.wav','narration-fred-clear.transcript.json','narration-fred-clear.base-en.transcript.json','spoken-words.json','captions.srt','narration-alignment-check.json']:
 path=P/name
 if path.exists():
  assert path.resolve().is_relative_to(P.resolve());assert not (B/name).exists();path.rename(B/name)
print(json.dumps({'edited_chunks':[1,3],'pickup_split_seconds':split,'previous_master_preserved':str(B),'next':'Transcribe edited chunks, then reassemble and align the final master.'}))
