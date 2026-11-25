import hashlib
import json
from pathlib import Path
import re

ROOT=Path('C:/Nori/streaming/channel-operator')
out=ROOT/'03-Production/Fish-Ready-Scripts'
manifest=[]
for path in sorted((ROOT/'02-Calendar').glob('Week-*/*/narration.txt')):
    text=path.read_text(encoding='utf-8-sig').strip()
    sentences=re.split(r'(?<=[.!?])\s+',text)
    chunks=[]
    current=''
    for sentence in sentences:
        if len(sentence)>500:
            for word in sentence.split():
                joined=f'{current} {word}'.strip()
                if len(joined)>500:
                    chunks.append(current); current=word
                else: current=joined
        else:
            joined=f'{current} {sentence}'.strip()
            if len(joined)>500 and current:
                chunks.append(current); current=sentence
            else: current=joined
    if current: chunks.append(current)
    assert all(0<len(chunk)<=500 for chunk in chunks)
    assert ' '.join(' '.join(chunks).split())==' '.join(text.split())
    directory=out/path.parent.name
    directory.mkdir(parents=True,exist_ok=True)
    for i,chunk in enumerate(chunks,start=1):
        (directory/f'speech-{i:02d}.txt').write_text(chunk,encoding='utf-8')
    manifest.append({'video_id':path.parent.name,'model_id':'b27ff51a95a14d02973baec32ba7a643','voice_name':'fred','chunks':len(chunks),'characters_per_chunk':[len(c) for c in chunks],'script_sha256':hashlib.sha256(text.encode()).hexdigest(),'status':'Prepared text only; not generated. Check account allowance before submitting batches.'})
(out/'GENERATION-QUEUE.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
(out/'README.txt').write_text('All 12 narration scripts are organized for the existing Fish Audio voice fred. Each text chunk is at most 500 characters, matching the limit shown while signed out. Text is complete and checked against its narration source; no audio is present. Once signed in, verify account allowance, model selection, applicable rights and the actual per-generation limit. Render in order, review words and pronunciation, and join chunks before subtitle alignment. Do not purchase credits or an upgrade without a user-authorized budget.\n',encoding='utf-8')
print(json.dumps({'videos':len(manifest),'prepared_speech_chunks':sum(v['chunks'] for v in manifest),'longest_chunk':max(max(v['characters_per_chunk']) for v in manifest),'text_integrity':'passed'}))
