import json
import wave
from pathlib import Path

from generate_sonic_identity import CUES, RATE, generate


def test_generated_palette_is_complete_pcm_and_original(tmp_path):
    manifest = generate(tmp_path)
    assert manifest['schema'] == 'nori.sonic-identity.v1'
    assert manifest['ownership'].startswith('Original procedurally synthesized NORI')
    assert {item['cue'] for item in manifest['cues']} == set(CUES)
    for item in manifest['cues']:
        with wave.open(str(tmp_path / item['file']), 'rb') as source:
            assert source.getframerate() == RATE
            assert source.getnchannels() == 1
            assert source.getsampwidth() == 2
            assert source.getnframes() > RATE // 2


def test_checked_in_manifest_matches_generator(tmp_path):
    generated = generate(tmp_path)
    checked_in = json.loads((Path(__file__).with_name('cues') / 'sonic-identity.json').read_text())
    assert checked_in == generated
