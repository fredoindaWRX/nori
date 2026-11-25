"""Persistent local speech-to-text worker for the N.O.R.I. bridge.

Loads a faster-whisper model once and keeps it warm, then transcribes one audio
file per line read from stdin, writing one JSON object per line to stdout. Kept
warm on purpose: reloading the model per request is what makes local Whisper
feel slow, so the bridge spawns this once and streams paths to it.

Protocol:
  stdin  : one absolute audio-file path per line
  stdout : {"ready": true}            once, when the model is loaded
           {"text": "..."}            per transcribed path (text may be "")
           {"error": "..."}           if a single transcription failed

Model and compute type come from the environment so the bridge can tune them:
  NORI_WHISPER_MODEL   default "base.en"  (tiny.en is faster, small.en sharper)
  NORI_WHISPER_COMPUTE default "int8"     (int8 is fast on Apple Silicon CPU)
"""

import json
import os
import sys


def decoder_audio(audio):
    """Give tightly VAD-trimmed speech decoder context without inventing words."""
    import numpy as np
    if not audio.size or not audio.any():
        return None
    # Half a second at each edge preserves leading wake names on short clips.
    return np.pad(audio, (8000, 8000), mode="constant")


def main() -> int:
    try:
        from faster_whisper import WhisperModel
        from faster_whisper.audio import decode_audio
    except Exception as exc:  # noqa: BLE001 - report and exit, the bridge falls back
        sys.stdout.write(json.dumps({"error": f"faster-whisper not available: {exc}"}) + "\n")
        sys.stdout.flush()
        return 1

    model_name = os.environ.get("NORI_WHISPER_MODEL", "base.en")
    compute = os.environ.get("NORI_WHISPER_COMPUTE", "int8")
    try:
        model = WhisperModel(model_name, device="cpu", compute_type=compute, local_files_only=True)
    except Exception as exc:  # noqa: BLE001
        sys.stdout.write(json.dumps({"error": f"could not load model {model_name}: {exc}"}) + "\n")
        sys.stdout.flush()
        return 1

    sys.stdout.write(json.dumps({"ready": True, "model": model_name}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        path = line.strip()
        if not path:
            continue
        try:
            # The browser's VAD already trimmed silence around the utterance, so
            # no vad_filter here (it would add an onnxruntime dependency for no
            # gain). English is pinned; N.O.R.I. is spoken to in English.
            # Decoder vocabulary hint, not a forced transcript or wake event.
            # Preserve actual model output; never prepend Nori to missing words.
            audio = decoder_audio(decode_audio(path, sampling_rate=16000))
            if audio is None:
                segments = [] # Exactly digital silence; do not threshold quiet speech.
            else:
                segments, _info = model.transcribe(audio, language="en", beam_size=1, hotwords="Nori")
            text = "".join(seg.text for seg in segments).strip()
            sys.stdout.write(json.dumps({"text": text}) + "\n")
        except Exception as exc:  # noqa: BLE001 - one bad clip must not kill the worker
            sys.stdout.write(json.dumps({"error": str(exc)}) + "\n")
        finally:
            sys.stdout.flush()
            # The bridge owns and cleans its temporary recording directory.
            # A transcription worker must never delete arbitrary caller paths.

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
