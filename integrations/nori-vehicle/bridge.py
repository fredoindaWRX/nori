"""Nori vehicle bridge (owner, 2026-11-25: "build the live bridge... diagnose in realtime").

One small local service on :9090 that ties three things together:

  1. A reader (anything) POSTs live OBD frames to  POST /live   as JSON {"rpm":850,"coolant":92,...}.
  2. Nori reads the current frame + any stored scan and gives a running diagnosis (her local model).
  3. A dashboard at  GET /  shows the live values and Nori's verdict; the tablet's WebView app
     (systems.nori.vehicle, which already points here) displays exactly that.

Nothing here talks to a car by itself. A feeder does: feed_elm327.py (a real ELM327 adapter) or
feed_sim.py (a canned engine, for testing with no car). The bridge just receives, diagnoses, serves.

Diagnosis uses Nori's helper model (127.0.0.1:18795) and is throttled so a fast stream does not hammer it.
Her spoken verdict is optional (POST /live?speak=1 or the Speak button) via her Kokoro voice runtime.
Read-only toward the car; it only receives what a feeder sends.
"""
import json, os, re, subprocess, sys, threading, time, wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen

HELPER = os.environ.get("NORI_VEHICLE_MODEL", "http://127.0.0.1:18795")
HELPER_KEY = Path.home() / "AppData" / "Local" / "NoriHelper" / "api-key.txt"
VOICE_PY = r"C:\Nori\runtime\voice\python310\python.exe"
VOICE_PKGS = r"C:\Nori\runtime\voice\packages"
VOICE_MODEL = r"C:\Nori\models\voice\kokoro-v1\kokoro-v1.0.onnx"
VOICE_VOICES = r"C:\Nori\models\voice\kokoro-v1\voices-v1.0.bin"
REPORTS_DIR = os.environ.get("NORI_VEHICLE_REPORTS", r"C:\i50-backup-20261125\Foxwell\i50\Report")
DIAGNOSE_EVERY = 6.0          # seconds between model calls, however fast frames arrive
PORT = int(os.environ.get("NORI_VEHICLE_PORT", "9090"))

# Friendly labels + healthy ranges for the common OBDII live PIDs (from the i50's own menu).
PIDS = {
    "rpm": ("Engine RPM", "rpm", None),
    "speed": ("Vehicle speed", "km/h", None),
    "coolant": ("Coolant temp", "\u00b0C", (0, 110)),
    "intake_temp": ("Intake air temp", "\u00b0C", None),
    "maf": ("Mass air flow", "g/s", None),
    "map": ("Intake manifold pressure", "kPa", None),
    "throttle": ("Throttle position", "%", None),
    "load": ("Calculated load", "%", None),
    "stft1": ("Short-term fuel trim B1", "%", (-10, 10)),
    "ltft1": ("Long-term fuel trim B1", "%", (-10, 10)),
    "stft2": ("Short-term fuel trim B2", "%", (-10, 10)),
    "ltft2": ("Long-term fuel trim B2", "%", (-10, 10)),
    "o2_b1s1": ("O2 sensor B1S1", "V", (0.1, 0.9)),
    "timing": ("Ignition timing advance", "\u00b0", None),
    "volt": ("Control module voltage", "V", (12.0, 14.8)),
    "fuel_status": ("Fuel system status", "", None),
}

STATE = {"frame": {}, "dtcs": [], "vehicle": "", "diagnosis": "Waiting for live data from a reader.",
         "flags": [], "at": 0.0, "speaking": False, "last_wav": None,
         "config": {"vin": "", "decoded": "", "modules": [], "o2_present": []}}

# Enough WMI prefixes to name the maker/region offline; unknown ones are reported honestly, not guessed.
WMI = {"KMH": "Hyundai (Korea)", "KMU": "Genesis/Hyundai (Korea)", "KM8": "Hyundai (Korea)",
       "KND": "Kia (Korea)", "KNA": "Kia (Korea)", "JTD": "Toyota (Japan)", "JT": "Toyota (Japan)",
       "JHM": "Honda (Japan)", "JF": "Subaru (Japan)", "JN": "Nissan (Japan)", "1HG": "Honda (USA)",
       "1G": "GM (USA)", "1FT": "Ford (USA)", "1FA": "Ford (USA)", "WBA": "BMW (Germany)",
       "WDB": "Mercedes (Germany)", "WVW": "VW (Germany)", "WAU": "Audi (Germany)", "2": "(Canada)",
       "3": "(Mexico)", "5": "(USA)", "SAL": "Land Rover (UK)", "ZFA": "Fiat (Italy)"}
