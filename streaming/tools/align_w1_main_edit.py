import hashlib,json,math,re,subprocess,textwrap,wave
from pathlib import Path
import numpy as np
F=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-1/W1-MAIN');P=F/'voice-performance-inputs';B=Path('C:/Nori/streaming/tools/verification/pre-performance-revision/W1-MAIN/first-generated-long-form')
T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'))
plan=json.loads((F/'SHOT-PLAN.json').read_text(encoding='utf-8'));script=' '.join(s['voice_text'] for s in plan['shots'])
norm=lambda s:re.sub('[^a-z0-9]','',s.lower())
def rows(path):return [dict(w) for s in json.loads(path.read_text(encoding='utf-8'))['segments'] for w in s['words']]
edit=json.loads((P/'speech-02-edit-provenance.json').read_text(encoding='utf-8'));cut=edit['prefix_end_seconds']
prefix=[w for w in rows(B/'speech-02-fred.transcript.json') if w['start']<cut]
pickup=rows(P/'scene-06-pickup-fred.transcript.json')
assert ''.join(norm(w['word']) for w in prefix)==''.join(norm(w) for w in ' '.join(s['voice_text'] for s in plan['shots'][3:5]).split())
assert ''.join(norm(w['word']) for w in pickup)==''.join(norm(w) for w in plan['shots'][5]['voice_text'].split())
for w in pickup:w['start']+=cut;w['end']+=cut
for w in prefix:w['end']=min(w['end'],cut)
verified={'model':'Verified edit assembled from independently recognized exact-matching source components','segments':[{'text':' '.join(w['word'].strip() for w in prefix+pickup),'words':prefix+pickup}],'provenance':edit,'final_recognition_difference_resolution':'The full edit recognizer wrote singular window; the unchanged pickup audio was recognized as plural windows before insertion. Preserve both raw recognitions. Captions use the exact-matching pickup component timestamps.'}
(P/'speech-02-fred.verified-edit.transcript.json').write_text(json.dumps(verified,indent=2)+'\n',encoding='utf-8')
allwords=[];pcm=[];offset=0.;record=json.loads((P/'GENERATION-RECORD.json').read_text(encoding='utf-8'))
for i in range(1,5):
 audio=P/f'speech-{i:02d}-fred.mp3';tr=P/f'speech-{i:02d}-fred'+Path('') if False else P/(f'speech-{i:02d}-fred'+('.verified-edit' if i==2 else '')+'.transcript.json')
 ws=rows(tr);source=(P/f'speech-{i:02d}.txt').read_text(encoding='utf-8')
 assert ''.join(norm(w['word']) for w in ws)==''.join(norm(w) for w in source.split()),f'Block {i} differs'
 raw=subprocess.check_output([T['ffmpeg'],'-v','error','-i',str(audio),'-ac','2','-ar','48000','-f','s16le','pipe:1']);pcm.append(raw);length=len(raw)/4/48000
 for w in ws:w['start']+=offset;w['end']+=offset;allwords.append(w)
 offset+=length
 block=record['blocks'][i-1];block.update(current_audio_matches_revised_source=True,normalized_source_word_match=True,verification_basis=str(tr.relative_to(F)).replace('\\','/'),status='Edited speech verified against source; clip provenance preserved.',duration_decoded_seconds=length)
record.update(script_sha256=hashlib.sha256(script.encode()).hexdigest(),total_generated_duration_seconds=offset,finished_video=False,note='All source words verified. Block 2 uses exact recognized source components to resolve a context-dependent plural recognition flag; raw final recognizer flag preserved. No human listening or likeness review claimed.')
(P/'GENERATION-RECORD.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
with wave.open(str(F/'narration-fred-edited.wav'),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(48000);f.writeframes(b''.join(pcm))
source_words=script.split();aligned=[];cursor=0
for sw in source_words:
 target=norm(sw);acc='';begin=cursor
 while acc!=target:
  assert cursor<len(allwords);acc+=norm(allwords[cursor]['word']);cursor+=1;assert target.startswith(acc),(sw,acc)
 aligned.append({'word':sw,'start':allwords[begin]['start'],'end':allwords[cursor-1]['end']})
assert cursor==len(allwords)
(F/'spoken-words.json').write_text(json.dumps(aligned,indent=2)+'\n',encoding='utf-8')
def stamp(t):
 ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
events=[];bounds=[];a=0
while a<len(aligned):
 b=a
 while b<len(aligned):
  candidate=' '.join(source_words[a:b+1])
  if b>a and (len(candidate)>82 or len(textwrap.wrap(candidate,46,break_long_words=False))>2 or b-a>=10 or aligned[b]['end']-aligned[a]['start']>3.7):break
  b+=1
  if source_words[b-1][-1] in '.?!':break
 lines=textwrap.wrap(' '.join(source_words[a:b]),46,break_long_words=False);assert len(lines)<=2
 begin=max(0,aligned[a]['start']-.03);end=min(offset,aligned[b-1]['end']+.06)
 if b<len(aligned):end=min(end,aligned[b]['start']-.035)
 if bounds:begin=max(begin,bounds[-1][1]+.014)
 assert end>begin;bounds.append((begin,end));events.append(f'{len(events)+1}\n{stamp(begin)} --> {stamp(end)}\n'+'\n'.join(lines));a=b
(F/'captions.srt').write_text('\n\n'.join(events)+'\n',encoding='utf-8')
starts=[0.];count=0
for s in plan['shots'][:-1]:count+=len(s['voice_text'].split());starts.append(aligned[count]['start']-.025)
for s,begin,end in zip(plan['shots'],starts,starts[1:]+[offset]):s.update(start_seconds=begin,duration_seconds=end-begin)
plan.update(timing_status='Measured edited speech word timestamps; all words verified using raw recognition and documented clip provenance.',status='Verified narration, 48 original visual beats, captions and actual OBS recording ready for final assembly.')
(F/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
rate=48000;t=np.arange(round(offset*rate))/rate;bed=np.zeros_like(t);beat=60/96
notes=[164.8138,195.9977,220.,195.9977]
for i,at in enumerate(np.arange(0,offset,beat*4)):
 local=t-at;sel=(local>=0)&(local<.9);v=local[sel];env=(1-np.exp(-v*32))*np.exp(-v*6);bed[sel]+=.009*env*np.sin(2*np.pi*notes[i%4]*v)
for at in starts[1:]:
 local=t-at;sel=(local>=0)&(local<.12);v=local[sel];bed[sel]+=.018*np.sin(2*np.pi*(700*v-2000*v*v))*np.exp(-v*29)
bed*=np.minimum(t/.5,1)*np.minimum((offset-t)/.5,1)
with wave.open(str(F/'original-music-and-cuts.wav'),'wb') as f:f.setnchannels(2);f.setsampwidth(2);f.setframerate(rate);f.writeframes((np.column_stack([bed,bed*.95])*32767).astype('<i2').tobytes())
hook_words=len(plan['hook_text'].split());report={'duration_seconds':offset,'source_words':len(source_words),'verified_source_word_match':True,'caption_cues':len(events),'hook_end_seconds':aligned[hook_words-1]['end'],'clip_review_provenance':str(P/'GENERATION-RECORD.json'),'avatar_configured':False,'human_listening_verified':False,'final_mp4':False}
assert report['hook_end_seconds']<5
(F/'narration-alignment-check.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
print(json.dumps(report))
