"""Feed a Foxwell i50 recording (or its live record_temp) to the bridge, so Nori diagnoses the i50's own
data - no extra hardware. Uses foxwell_decode (format read from the app's own code).

  python feed_foxwell.py <recording.txt>              replay the whole recording to the bridge, 1 frame/sec
  python feed_foxwell.py <recording.txt> --fast       replay as fast as the model keeps up
  python feed_foxwell.py --pull                        pull the newest recording off the tablet, then replay

A later step can point this at a live-growing record_temp to stream a diagnosis while the car runs.
"""
import json, subprocess, sys, time
from urllib.request import Request, urlopen
from foxwell_decode import decode

URL = "http://127.0.0.1:9090/live"
ADB = r"C:\Nori\tools\platform-tools\adb.exe"


def post(body):
    try:
        urlopen(Request(URL, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}), timeout=5).read()
    except Exception as error:
        print("post failed:", type(error).__name__, "- is bridge.py running?")


def pull_newest(dest="latest-recording.txt"):
    newest = subprocess.run([ADB, "shell", "ls -t /sdcard/Foxwell/i50/Record/*.txt | head -1"],
                            capture_output=True, text=True).stdout.strip()
    if not newest:
        sys.exit("no recording found on the tablet")
    subprocess.run([ADB, "pull", newest, dest], check=True)
    print("pulled", newest)
    return dest


def main():
    args = sys.argv[1:]
    fast = "--fast" in args
    args = [a for a in args if a != "--fast"]
    path = pull_newest() if (args and args[0] == "--pull") else (args[0] if args else None)
    if not path:
        sys.exit(__doc__)
    columns, frames = decode(path)
    print(f"{len(frames)} frames decoded; replaying to the bridge"
          + ("" if fast else " at 1/sec") + "  (Ctrl+C to stop)")
    vehicle = "Foxwell i50 recording: " + path.split("\\")[-1]
    post({"vehicle": vehicle, "frame": {}})
    for n, frame in enumerate(frames):
        post({"frame": frame})
        if n % 10 == 0:
            print(f"frame {n:4}/{len(frames)}  rpm {frame.get('rpm','-')}  coolant {frame.get('coolant','-')}  "
                  f"stft1 {frame.get('stft1','-')}")
        if not fast:
            time.sleep(1.0)


if __name__ == "__main__":
    main()