_YEAR = "ABCDEFGHJKLMNPRSTVWXY123456789"  # VIN position 10 -> model year


def decode_vin(vin):
    vin = (vin or "").strip().upper()
    if len(vin) != 17 or any(c in "IOQ" for c in vin):
        return {"valid": False, "text": "VIN not valid or not read"}
    maker = next((v for k, v in WMI.items() if vin.startswith(k)), None) or \
            next((v for k, v in WMI.items() if vin[0] == k), "unknown maker")
    y = _YEAR.find(vin[9])
    year = 2010 + y if 0 <= y < 21 else (2031 + (y - 21) if y >= 21 else None)
    return {"valid": True, "vin": vin, "maker": maker, "year": year,
            "text": f"{maker}, model year {year or '?'}"}
LOCK = threading.Lock()
_last_diag = [0.0]


def model(prompt, max_tokens=360):
    key = HELPER_KEY.read_text().strip()
    body = {"model": "nori-helper-9b", "stream": False, "max_tokens": max_tokens, "temperature": 0.3,
            "chat_template_kwargs": {"enable_thinking": False}, "messages": [{"role": "user", "content": prompt}]}
    req = Request(HELPER + "/v1/chat/completions", data=json.dumps(body).encode(),
                  headers={"Content-Type": "application/json", "Authorization": "Bearer " + key})
    with urlopen(req, timeout=90) as r:
        return json.loads(r.read())["choices"][0]["message"]["content"].strip()


def flag_frame(frame):
    """Cheap, local out-of-range check so the dashboard can highlight bad values without waiting on the model."""
    out = []
    for key, value in frame.items():
        meta = PIDS.get(key)
        if not meta or meta[2] is None or not isinstance(value, (int, float)):
            continue
        lo, hi = meta[2]
        if value < lo or value > hi:
            out.append(f"{meta[0]} {value}{meta[1]} (normal {lo}\u2013{hi})")
    return out


def describe(frame, dtcs, vehicle):
    rows = []
    for key, value in frame.items():
        meta = PIDS.get(key)
        label, unit = (meta[0], meta[1]) if meta else (key, "")
        rows.append(f"- {label}: {value}{unit}")
    cfg = STATE["config"]
    config_lines = ""
    if cfg.get("decoded") or cfg.get("modules") or cfg.get("o2_present"):
        parts = []
        if cfg.get("decoded"):
            parts.append(f"VIN decodes to: {cfg['decoded']}")
        if cfg.get("o2_present"):
            parts.append(f"O2 sensors the car reports present: {', '.join(cfg['o2_present'])}")
        if cfg.get("modules"):
            parts.append(f"Modules that answered the scan: {', '.join(cfg['modules'])}")
        config_lines = ("What's installed (presence only - this says a part is THERE, not that it is the correct "
                        "or a good part):\n" + "\n".join("- " + p for p in parts) + "\n"
                        "If fewer O2 sensors or modules respond than this vehicle should have, flag it.\n")
    text = (f"Vehicle: {vehicle or 'unknown'}\n"
            f"Trouble codes present: {', '.join(dtcs) if dtcs else 'none reported'}\n"
            + config_lines +
            f"Live readings this moment:\n" + "\n".join(rows))
    return text


def diagnose_now(frame, dtcs, vehicle):
    prompt = ("You are Nori, a master automotive diagnostic tech watching a car's LIVE data stream. "
              "From the current readings below, in 3-4 short sentences: say if anything looks wrong right now, "
              "what it points to, and whether it's urgent. If everything is in normal range, say the car looks healthy "
              "and name one thing you're watching. Be specific about the actual numbers. No filler, no preamble.\n"
              # Lesson from a real miss (2026-11-25): a Hyundai read rich on both banks with the O2 agreeing, so it
              # looked like a genuine rich condition - but all four O2 sensors were bad/wrong parts, lying in unison.
              "Sensor-trust rule: a reading only means something if the sensor can move. When ALL the O2 sensors, or "
              "both banks, agree on the same thing (e.g. all rich / all negative fuel trims) AND the problem persists "
              "after the obvious fuel-side fix, do NOT assume it's real - suspect the sensors themselves: a bad batch "
              "or wrong part makes them all lie the same way, which looks identical to a true condition. Say that is "
              "possible, and recommend a response test (force the mixture lean or rich and watch the sensor actually "
              "swing) instead of trusting a static value. Never conclude a sensor is good just because its reading "
              "matches the fuel trims.\n\n"
              + describe(frame, dtcs, vehicle))
    return model(prompt)


