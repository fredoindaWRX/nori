"""Decode a Foxwell i50 live-data recording (/sdcard/Foxwell/i50/Record/*.txt) into real frames.

Format read straight from the Foxwell app's own code (DataStreamDiagData.ItemInfo, 2026-11-25):
  - Fields within one parameter are joined by U+258F ("▏"): id ▏ label ▏ refValue ▏ unit ▏ help
  - Parameters / values are joined by U+258E ("▎").
The file is: a header of fixed columns (one per parameter, in order), then a body of variable columns
(just the value), one value per parameter per time-sample. Row width = number of header columns.

  python foxwell_decode.py <recording.txt>
  from foxwell_decode import decode -> (columns, frames)   frames = [{pid_key: value}, ...]
"""
import re, sys

ITEM = "▎"   # between parameters / values
FIELD = "▏"  # within a parameter

PID_MAP = [
    (r"calculated load", "load"), (r"coolant temperature", "coolant"),
    (r"short term fuel trim - bank 1", "stft1"), (r"long term fuel trim - bank 1", "ltft1"),
    (r"short term fuel trim - bank 2", "stft2"), (r"long term fuel trim - bank 2", "ltft2"),
    (r"intake manifold absolute pressure", "map"), (r"\bengine rpm\b", "rpm"),
    (r"vehicle speed", "speed"), (r"ignition timing advance", "timing"),
    (r"intake air temperature", "intake_temp"), (r"air flow rate from mass air flow", "maf"),
    (r"absolute throttle position", "throttle"),
    (r"oxygen sensor output voltage bank 1 - sensor 1", "o2_b1s1"),
    (r"control module voltage", "volt"),
]


def _key(label):
    low = label.lower()
    for pat, key in PID_MAP:
        if re.search(pat, low):
            return key
    return None


def _num(s):
    s = s.strip()
    if re.fullmatch(r"-?\d+\.\d+", s):
        return float(s)
    if re.fullmatch(r"-?\d+", s):
        return int(s)
    return s or None   # keep non-numeric status strings as-is


def decode(path):
    raw = open(path, "rb").read().decode("utf-8", "replace")
    chunks = raw.split(ITEM)
    columns, body_start = [], 0
    for i, c in enumerate(chunks):
        # a header column is "<id>▏<label>▏<ref>▏<unit>▏<help>"
        m = re.match(r"[^\d-]*(\d+)" + FIELD + r"(.*?)" + FIELD + r"(.*?)" + FIELD + r"(.*?)" + FIELD + r"(true|false)\s*$", c, re.S)
        if m and int(m.group(1)) == len(columns):
            columns.append({"id": int(m.group(1)), "label": m.group(2).strip(),
                            "range": m.group(3).strip(), "unit": m.group(4).strip(), "key": _key(m.group(2))})
            body_start = i + 1
    width = len(columns)
    if width == 0:
        return columns, []
    values = [_num(c) for c in chunks[body_start:]]
    # trim trailing junk, then take whole rows of `width`
    rows = [values[i:i + width] for i in range(0, (len(values) // width) * width, width)]
    frames = []
    for row in rows:
        frame = {}
        for col, val in zip(columns, row):
            if col["key"] and isinstance(val, (int, float)):
                frame[col["key"]] = val
        if frame:
            frames.append(frame)
    return columns, frames


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: foxwell_decode.py <recording.txt>")
    columns, frames = decode(sys.argv[1])
    print(f"{len(columns)} columns, {len(frames)} frames")
    print("columns:", ", ".join(f"{c['label']}{('/'+c['key']) if c['key'] else ''}" for c in columns[:14]))
    if frames:
        for key in ("rpm", "coolant", "map", "maf", "throttle"):
            seq = [f[key] for f in frames if key in f]
            if seq:
                print(f"{key:8}: first {seq[:5]}  last {seq[-5:]}  min {min(seq)} max {max(seq)}")
        print("frame 0 :", frames[0])
        print("last    :", frames[-1])


if __name__ == "__main__":
    main()
