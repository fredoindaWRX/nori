"""Save transparent narration alignment, including unresolved recognition flags."""
import difflib,json,re,textwrap
from pathlib import Path
P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-2/W2-MAIN')
plan=json.loads((P/'SHOT-PLAN.json').read_text(encoding='utf-8'))
transcript=json.loads((P/'narration-fred-clear.transcript.json').read_text(encoding='utf-8'))
actual=[w for s in transcript['segments'] for w in s['words']]
source=' '.join(s['voice_text'] for s in plan['shots']).split()
norm=lambda s:re.sub('[^a-z0-9]','',s.lower())
matcher=difflib.SequenceMatcher(None,[norm(w) for w in source],[norm(w['word']) for w in actual],autojunk=False)
aligned=[None]*len(source);flags=[]
for tag,a,b,c,d in matcher.get_opcodes():
 if tag=='equal':
  for i,j in zip(range(a,b),range(c,d)):aligned[i]={'word':source[i],'start':actual[j]['start'],'end':actual[j]['end'],'alignment':'recognized match'}
 else:
  flags.append({'operation':tag,'source':' '.join(source[a:b]),'recognized':' '.join(w['word'].strip() for w in actual[c:d]),
   'source_indices':[a,b],'audio_seconds':[actual[c]['start'] if c<len(actual) else transcript['duration'],actual[d-1]['end'] if d>c else (actual[c]['start'] if c<len(actual) else transcript['duration'])]})
  if b>a:
   start=actual[c]['start'] if c<len(actual) else actual[-1]['end']
   end=actual[d-1]['end'] if d>c else start+0.03
   for k,i in enumerate(range(a,b)):
    aligned[i]={'word':source[i],'start':start+(end-start)*k/(b-a),'end':start+(end-start)*(k+1)/(b-a),'alignment':'approximate; recognition discrepancy requires review'}
assert all(w is not None for w in aligned)
ratio=matcher.ratio();assert ratio>0.94, 'Substantial narration mismatch: inspect before alignment.'
(P/'spoken-words.json').write_text(json.dumps(aligned,indent=2),encoding='utf-8')
cursor=0
for n,s in enumerate(plan['shots']):
 count=len(s['voice_text'].split());s['start_seconds']=max(0,aligned[cursor]['start']-.025) if n else 0
 cursor+=count
for i,s in enumerate(plan['shots']):s['duration_seconds']=(plan['shots'][i+1]['start_seconds'] if i+1<len(plan['shots']) else transcript['duration'])-s['start_seconds']
plan.update(timing_status='Measured final clear-master recognition; flagged word replacements retained for review',status='Full narration and edit assets present; caption/wording review and MP4 assembly incomplete')
(P/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2),encoding='utf-8')
def stamp(t):
 ms=round(max(0,t)*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
events=[];i=0;previous_end=0
while i<len(aligned):
 j=i+1
 while j<len(aligned):
  words=' '.join(source[i:j+1])
  if source[j-1][-1] in '.?!' or len(words)>80 or j-i>=10 or aligned[j]['end']-aligned[i]['start']>3.6:break
  j+=1
 lines=textwrap.wrap(' '.join(source[i:j]),46,break_long_words=False);assert len(lines)<=2
 begin=max(previous_end+.01,aligned[i]['start']-.03);end=max(begin+.04,aligned[j-1]['end']+.03)
 if j<len(aligned) and aligned[j]['start']>begin+.06:end=min(end,aligned[j]['start']-.02)
 events.append(f'{len(events)+1}\n{stamp(begin)} --> {stamp(end)}\n'+'\n'.join(lines));previous_end=end;i=j
(P/'captions.srt').write_text('\n\n'.join(events)+'\n',encoding='utf-8')
report={'duration_seconds':transcript['duration'],'source_word_count':len(source),'recognition_similarity':ratio,
 'recognition_flags':flags,'caption_cues':len(events),'hook_end_seconds':aligned[9]['end'],
 'all_words_exactly_verified':False,'human_listening_verified':False,'final_video':False,
 'review_note':'Keep raw recognitions. Source-level recognitions and the independent base.en check resolve some full-master flags, including Guests. Remaining differences must be reviewed before publication.'}
(P/'narration-alignment-check.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='recognition_flags'}));print(json.dumps(flags))
