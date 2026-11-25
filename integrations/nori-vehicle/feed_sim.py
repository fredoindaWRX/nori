"""Fake engine, for testing the bridge with NO car connected. Sends realistic live frames to :9090/live
so you can see Nori diagnose a running engine. NOT real data. Use feed_elm327.py for an actual vehicle.

  python feed_sim.py            healthy idle -> light revs
  python feed_sim.py --fault    same, but fuel trims run lean so Nori catches it
"""
import json, math, sys, time
from urllib.request import Request, urlopen

URL = "http://127.0.0.1:9090/live"
FAULT = "--fault" in sys.argv


def post(frame, dtcs=None, vehicle=None):
    body = {"frame": frame}
    if dtcs is not None:
        body["dtcs"] = dtcs
    if vehicle is not None:
        body["vehicle"] = vehicle
    try:
        urlopen(Request(URL, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}), timeout=5).read()
    except Exception as error:
        print("post failed:", type(error).__name__, "- is bridge.py running?")


def main():
    print("feeding simulated engine to the bridge (Ctrl+C to stop)" + ("  [LEAN FAULT injected]" if FAULT else ""))
    t = 0
    post({}, dtcs=([] if not FAULT else ["P0171 System too lean (Bank 1)"]),
         vehicle="SIMULATED 2.5L Turbo (test, not a real car)")
    while True:
        rev = 850 + 650 * max(0, math.sin(t / 7))           # idle ~850, light revs to ~1500
        load = 18 + 22 * max(0, math.sin(t / 7))
        frame = {
            "rpm": round(rev),
            "speed": 0,
            "coolant": round(min(92, 40 + t * 1.6), 1),      # warms up to 92C
            "intake_temp": 28,
            "throttle": round(12 + 10 * max(0, math.sin(t / 7)), 1),
            "load": round(load, 1),
            "maf": round(3.5 + rev / 500, 1),
            "stft1": round((6.0 if not FAULT else 21.5) + 1.5 * math.sin(t), 1),
            "ltft1": round((3.0 if not FAULT else 18.0), 1),
            "o2_b1s1": round(0.45 + 0.35 * math.sin(t * 1.3), 2),
            "timing": round(12 + 6 * max(0, math.sin(t / 7)), 1),
            "volt": round(14.1 + 0.2 * math.sin(t / 3), 1),
        }
        post(frame)
        print(f"rpm {frame['rpm']:>4}  coolant {frame['coolant']:>4}C  STFT {frame['stft1']:>5}%  O2 {frame['o2_b1s1']}V")
        t += 1
        time.sleep(1.0)


if __name__ == "__main__":
    main()
