"""CPU-only, streaming assembly of qualified Nori video shots. Job arrives on stdin."""
import json
import os
from pathlib import Path
import shutil
import stat
import sys
from fractions import Fraction

MAX_JOB_BYTES = 16 * 1024 * 1024
MAX_CLIPS = 65_536
MIN_FREE_BYTES = 1024 ** 3


def emit(value):
    print(json.dumps(value, separators=(",", ":")), flush=True)


def confined(root, candidate):
    return candidate != root and candidate.is_relative_to(root)


def local_path(value):
    if not isinstance(value, str) or len(value) > 32767 or any(c in value for c in "\0\r\n"):
        raise ValueError("Invalid local video path")
    path = Path(value)
    if not path.is_absolute() or value.startswith(("\\\\", "//")) or ":" in value[2:]:
        raise ValueError("Video path must be an absolute local path")
    return Path(os.path.normpath(value))


def space_available(root):
    if shutil.disk_usage(root).free < MIN_FREE_BYTES:
        raise ValueError("Local video assembly needs at least 1 GiB of remaining disk space")


def main():
    raw = sys.stdin.buffer.read(MAX_JOB_BYTES + 1)
    if len(raw) > MAX_JOB_BYTES:
        raise ValueError("Video assembly manifest exceeds the 16 MiB limit")
    job = json.loads(raw)
    clips = job.get("clips")
    total = job.get("totalFrames")
    fps, width, height = job.get("fps"), job.get("width"), job.get("height")
    shot_frames = {(16, 832, 480): 33, (24, 704, 1280): 121}.get((fps, width, height))
    if shot_frames is None:
        raise ValueError("Video assembly requires a qualified legacy or cinematic profile")
    if (not isinstance(clips, list) or not 1 <= len(clips) <= MAX_CLIPS
            or type(total) is not int or not 1 <= total <= 2**53 - 1
            or (total + shot_frames - 1) // shot_frames != len(clips)):
        raise ValueError("Invalid video frame count or bounded clip list")
    root = local_path(job.get("outputRoot"))
    partial = local_path(job.get("partialPath"))
    paths = [local_path(value) for value in clips]
    # Lexical confinement precedes stat, resolve, import, and decoder access.
    if any(not confined(root, path) or path.suffix.lower() != ".mp4" for path in [*paths, partial]):
        raise ValueError("Video assembly path is outside its local output folder")
    root = root.resolve(strict=True)
    paths = [path.resolve(strict=True) for path in paths]
    actual_partial = partial.resolve(strict=True)
    if any(not confined(root, path) for path in [*paths, actual_partial]):
        raise ValueError("Video assembly path resolves outside its local output folder")
    partial_info = partial.lstat()
    # libuv exposes the Windows volume serial's low 32 bits; CPython exposes all 64.
    # File IDs remain 64-bit in both. Preserve both checks with matching representations.
    device = partial_info.st_dev & 0xffffffff if os.name == "nt" else partial_info.st_dev
    if (not stat.S_ISREG(partial_info.st_mode) or partial_info.st_nlink != 1 or partial_info.st_size != 0
            or str(device) != job.get("partialDevice")
            or str(partial_info.st_ino) != job.get("partialInode")):
        raise ValueError("Video assembly temporary file is not the reserved owned file")
    identities = set()
    for path in paths:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size <= 0:
            raise ValueError("Video input must be an unlinked regular file")
        identity = (info.st_dev, info.st_ino)
        if identity in identities:
            raise ValueError("Repeated clips cannot substitute for newly generated shots")
        identities.add(identity)

    space_available(root)
    import av

    def progress(stage, count):
        emit({"type": "progress", "stage": stage, "frames": count, "totalFrames": total})

    encoded = 0
    progress("assembling", 0)
    # Explicit MOV demuxing forbids playlist/URL format auto-detection. The encoder is CPU libx264.
    with av.open(str(partial), mode="w", format="mp4", options={"movflags": "+faststart"}) as output:
        stream = output.add_stream("libx264", rate=fps)
        stream.width, stream.height = width, height
        stream.pix_fmt = "yuv420p"
        stream.time_base = Fraction(1, fps)
        stream.codec_context.time_base = Fraction(1, fps)
        stream.codec_context.thread_count = 1
        stream.codec_context.max_b_frames = 0
        stream.options = {"crf": "18", "preset": "veryfast", "tune": "zerolatency"}
        for path in paths:
            space_available(root)
            decoded = 0
            previous_time = None
            with av.open(str(path), mode="r", format="mov", options={"enable_drefs": "0"}) as source:
                if len(source.streams.video) != 1:
                    raise ValueError("Video shot must contain exactly one video stream")
                video = source.streams.video[0]
                video.codec_context.thread_count = 1
                if (video.width, video.height) != (width, height) or video.average_rate != Fraction(fps):
                    raise ValueError("Video shot has the wrong dimensions or frame rate")
                for frame in source.decode(video):
                    decoded += 1
                    if decoded > shot_frames:
                        raise ValueError(f"Video shot exceeds the qualified {shot_frames}-frame length")
                    if (frame.width, frame.height) != (width, height) or frame.is_corrupt:
                        raise ValueError("Video shot contains corrupt or wrong-dimension frames")
                    if frame.pts is None or frame.time_base is None:
                        raise ValueError("Video shot has missing frame timestamps")
                    timestamp = frame.pts * frame.time_base
                    if previous_time is not None and timestamp - previous_time != Fraction(1, fps):
                        raise ValueError("Video shot has nonuniform or nonmonotonic timestamps")
                    previous_time = timestamp
                    if encoded < total:
                        frame.pts, frame.time_base = encoded, Fraction(1, fps)
                        for packet in stream.encode(frame):
                            output.mux(packet)
                        encoded += 1
                        if encoded % fps == 0:
                            space_available(root)
                            progress("assembling", encoded)
                    # Do not collect frames; one decoded frame at a time, with bounded codec state.
                if decoded != shot_frames:
                    raise ValueError(f"Video shot is short: expected {shot_frames} frames, decoded {decoded}; no replay or padding is allowed")
        if encoded != total:
            raise ValueError("Video input is shorter than the requested duration; no replay or padding is allowed")
        for packet in stream.encode():
            output.mux(packet)
    progress("assembling", encoded)

    verified = 0
    progress("verifying", 0)
    with av.open(str(partial), mode="r", format="mov", options={"enable_drefs": "0"}) as output:
        if len(output.streams.video) != 1 or output.streams.audio:
            raise ValueError("Final video has an unexpected stream layout")
        stream = output.streams.video[0]
        stream.codec_context.thread_count = 1
        if (stream.width, stream.height) != (width, height) or stream.average_rate != Fraction(fps):
            raise ValueError("Final video dimensions or frame rate did not verify")
        if stream.codec_context.name != "h264":
            raise ValueError("Final video is not H.264")
        for frame in output.decode(stream):
            if frame.is_corrupt or (frame.width, frame.height) != (width, height):
                raise ValueError("Final video contains corrupt or wrong-dimension frames")
            if frame.pts is None or frame.time_base is None or frame.pts * frame.time_base != Fraction(verified, fps):
                raise ValueError("Final video does not have exact monotonic frame timestamps")
            verified += 1
            if verified % fps == 0:
                progress("verifying", verified)
        if verified != total or stream.duration is None or stream.duration * stream.time_base != Fraction(total, fps):
            raise ValueError("Final video frame count or duration did not verify")
    progress("verifying", verified)
    emit({"type": "result", "frameCount": verified, "durationSeconds": verified / fps,
          "fps": fps, "width": width, "height": height})


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr, flush=True)
        sys.exit(1)
