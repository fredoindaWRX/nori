"""Persistent local Kokoro speech worker for the N.O.R.I. v2 bridge.

The model is loaded once, then newline-delimited JSON requests are answered on
stdout. Keeping the process alive avoids paying the model's multi-second load
cost for every sentence in a conversation.
"""
from __future__ import annotations

import audioop
import base64
from io import BytesIO
import json
from pathlib import Path
import sys
import wave

import numpy as np
from kokoro_onnx import Kokoro


def response(request: dict, engine: Kokoro) -> dict:
    request_id = request.get("id")
    text = request.get("text")
    if not isinstance(request_id, str) or not request_id:
        raise ValueError("request id is required")
    if not isinstance(text, str) or not text.strip() or len(text) > 2000:
        raise ValueError("speech text must contain 1..2000 characters")

    expression = request.get("expression", {})
    defaults = {"speed": 1.0, "sentencePause": 0.2, "clausePause": 0.08, "pitch": 1.02}
    if not isinstance(expression, dict) or set(expression) != set(defaults):
        if expression == {}:
            expression = defaults
        else:
            raise ValueError("speech expression is invalid")
    bounds = {"speed": (0.94, 1.04), "sentencePause": (0.18, 0.3),
              "clausePause": (0.07, 0.14), "pitch": (0.98, 1.06)}
    for name, (minimum, maximum) in bounds.items():
        value = expression[name]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not minimum <= value <= maximum:
            raise ValueError("speech expression is outside supported bounds")

    samples, rate, _ = engine.create_timed(
        text.strip(),
        voice="af_heart",
        speed=expression["speed"],
        lang="en-us",
        sentence_pause=expression["sentencePause"],
        clause_pause=expression["clausePause"],
        continuous=True,
    )
    if not np.isfinite(samples).all():
        raise ValueError("speech renderer returned invalid audio")

    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes()
    pcm, _ = audioop.ratecv(pcm, 2, 1, rate, 24000, None)
    output = BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setparams((1, 2, 24000, 0, "NONE", "not compressed"))
        wav.writeframes(pcm)
    return {
        "id": request_id,
        "audio": base64.b64encode(output.getvalue()).decode("ascii"),
        "content_type": "audio/wav",
    }


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: kokoro_tts.py MODEL VOICES")
    model, voices = map(Path, sys.argv[1:])
    engine = Kokoro(str(model), str(voices))
    print(json.dumps({"ready": True}), flush=True)

    for line in sys.stdin:
        request_id = None
        try:
            request = json.loads(line)
            request_id = request.get("id") if isinstance(request, dict) else None
            result = response(request, engine)
        except Exception as error:  # Keep later speech requests alive.
            result = {"id": request_id, "error": type(error).__name__}
        print(json.dumps(result, separators=(",", ":")), flush=True)


if __name__ == "__main__":
    main()
