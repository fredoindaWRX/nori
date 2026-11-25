"""Verify one captured utterance using the persistent local owner profile.

Run with the existing voice_identity_v1 environment. Never enrolls, overwrites
thresholds, or grants high-risk authorization. Raw audio is owned by caller.
"""
import argparse
import json
import os
from pathlib import Path
import sys

ROOT = Path(os.environ['NORI_ROOT']) if os.environ.get('NORI_ROOT') else next(
    (p for p in Path(__file__).resolve().parents if (p/'data/voice_identity/owner_profile.json').is_file()),
    Path(__file__).resolve().parents[3])
sys.path.insert(0, str(ROOT))


def verify(wav, root=ROOT):
    profile_path = root/'data/voice_identity/owner_profile.json'
    if not profile_path.exists():
        return {'accepted':False,'reason':'owner_not_enrolled'}
    profile = json.loads(profile_path.read_text(encoding='utf-8'))
    if profile.get('calibrated') is not True:
        return {'accepted':False,'reason':'owner_profile_not_calibrated'}
    from voice_identity_backend_v1 import SpeakerVerifier, load_wav
    audio, rate = load_wav(wav)
    verifier = SpeakerVerifier()
    result = verifier.verify_embedding(verifier.embed(audio, rate))
    result['audio_seconds'] = round(len(audio)/rate, 3)
    result['sample_rate'] = rate
    return result


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('wav')
    args=parser.parse_args()
    try:
        print(json.dumps(verify(args.wav)))
    except Exception as exc:
        print(json.dumps({'accepted':False,'reason':'verification_unavailable','error':type(exc).__name__}))
        sys.exit(1)
