"""Transcribe real narration locally and save word timestamps for editorial review."""
import argparse
import json
from pathlib import Path
from faster_whisper import WhisperModel

parser=argparse.ArgumentParser()
parser.add_argument('audio',type=Path)
parser.add_argument('--model',default='small.en')
args=parser.parse_args()
model=WhisperModel(args.model,device='cpu',compute_type='int8',cpu_threads=8,download_root='C:/Nori/streaming/tools/asr-models')
segments,info=model.transcribe(str(args.audio),language='en',beam_size=5,word_timestamps=True,vad_filter=True)
rows=[]
for s in segments:
    rows.append({'start':s.start,'end':s.end,'text':s.text,'words':[{'start':w.start,'end':w.end,'word':w.word,'probability':w.probability} for w in s.words]})
result={'model':args.model,'language':info.language,'duration':info.duration,'segments':rows}
path=args.audio.with_suffix('.transcript.json')
path.write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps({'path':str(path),'text':' '.join(s['text'].strip() for s in rows),'duration':info.duration}))
