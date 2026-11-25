import argparse,hashlib,json,re,subprocess,textwrap,wave
from pathlib import Path
import numpy as np

parser=argparse.ArgumentParser()
parser.add_argument('folder',type=Path)
parser.add_argument('--caption-words',type=int,default=8)
args=parser.parse_args(); folder=args.folder
script=(folder/'narration.txt').read_text(encoding='utf-8').strip()
plan=json.loads((folder/'SHOT-PLAN.json').read_text(encoding='utf-8'))
groups=[shot['voice_text'] for shot in plan['shots']]
assert ' '.join(groups)==script
source_words=script.split()
transcript=json.loads((folder/'narration-fred-final.transcript.json').read_text(encoding='utf-8'))
words=[w for s in transcript['segments'] for w in s['words']]
def normalize(t):
 value=re.sub(r'[^a-z0-9]','',t.lower())
 return {'12':'twelve'}.get(value,value)
words=[w for w in words if normalize(w['word'])]
assert ''.join(normalize(w) for w in source_words)==''.join(normalize(w['word']) for w in words), 'Actual speech word sequence differs from the source.'
# Recognizers may split hyphenated source words. Preserve actual timestamps,
# and accept only an exact concatenated spelling match for each source word.
aligned=[];cursor=0
for source_word in source_words:
 target=normalize(source_word);piece='';begin=cursor
 while piece!=target:
  assert cursor<len(words)
  piece+=normalize(words[cursor]['word']);cursor+=1
  assert target.startswith(piece), 'Token boundary does not align exactly.'
 aligned.append({'word':source_word,'start':words[begin]['start'],'end':words[cursor-1]['end']})
assert cursor==len(words)
words=aligned
(folder/'spoken-words.json').write_text(json.dumps(words,indent=2),encoding='utf-8')
tools=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'))
duration=float(subprocess.check_output([tools['ffprobe'],'-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(folder/'narration-fred-final.mp3')]))
def stamp(t):
 n=round(t*1000);return f'{n//3600000:02}:{n//60000%60:02}:{n//1000%60:02},{n%1000:03}'
events=[];bounds=[];start=0
while start<len(words):
 end=start
 while end<len(words):
  candidate=' '.join(source_words[start:end+1])
  if end>start and (len(candidate)>55 or len(textwrap.wrap(candidate,width=28,break_long_words=False))>2 or end-start>=args.caption_words or words[end]['end']-words[start]['start']>2.8):break
  end+=1
  if source_words[end-1][-1] in '.?!':break
 while end>start+2 and normalize(source_words[end-1]) in {'with','and','the','your','because','without','on','of','instead'}:end-=1
 lines=textwrap.wrap(' '.join(source_words[start:end]),width=28,break_long_words=False)
 assert len(lines)<=2
 a=max(0,words[start]['start']-.04);b=min(duration,words[end-1]['end']+.08)
 if end<len(words):b=min(b,words[end]['start']-.055)
 assert b>a
 if bounds:assert a>=bounds[-1][1]+.014
 bounds.append((a,b))
 events.append(f'{len(events)+1}\n{stamp(a)} --> {stamp(b)}\n'+'\n'.join(lines));start=end
(folder/'captions.srt').write_text('\n\n'.join(events)+'\n',encoding='utf-8')
starts=[0.0];n=0
for group in groups[:-1]:
 n+=len(group.split());starts.append(max(starts[-1]+.1,words[n]['start']-.04))
durations=[b-a for a,b in zip(starts,starts[1:]+[duration])]
(folder/'scene-timing.json').write_text(json.dumps(durations,indent=2),encoding='utf-8')
for shot,begin,length in zip(plan['shots'],starts,durations):shot.update(start_seconds=begin,duration_seconds=length)
plan.update(script_sha256=hashlib.sha256(script.encode()).hexdigest(),timing_status='Actual generated speech aligned locally; normalized word sequence exactly matches script.',status='Audio, captions and measured scene timing ready for assembly.')
(folder/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2),encoding='utf-8')
rate=48000;t=np.arange(round(duration*rate))/rate;bed=np.zeros_like(t);beat=60/96;notes=[164.8138,195.9977,220.0,195.9977]
for i,start_t in enumerate(np.arange(0,duration,beat*2)):
 local=t-start_t;gate=(local>=0)&(local<1.0);phase=local[gate];env=(1-np.exp(-phase*28))*np.exp(-phase*4.5);frequency=notes[i%4]
 bed[gate]+=.018*env*(np.sin(2*np.pi*frequency*phase)+.2*np.sin(4*np.pi*frequency*phase))
for start_t in starts[1:]:
 local=t-start_t;gate=(local>=0)&(local<.10);phase=local[gate];bed[gate]+=.025*np.sin(2*np.pi*(700*phase-2200*phase**2))*np.exp(-phase*35)
bed*=np.minimum(t/.4,1)*np.minimum((duration-t)/.4,1)
with wave.open(str(folder/'original-music-and-cuts.wav'),'wb') as f:
 f.setnchannels(2);f.setsampwidth(2);f.setframerate(rate);f.writeframes((np.clip(np.column_stack([bed,bed*.96]),-1,1)*32767).astype('<i2').tobytes())
report={'duration':duration,'caption_cues':len(events),'source_word_match':'exact after punctuation, hyphen and unambiguous twelve/12 normalization','hook_end_seconds':words[len(groups[0].split())-1]['end'],'scene_starts':starts,'caption_overlap':'none, minimum separation 15ms','original_sound':'Locally synthesized original motif and timed transition ticks','human_listening_review':'Not claimed; automated speech verification completed.','publication_authorization':'User authorized Fish narration; service-license classification remains unresolved.'}
assert report['hook_end_seconds']<=5
(folder/'narration-alignment-check.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
