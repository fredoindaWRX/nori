"""Real reader: an ELM327 OBDII adapter -> the bridge. THIS is what makes "crank the car and watch Nori"
literally work. Plug a cheap ELM327 (USB or Bluetooth) into the car's OBD2 port, then run this.

It reads the standard live PIDs every second and POSTs them to the bridge at :9090/live, and sends any
stored trouble codes once at the start. It only READS the car (no actuation, no clearing codes).

Setup (one time), in the normal Python:
    pip install obd
Run:
    python feed_elm327.py                 auto-detect the adapter port
    python feed_elm327.py COM5            or name the serial port / BT device

Note: a generic ELM327 reads generic OBDII (engine/emissions) live data and codes, the same channels in
your i50's "Live data" menu. It does NOT do the Foxwell unit's advanced per-manufacturer systems
(airbag, ABS, bidirectional tests) - keep using the i50 for those; this is the live engine stream for Nori.
"""
import json, sys, time
from urllib.request import Request, urlopen

URL = "http://127.0.0.1:9090/live"

try:
    import obd
except ImportError:
    sys.exit("python-OBD is not installed. Run:  pip install obd")

# Map python-OBD commands to the bridge's PID keys.
READ = {
    "rpm": obd.commands.RPM, "speed": obd.commands.SPEED, "coolant": obd.commands.COOLANT_TEMP,
    "intake_temp": obd.commands.INTAKE_TEMP, "maf": obd.commands.MAF, "map": obd.commands.INTAKE_PRESSURE,
    "throttle": obd.commands.THROTTLE_POS, "load": obd.commands.ENGINE_LOAD,
    "stft1": obd.commands.SHORT_FUEL_TRIM_1, "ltft1": obd.commands.LONG_FUEL_TRIM_1,
    "stft2": obd.commands.SHORT_FUEL_TRIM_2, "ltft2": obd.commands.LONG_FUEL_TRIM_2,
    "timing": obd.commands.TIMING_ADVANCE, "volt": obd.commands.CONTROL_MODULE_VOLTAGE,
}


def post(body):
    try:
        urlopen(Request(URL, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}), timeout=5).read()
    except Exception as error:
        print("post failed:", type(error).__name__, "- is bridge.py running?")


def main():
    port = sys.argv[1] if len(sys.argv) > 1 else None
    conn = obd.OBD(port) if port else obd.OBD()
    if not conn.is_connected():
        sys.exit("could not connect to the ELM327. Check the adapter, the port, and that the ignition is on.")
    print("connected to the vehicle; streaming live data to the bridge (Ctrl+C to stop)")

    # VIN + stored codes once.
    vin = conn.query(obd.commands.VIN)
    codes = conn.query(obd.commands.GET_DTC)
    dtcs = [f"{c} {d}" for c, d in (codes.value or [])] if not codes.is_null() else []
    vin_str = str(vin.value) if not vin.is_null() else ""
    # O2 sensors the car reports present (Mode 01 PID 13) - "what's there", not whether it's the right part.
    o2 = conn.query(obd.commands.O2_SENSORS)
    o2_present = [f"B{b+1}S{s+1}" for b, row in enumerate(o2.value or []) for s, on in enumerate(row) if on] if not o2.is_null() else []
    post({"vehicle": vin_str or "connected vehicle", "vin": vin_str, "dtcs": dtcs, "o2_present": o2_present, "frame": {}})

    supported = {k: c for k, c in READ.items() if conn.supports(c)}
    while True:
        frame = {}
        for key, cmd in supported.items():
            r = conn.query(cmd)
            if not r.is_null():
                frame[key] = round(float(r.value.magnitude), 2) if hasattr(r.value, "magnitude") else r.value
        if frame:
            post({"frame": frame})
            print("  ".join(f"{k} {v}" for k, v in list(frame.items())[:6]))
        time.sleep(1.0)


if __name__ == "__main__":
    main()
