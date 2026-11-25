import argparse,json
from pathlib import Path
from faster_whisper import WhisperModel
p=argparse.ArgumentParser();p.add_argument('audio',type=Path);a=p.parse_args()
cached=Path('C:/Users/Studio/.cache/huggingface/hub/models--Systran--faster-whisper-base.en/snapshots')
snapshots=[v for v in cached.iterdir() if (v/'model.bin').exists()]
assert len(snapshots)==1
m=WhisperModel(str(snapshots[0]),device='cpu',compute_type='int8',cpu_threads=8,local_files_only=True)
segments,info=m.transcribe(str(a.audio),language='en',beam_size=5,word_timestamps=True,vad_filter=True)
rows=[{'start':s.start,'end':s.end,'text':s.text,'words':[{'start':w.start,'end':w.end,'word':w.word,'probability':w.probability} for w in s.words]} for s in segments]
out=a.audio.with_suffix('.base-en.transcript.json');out.write_text(json.dumps({'model':'base.en independent, cached locally','duration':info.duration,'segments':rows},indent=2),encoding='utf-8')
print(json.dumps({'path':str(out),'text':' '.join(s['text'].strip() for s in rows)}))
