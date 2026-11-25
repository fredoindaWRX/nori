"""Export a few representative frames from a user-supplied video for icon selection."""
from pathlib import Path
import sys

import cv2

source = Path(sys.argv[1])
output = Path(sys.argv[2])
output.mkdir(parents=True, exist_ok=True)
capture = cv2.VideoCapture(str(source))
total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
for label, index in (("start", 0), ("middle", max(0, total // 2)), ("end", max(0, total - 1))):
    capture.set(cv2.CAP_PROP_POS_FRAMES, index)
    ok, frame = capture.read()
    if not ok:
        raise RuntimeError(f"Could not decode frame {index} from {source}")
    cv2.imwrite(str(output / f"{label}.png"), frame)
capture.release()
print(f"Exported {total} frames worth of video metadata to {output}")