def maybe_diagnose(force=False):
    now = time.time()
    if not force and now - _last_diag[0] < DIAGNOSE_EVERY:
        return
    with LOCK:
        frame, dtcs, vehicle = dict(STATE["frame"]), list(STATE["dtcs"]), STATE["vehicle"]
    if not frame:
        return
    _last_diag[0] = now
    try:
        verdict = diagnose_now(frame, dtcs, vehicle)
    except Exception as error:
        verdict = f"(diagnosis unavailable: {type(error).__name__})"
    with LOCK:
        STATE["diagnosis"], STATE["at"] = verdict, now


def speak(text):
    """Nori says the verdict aloud via her Kokoro voice. Best-effort; never blocks ingest."""
    try:
        line = re.sub(r"\s+", " ", text)[:600]
        script = (f"import sys,wave,numpy as np; sys.path.insert(0,r'{VOICE_PKGS}'); from kokoro_onnx import Kokoro; "
                  f"e=Kokoro(r'{VOICE_MODEL}',r'{VOICE_VOICES}'); s,rate=e.create({line!r},voice='af_bella',speed=1.0); "
                  f"w=wave.open(r'{Path(__file__).parent / 'last-verdict.wav'}','wb'); w.setnchannels(1); w.setsampwidth(2); "
                  f"w.setframerate(rate); w.writeframes((np.clip(s,-1,1)*32767).astype('<i2').tobytes()); w.close()")
        subprocess.run([VOICE_PY, "-I", "-B", "-c", script], timeout=120,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        with LOCK:
            STATE["last_wav"] = str(Path(__file__).parent / "last-verdict.wav")
    except Exception:
        pass


def load_latest_report():
    """So she can also pull up the last stored full-system scan, not just the live frame."""
    try:
        pdfs = sorted(Path(REPORTS_DIR).rglob("*.pdf"), key=lambda p: p.stat().st_mtime, reverse=True)
        return pdfs[0].name if pdfs else None
    except Exception:
        return None


PAGE = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Nori \u00b7 Live Vehicle</title><style>
:root{--bg:#0b0f17;--card:#141b2a;--line:#243049;--txt:#e8eef9;--dim:#8ea2c6;--ok:#35ffb0;--warn:#ffb347;--bad:#ff4f6d;--accent:#5ad1ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:16px/1.4 "Segoe UI",system-ui,sans-serif}
header{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--line);background:#0e1420;position:sticky;top:0}
header b{font-size:20px}header .v{color:var(--dim);font-size:14px}.dot{width:10px;height:10px;border-radius:50%;background:var(--bad)}
.dot.live{background:var(--ok);box-shadow:0 0 10px var(--ok)}
.wrap{display:grid;grid-template-columns:1fr 1fr;gap:16px;padding:16px;max-width:1100px;margin:0 auto}
@media(max-width:800px){.wrap{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
.card h2{margin:0 0 10px;font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.pid{background:#0e1626;border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.pid .l{color:var(--dim);font-size:12px}.pid .n{font-size:22px;font-weight:700;margin-top:2px}
.pid.bad{border-color:var(--bad)}.pid.bad .n{color:var(--bad)}
#diag{font-size:17px;line-height:1.5;white-space:pre-wrap;min-height:90px}
.flags{margin-top:8px}.flag{display:inline-block;background:#2a1420;border:1px solid var(--bad);color:var(--bad);border-radius:8px;padding:3px 9px;margin:3px 4px 0 0;font-size:13px}
.row{display:flex;gap:10px;align-items:center;margin-top:12px}button{background:var(--accent);color:#04121c;border:0;border-radius:9px;padding:9px 14px;font-weight:700;cursor:pointer}
.muted{color:var(--dim);font-size:13px}
</style></head><body>
<header><span class="dot" id="dot"></span><b>Nori</b><span class="v" id="veh">no vehicle</span>
<span class="v" id="age" style="margin-left:auto"></span></header>
<div class="wrap">
  <div class="card"><h2>Live readings</h2><div class="grid" id="pids"><div class="muted">Waiting for a reader to send live data\u2026</div></div></div>
  <div class="card"><h2>Nori\u2019s read</h2><div id="diag">Waiting for live data from a reader.</div>
    <div class="flags" id="flags"></div>
    <div class="row"><button onclick="speak()">\u25b6 Speak it</button><span class="muted" id="rep"></span></div>
  </div>
</div>
<audio id="au"></audio>
<script>
const U=(k,v,u)=>`<div class="pid${v.bad?' bad':''}"><div class="l">${k}</div><div class="n">${v.val}${u||''}</div></div>`;
async function tick(){
 let s; try{ s=await (await fetch('/state',{cache:'no-store'})).json(); }catch(e){ document.getElementById('dot').classList.remove('live'); return; }
 const live = s.at && (Date.now()/1000 - s.at) < 15;
 document.getElementById('dot').classList.toggle('live', !!s.frame_count);
 const cfg = s.config || {};
 const cfgbits = [cfg.decoded, (cfg.o2_present&&cfg.o2_present.length)?cfg.o2_present.length+' O2 present':'', (cfg.modules&&cfg.modules.length)?cfg.modules.length+' modules':''].filter(Boolean).join(' · ');
 document.getElementById('veh').textContent = (s.vehicle || 'no vehicle') + (cfgbits? '  —  '+cfgbits : '');
 document.getElementById('age').textContent = s.at ? ('updated '+Math.max(0,Math.round(Date.now()/1000 - s.at))+'s ago') : '';
 const p=document.getElementById('pids');
 if(s.pids && s.pids.length){ p.innerHTML = s.pids.map(x=>U(x.label,{val:x.value,bad:x.bad},x.unit)).join(''); }
 document.getElementById('diag').textContent = s.diagnosis || '';
 document.getElementById('flags').innerHTML = (s.flags||[]).map(f=>`<span class="flag">${f}</span>`).join('');
 document.getElementById('rep').textContent = s.latest_report ? ('last full scan: '+s.latest_report) : '';
}
async function speak(){ try{ await fetch('/speak',{method:'POST'}); const a=document.getElementById('au'); a.src='/verdict.wav?t='+Date.now(); a.play(); }catch(e){} }
setInterval(tick, 1500); tick();
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/" or self.path.startswith("/index"):
            return self._send(200, PAGE.encode(), "text/html; charset=utf-8")
        if self.path == "/state":
            with LOCK:
                frame = dict(STATE["frame"])
                pids = [{"label": PIDS.get(k, (k, "", None))[0], "unit": PIDS.get(k, (k, "", None))[1],
                         "value": v, "bad": any(PIDS.get(k, (k, "", None))[0] in f for f in STATE["flags"])}
                        for k, v in frame.items()]
                return self._send(200, {"vehicle": STATE["vehicle"], "pids": pids, "frame_count": len(frame),
                                        "dtcs": STATE["dtcs"], "diagnosis": STATE["diagnosis"], "flags": STATE["flags"],
                                        "at": STATE["at"], "latest_report": load_latest_report(),
                                        "config": STATE["config"]})
        if self.path.startswith("/verdict.wav"):
            with LOCK:
                wav = STATE["last_wav"]
            if wav and Path(wav).exists():
                return self._send(200, Path(wav).read_bytes(), "audio/wav")
            return self._send(404, b"no audio", "text/plain")
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"
        if self.path.startswith("/live"):
            try:
                payload = json.loads(raw or b"{}")
            except ValueError:
                return self._send(400, {"error": "bad json"})
            frame = payload.get("frame", payload)
            frame = {k: v for k, v in frame.items() if k in PIDS}
            with LOCK:
                STATE["frame"].update(frame)
                if "dtcs" in payload:
                    STATE["dtcs"] = payload["dtcs"]
                if "vehicle" in payload:
                    STATE["vehicle"] = payload["vehicle"]
                if "vin" in payload:
                    STATE["config"]["vin"] = payload["vin"]
                    STATE["config"]["decoded"] = decode_vin(payload["vin"]).get("text", "")
                if "modules" in payload and isinstance(payload["modules"], list):
                    STATE["config"]["modules"] = [str(m)[:60] for m in payload["modules"]][:40]
                if "o2_present" in payload and isinstance(payload["o2_present"], list):
                    STATE["config"]["o2_present"] = [str(m)[:30] for m in payload["o2_present"]][:12]
                STATE["flags"] = flag_frame(STATE["frame"])
                STATE["at"] = time.time()
            threading.Thread(target=maybe_diagnose, daemon=True).start()
            if self.path.endswith("speak=1"):
                with LOCK:
                    v = STATE["diagnosis"]
                threading.Thread(target=speak, args=(v,), daemon=True).start()
            return self._send(200, {"ok": True})
        if self.path == "/speak":
            with LOCK:
                v = STATE["diagnosis"]
            speak(v)
            return self._send(200, {"ok": True})
        return self._send(404, {"error": "not found"})


def main():
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"nori-vehicle bridge on :{PORT}  (dashboard http://127.0.0.1:{PORT}/ , ingest POST /live)", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
