"""NORI local neural speech adapter with model-reported phoneme timing."""
import argparse
import audioop
import json
import math
from pathlib import Path
import wave

# Map IPA articulation to the existing NORI/Windows viseme index contract.
# Timing is from model durations; this mapping is an approximate mouth pose.
GROUPS = ((21, 'pbm'), (18, 'fv'), (17, 'θð'), (19, 'tdn'),
          (20, 'kɡgŋ'), (15, 'sz'), (16, 'ʃʒʧʤ'), (14, 'l'),
          (13, 'ɹrɻ'), (7, 'wuʊ'), (6, 'ijɪ'), (4, 'ɛæe'),
          (3, 'ɔɒo'), (2, 'ɑa'), (1, 'ʌəɐɜ'), (12, 'h'))


def cue_id(phoneme):
    return next((index for index, symbols in GROUPS if phoneme in symbols), 0)


def render(request_file, output, assets, engine=None):
    request = json.loads(request_file.read_text(encoding='utf-8-sig'))
    text = request.get('text')
    if not isinstance(text, str) or not text.strip() or len(text) > 8000:
        raise ValueError('Speech text must contain 1..8000 characters')
    voice = request.get('voice') or 'af_heart'
    if voice not in ('af_heart', 'af_sarah'):
        raise ValueError('Select a configured NORI neural voice')
    if output.exists():
        raise ValueError('Use a new utterance output directory')
    from kokoro_onnx import Kokoro
    import numpy as np
    if engine is None:
        engine = Kokoro(str(assets / 'kokoro-v1.0.onnx'), str(assets / 'voices-v1.0.bin'))
    if not engine.has_timings:
        raise ValueError('This model export cannot provide speech timing')
    samples, rate, timings = engine.create_timed(text, voice=voice, speed=1.0,
        lang='en-us', sentence_pause=.22, clause_pause=.10, continuous=True)
    if not np.isfinite(samples).all() or not timings:
        raise ValueError('Speech renderer returned invalid audio or no timing')
    pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes()
    pcm, _ = audioop.ratecv(pcm, 2, 1, rate, 16000, None)
    duration = len(pcm) / 32
    cues = []
    previous = -1.0
    for timing in timings:
        start, end = timing.start * 1000, timing.end * 1000
        if not all(math.isfinite(v) for v in (start, end)) or start < previous or end < start or end > duration + 1:
            raise ValueError('Invalid model timing')
        cues.append({'start_ms': start, 'duration_ms': max(0, min(end, duration) - start),
                     'id': cue_id(timing.phoneme), 'phoneme': timing.phoneme})
        previous = start
    output.mkdir(parents=True)
    with wave.open(str(output / 'speech.wav'), 'wb') as wav:
        wav.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        wav.writeframes(pcm)
    manifest = {'schema': 1, 'engine': 'kokoro-onnx', 'voice': voice, 'audio': 'speech.wav',
        'visemes': cues, 'timing': 'audio-relative-milliseconds',
        'alignment': 'model-reported-phoneme-durations', 'pose_mapping': 'approximate-ipa-to-viseme-v1'}
    (output / 'speech.json').write_text(json.dumps(manifest, ensure_ascii=False), encoding='utf-8')
    print(output / 'speech.json')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--assets', type=Path, required=True)
    args = parser.parse_args()
    render(args.request, args.output, args.assets)
