"""Align source captions to verified real word timings and create original sounds."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import textwrap
import wave
import numpy as np

folder=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-1/W1-S1')
script=(folder/'narration.txt').read_text(encoding='utf-8').strip()
source_words=script.split()
transcript=json.loads((folder/'narration-fred-final.transcript.json').read_text(encoding='utf-8'))
words=[w for s in transcript['segments'] for w in s['words']]
normalize=lambda t:re.sub(r'[^a-z0-9]','',t.lower())
assert [normalize(w) for w in source_words]==[normalize(w['word']) for w in words], 'Generated speech differs from the script; review before captioning.'
tools=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'))
duration=float(subprocess.check_output([tools['ffprobe'],'-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(folder/'narration-fred-final.mp3')]))
def stamp(t):
    n=round(t*1000)
    return f'{n//3600000:02}:{n//60000%60:02}:{n//1000%60:02},{n%1000:03}'
events=[]
start=0
while start<len(words):
    end=start
    while end<len(words):
        candidate=' '.join(source_words[start:end+1])
        if end>start and (len(candidate)>55 or len(textwrap.wrap(candidate,width=28,break_long_words=False))>2 or end-start>=8 or words[end]['end']-words[start]['start']>2.8):break
        end+=1
        if source_words[end-1][-1] in '.?!':break
    while end>start+2 and normalize(source_words[end-1]) in {'with','and','the','your','because','without','on','of','instead'}:
        end-=1
    line=' '.join(source_words[start:end])
    lines=textwrap.wrap(line,width=28,break_long_words=False)
    assert len(lines)<=2
    a=max(0,words[start]['start']-.04)
    b=min(duration,words[end-1]['end']+.08)
    if end<len(words): b=min(b,words[end]['start']-.055)
    assert b>a
    events.append(f'{len(events)+1}\n{stamp(a)} --> {stamp(b)}\n'+ '\n'.join(lines))
    start=end
(folder/'captions.srt').write_text('\n\n'.join(events)+'\n',encoding='utf-8')
groups=[
 'OBS inside OBS? Capture the other screen. That repeating tunnel happens because the captured display contains the preview.',
 'Keep OBS on one monitor with your producer controls. Show your work on the other.',
 "Check the capture source's display selection instead of trusting the monitor number.",
 'Record a short sample and watch it back. You should see your work without another OBS window inside it.',
 'Follow for the next practical build.'
]
assert ' '.join(groups)==script
starts=[0.0]; n=0
for group in groups[:-1]:
    n+=len(group.split())
    starts.append(max(starts[-1]+.1,words[n]['start']-.04))
durations=[b-a for a,b in zip(starts,starts[1:]+[duration])]
(folder/'scene-timing.json').write_text(json.dumps(durations,indent=2),encoding='utf-8')
plan=json.loads((folder/'SHOT-PLAN.json').read_text(encoding='utf-8'))
for shot,text,begin,length in zip(plan['shots'],groups,starts,durations):
    shot.update(voice_text=text,start_seconds=begin,duration_seconds=length)
plan.update(script_sha256=hashlib.sha256(script.encode()).hexdigest(),timing_status='Derived from actual generated audio with local word recognition; normalized word sequence exactly matches the source.',status='Audio, captions and scene timing ready; publication rights and presenter format remain unresolved.')
(folder/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2),encoding='utf-8')
rate=48000
t=np.arange(round(duration*rate))/rate
bed=np.zeros_like(t)
beat=60/96
notes=[164.8138,195.9977,220.0,195.9977]
for i,start_t in enumerate(np.arange(0,duration,beat*2)):
    local=t-start_t
    gate=(local>=0)&(local<1.0)
    phase=local[gate]
    env=(1-np.exp(-phase*28))*np.exp(-phase*4.5)
    frequency=notes[i%4]
    bed[gate]+=0.018*env*(np.sin(2*np.pi*frequency*phase)+.2*np.sin(4*np.pi*frequency*phase))
for start_t in starts[1:]:
    local=t-start_t
    gate=(local>=0)&(local<.10)
    phase=local[gate]
    bed[gate]+=.025*np.sin(2*np.pi*(700*phase-2200*phase**2))*np.exp(-phase*35)
bed*=np.minimum(t/.4,1)*np.minimum((duration-t)/.4,1)
stereo=np.column_stack([bed,bed*.96])
with wave.open(str(folder/'original-music-and-cuts.wav'),'wb') as f:
    f.setnchannels(2); f.setsampwidth(2); f.setframerate(rate)
    f.writeframes((np.clip(stereo,-1,1)*32767).astype('<i2').tobytes())
report={'duration':duration,'caption_cues':len(events),'source_word_match':'exact after punctuation normalization','hook_end_seconds':words[6]['end'],'scene_starts':starts,'original_sound':'Locally synthesized original motif and four transition ticks; no external recording used.','human_listening_review':'Not claimed; voice likeness and pronunciation should be listened to by the user.','commercial_publication':'Held pending Fish usage rights.'}
(folder/'narration-alignment-check.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps(report))
