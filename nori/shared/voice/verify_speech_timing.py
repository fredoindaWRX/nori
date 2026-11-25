"""Validate generated audio and viseme ranges without playing audio."""
import json
import sys
import wave
from pathlib import Path

folder=Path(sys.argv[1])
manifest=json.loads((folder/'speech.json').read_text(encoding='utf-8-sig'))
with wave.open(str(folder/'speech.wav'),'rb') as audio:
    assert audio.getnchannels()==1 and audio.getsampwidth()==2
    assert audio.getframerate()==16000
    duration=audio.getnframes()/audio.getframerate()*1000
    frames=audio.readframes(audio.getnframes())
    assert duration>0 and any(frames), 'Empty or silent audio'
events=manifest['visemes']
assert events, 'No timing events'
previous=-1
for event in events:
    start=event['start_ms']; length=event['duration_ms']
    assert previous<=start<=duration and length>=0
    assert start+length<=duration+1, 'Event extends beyond audio'
    assert type(event['id']) is int and 0<=event['id']<=21
    previous=start
print(json.dumps({'status':'passed','duration_ms':duration,'visemes':len(events),'voice':manifest['voice']}))
