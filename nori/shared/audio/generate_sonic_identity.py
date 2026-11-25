"""Generate NORI's original, redistributable system sound palette."""
from __future__ import annotations

import json
import math
import random
import struct
import wave
from pathlib import Path

RATE = 48_000
PEAK = 0.78


def _fade(t: float, duration: float, attack: float = .025, release: float = .12) -> float:
    return min(1.0, t / attack, max(0.0, (duration - t) / release))


def _tone(t: float, frequency: float, phase: float = 0.0) -> float:
    return math.sin(2 * math.pi * frequency * t + phase)


def _write(path: Path, duration: float, synth) -> None:
    frames = []
    rng = random.Random(path.stem)
    for index in range(round(duration * RATE)):
        t = index / RATE
        sample = max(-1.0, min(1.0, synth(t, duration, rng))) * PEAK
        frames.append(struct.pack('<h', round(sample * 32767)))
    with wave.open(str(path), 'wb') as output:
        output.setparams((1, 2, RATE, len(frames), 'NONE', 'not compressed'))
        output.writeframes(b''.join(frames))


def home_start(t, d, _):
    sweep = 105 + 210 * (t / d) ** 1.5
    light = 528 if t > .42 else 396
    return _fade(t, d, .05, .28) * (.42 * _tone(t, sweep) + .22 * _tone(t, sweep * 2.01) + .25 * _tone(t, light))


def server_start(t, d, _):
    step = (82.41, 110.0, 164.81, 220.0)[min(3, int(t / (d / 4)))]
    pulse = .65 + .35 * math.sin(2 * math.pi * 3.2 * t) ** 2
    return _fade(t, d, .06, .32) * pulse * (.5 * _tone(t, step) + .22 * _tone(t, step * 2) + .12 * _tone(t, step * 3))


def owner_verified(t, d, _):
    freq = 440 if t < .13 else 659.25 if t < .27 else 880
    return _fade(t, d, .008, .13) * (.52 * _tone(t, freq) + .16 * _tone(t, freq * 2))


def knight_dispatch(t, d, _):
    freq = 180 + 1050 * (t / d)
    gate = .35 + .65 * (math.sin(2 * math.pi * 12 * t) > 0)
    return _fade(t, d, .01, .12) * gate * (.45 * _tone(t, freq) + .16 * _tone(t, freq * 1.5))


def task_complete(t, d, _):
    notes = (523.25, 659.25, 783.99, 1046.5)
    idx = min(3, int(t / (d / 4)))
    return _fade(t % (d / 4), d / 4, .006, .09) * (.5 * _tone(t, notes[idx]) + .13 * _tone(t, notes[idx] * 2))


def warning(t, d, _):
    freq = 146.83 if int(t / .16) % 2 == 0 else 196.0
    return _fade(t, d, .01, .14) * (.48 * _tone(t, freq) + .18 * _tone(t, freq * 1.997))


def watchman(t, d, rng):
    descending = 240 - 105 * (t / d)
    noise = rng.uniform(-1, 1) * .055
    gate = .3 + .7 * (math.sin(2 * math.pi * 5 * t) > -.15)
    return _fade(t, d, .012, .2) * gate * (.48 * _tone(t, descending) + .18 * _tone(t, descending * 1.5) + noise)


CUES = {
    'home-start': (1.55, home_start, 'Home NORI presence forming'),
    'server-start': (2.2, server_start, 'Ghost Server One coming online'),
    'owner-verified': (.58, owner_verified, 'Owner identity accepted'),
    'knight-dispatch': (.72, knight_dispatch, 'Round Table task dispatched'),
    'task-complete': (.82, task_complete, 'Task completed and verified'),
    'warning': (.84, warning, 'Action needs attention'),
    'watchman-intervention': (1.15, watchman, 'Robotics Watchman safe-state intervention'),
}


def generate(destination: Path) -> dict:
    destination.mkdir(parents=True, exist_ok=True)
    records = []
    for cue, (duration, synth, purpose) in CUES.items():
        filename = f'nori-{cue}.wav'
        _write(destination / filename, duration, synth)
        records.append({'cue': cue, 'file': filename, 'purpose': purpose,
                        'duration_ms': round(duration * 1000)})
    manifest = {
        'schema': 'nori.sonic-identity.v1',
        'identity': 'NORI Neon Circuit',
        'ownership': 'Original procedurally synthesized NORI system audio',
        'sample_rate_hz': RATE,
        'channels': 1,
        'sample_format': 'PCM16',
        'cues': records,
    }
    (destination / 'sonic-identity.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    return manifest


if __name__ == '__main__':
    generate(Path(__file__).with_name('cues'))
