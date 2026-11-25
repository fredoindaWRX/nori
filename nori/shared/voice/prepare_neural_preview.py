"""Audition existing local neural-voice assets; importing never downloads models."""
from pathlib import Path
import hashlib
import json
import sys

_NORI = Path(__file__).resolve().parents[2]
if str(_NORI) not in sys.path:
    sys.path.insert(0, str(_NORI))
from security.hard_floor import load_hard_floor, require_owner_download_authority


def main():
    load_hard_floor()
    root = Path(__file__).resolve().parents[3]
    assets = root / 'data/voice-models/kokoro-v1'
    names = ('kokoro-v1.0.onnx', 'voices-v1.0.bin')
    if any(not (assets / name).is_file() for name in names):
        # Owner authority and verified transport must be provided by a future
        # trusted download host. A CLI flag is not proof of either.
        require_owner_download_authority()
    records = [{'file': name, 'bytes': (assets / name).stat().st_size,
                'sha256': hashlib.sha256((assets / name).read_bytes()).hexdigest()}
               for name in names]
    from kokoro_onnx import Kokoro
    import soundfile as sf
    engine = Kokoro(str(assets / names[0]), str(assets / names[1]))
    output = root / 'NORI/Logs/voice-audition'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'local-assets.json').write_text(json.dumps({'purpose': 'local voice audition',
        'downloaded': False, 'files': records}, indent=2))
    text = "Hey, I'm Nori. It's good to hear from you. What are we working on today? Take your time. I'm listening."
    for voice in ('af_heart', 'af_sarah'):
        samples, rate = engine.create(text, voice=voice, speed=1.0, lang='en-us')
        path = output / (voice + '.wav')
        sf.write(str(path), samples, rate, subtype='PCM_16')
        print(json.dumps({'voice': voice, 'seconds': len(samples) / rate,
                         'sample_rate': rate, 'path': str(path)}), flush=True)


if __name__ == '__main__':
    main()
