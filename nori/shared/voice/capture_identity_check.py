"""Capture a labelled diagnostic sample locally; retain scores, not raw audio."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
import time
import numpy as np
import sounddevice as sd

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT))
from voice_identity_backend_v1 import SpeakerVerifier


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('condition',choices=['owner','tv','other'])
    args=parser.parse_args()
    device=sd.query_devices(kind='input')
    rate=int(device['default_samplerate'])
    verifier=SpeakerVerifier()
    owner=np.load(ROOT/'data/voice_identity/owner_embedding.npy',allow_pickle=False)
    instruction = 'stay quiet while the TV plays' if args.condition == 'tv' else 'speak naturally'
    print(f'Capture begins in 3 seconds; {instruction} for 12 seconds.',flush=True)
    time.sleep(3)
    audio=sd.rec(rate*12,samplerate=rate,channels=1,dtype='float32')
    sd.wait()
    audio=audio[:,0]
    scores=[]
    for segment in np.array_split(audio,3):
        rms=float(np.sqrt(np.mean(segment**2)))
        item={'rms':rms,'peak':float(np.max(np.abs(segment)))}
        if rms<.002: item['status']='insufficient_audio'
        else:
            item.update(status='scored',similarity=verifier.similarity(owner,verifier.embed(segment,rate)))
        scores.append(item)
    report={'condition':args.condition,'captured_at':datetime.now(timezone.utc).isoformat(),
            'device':device['name'],'sample_rate':rate,'segments':scores,'raw_audio_retained':False,
            'profile_changed':False}
    folder=ROOT/'nori/runtime-data/readiness-check';folder.mkdir(parents=True,exist_ok=True)
    path=folder/(f'voice-{args.condition}-'+str(time.time_ns())+'.json')
    path.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report,indent=2))
    print('Report:',path)


if __name__=='__main__': main()
