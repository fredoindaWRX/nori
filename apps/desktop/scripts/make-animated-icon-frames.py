"""Export compact taskbar/tray animation frames from Nori's approved globe clip."""
from pathlib import Path
import sys

import cv2
from PIL import Image, ImageEnhance

source = Path(sys.argv[1])
output = Path(sys.argv[2])
frame_count = int(sys.argv[3]) if len(sys.argv) > 3 else 16
output.mkdir(parents=True, exist_ok=True)
capture = cv2.VideoCapture(str(source))
total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
if total < 1:
    raise RuntimeError(f"Could not read {source}")

for i in range(frame_count):
    # Skip a tiny fraction at either end to avoid any fade-in/fade-out frames.
    index = round(total * (.04 + .92 * i / frame_count))
    capture.set(cv2.CAP_PROP_POS_FRAMES, index)
    ok, frame = capture.read()
    if not ok:
        raise RuntimeError(f"Could not decode frame {index}")
    frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    image = Image.fromarray(frame).convert('RGBA')
    image = ImageEnhance.Contrast(image).enhance(1.08)
    image.resize((256, 256), Image.Resampling.LANCZOS).save(output / f"frame-{i:02d}.png", "PNG", optimize=True)
capture.release()
print(f"Created {frame_count} animated Nori icon frames in {output}")
