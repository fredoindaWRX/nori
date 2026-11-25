"""Bounded, read-only serial vehicle evidence adapter.

The adapter accepts one explicitly configured frame format:

``normalized_json``
    A single UTF-8 JSON object containing only the documented vehicle fields.
``normalized_line``
    A comma-separated ``name=value`` line using the same fields.
``elm327_response``
    One already-produced OBD-II mode 01 response, such as ``41 0C 1A F8``.

This module never transmits serial bytes.  An ELM327 must therefore already be
streaming or be driven by a separate, explicitly authorized diagnostic reader.
The adapter only turns received evidence into NORI's normalized vehicle shape.
"""

from __future__ import annotations

import json
import math
import re


MAX_FRAME_BYTES = 4096
_PROTOCOLS = frozenset(("normalized_json", "normalized_line", "elm327_response"))
_NUMERIC_FIELDS = {
    "rpm": (0.0, 20000.0),
    "speed_kmh": (0.0, 500.0),
    "engine_temp_c": (-50.0, 250.0),
    "intake_temp_c": (-50.0, 200.0),
    "fuel_pct": (0.0, 100.0),
    "map_kpa": (0.0, 300.0),
    "voltage_v": (0.0, 60.0),
}
_DTC = re.compile(r"^[PBCU][0-3][0-9A-F]{3}$")
_HEX_BYTE = re.compile(r"^[0-9A-Fa-f]{2}$")


def _finite_number(name, value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number")
    number = float(value)
    if not math.isfinite(number):
        raise ValueError(f"{name} must be a finite number")
    low, high = _NUMERIC_FIELDS[name]
    if not low <= number <= high:
        raise ValueError(f"{name} outside supported evidence range")
    return int(number) if number.is_integer() else number


def _normalize_fields(raw):
    if not isinstance(raw, dict) or not raw:
        raise ValueError("vehicle frame must be a non-empty object")
    unknown = set(raw) - (set(_NUMERIC_FIELDS) | {"dtcs"})
    if unknown:
        raise ValueError("unsupported vehicle evidence field")
    normalized = {}
    for name in _NUMERIC_FIELDS:
        if name in raw:
            normalized[name] = _finite_number(name, raw[name])
    if "dtcs" in raw:
        dtcs = raw["dtcs"]
        if not isinstance(dtcs, list) or len(dtcs) > 64:
            raise ValueError("dtcs must be a bounded list")
        cleaned = []
        for code in dtcs:
            if not isinstance(code, str) or not _DTC.fullmatch(code.upper()):
                raise ValueError("invalid diagnostic trouble code")
            cleaned.append(code.upper())
        normalized["dtcs"] = cleaned
    if not normalized:
        raise ValueError("vehicle frame contains no supported evidence")
    return normalized


def _parse_normalized_json(text):
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as error:
        raise ValueError("malformed normalized JSON vehicle frame") from error
    return _normalize_fields(raw)


def _parse_normalized_line(text):
    raw = {}
    for field in text.split(","):
        if "=" not in field:
            raise ValueError("malformed normalized vehicle line")
        name, value = (part.strip() for part in field.split("=", 1))
        if not name or name in raw:
            raise ValueError("malformed normalized vehicle line")
        if name == "dtcs":
            raw[name] = [] if not value else [item.strip() for item in value.split("|")]
        else:
            try:
                raw[name] = float(value)
            except ValueError as error:
                raise ValueError("non-numeric normalized vehicle value") from error
    return _normalize_fields(raw)


def _parse_elm327_response(text):
    # Accept spacing commonly emitted by ELM327 bridges, but no AT/control text.
    tokens = text.replace(">", " ").strip().split()
    if not 3 <= len(tokens) <= 16 or any(not _HEX_BYTE.fullmatch(token) for token in tokens):
        raise ValueError("malformed ELM327 response")
    data = [int(token, 16) for token in tokens]
    if data[0] != 0x41:
        raise ValueError("only read-only OBD-II mode 01 responses are supported")
    pid, payload = data[1], data[2:]
    if pid == 0x0C and len(payload) == 2:
        value = {"rpm": ((payload[0] << 8) | payload[1]) / 4}
    elif pid == 0x0D and len(payload) == 1:
        value = {"speed_kmh": payload[0]}
    elif pid == 0x05 and len(payload) == 1:
        value = {"engine_temp_c": payload[0] - 40}
    elif pid == 0x0F and len(payload) == 1:
        value = {"intake_temp_c": payload[0] - 40}
    elif pid == 0x2F and len(payload) == 1:
        value = {"fuel_pct": payload[0] * 100 / 255}
    elif pid == 0x0B and len(payload) == 1:
        value = {"map_kpa": payload[0]}
    else:
        raise ValueError("unsupported or incorrectly sized ELM327 PID response")
    return _normalize_fields(value), f"01-{pid:02X}"


def parse_vehicle_frame(frame, protocol):
    """Parse a bounded frame without accessing hardware (also useful in tests)."""
    if protocol not in _PROTOCOLS:
        raise ValueError("unsupported vehicle serial protocol")
    if not isinstance(frame, (bytes, bytearray)) or not frame:
        raise ValueError("empty vehicle serial frame")
    if len(frame) > MAX_FRAME_BYTES:
        raise ValueError("vehicle serial frame too large")
    try:
        text = bytes(frame).decode("utf-8", errors="strict").strip("\r\n ")
    except UnicodeDecodeError as error:
        raise ValueError("vehicle serial frame is not valid UTF-8") from error
    if not text:
        raise ValueError("empty vehicle serial frame")
    pid = None
    if protocol == "normalized_json":
        data = _parse_normalized_json(text)
    elif protocol == "normalized_line":
        data = _parse_normalized_line(text)
    else:
        data, pid = _parse_elm327_response(text)
    # Vehicle measurements stay at the top level so SensoryLayer publishes the
    # same shape as its other adapters (for example GPS ``lat``/``lon``).
    result = dict(data)
    result.update({"evidence_protocol": protocol, "read_only": True})
    if pid:
        result["obd_mode_pid"] = pid
    return result


def read_vehicle_serial(spec):
    """Read exactly one bounded frame from an explicitly configured serial port."""
    if not isinstance(spec, dict):
        raise ValueError("vehicle serial configuration is required")
    source = spec.get("source")
    protocol = spec.get("protocol")
    if not isinstance(source, str) or not source.strip() or len(source) > 128:
        raise ValueError("explicit vehicle serial source is required")
    if protocol not in _PROTOCOLS:
        raise ValueError("explicit supported vehicle serial protocol is required")
    timeout = spec.get("timeout", 1.0)
    baudrate = spec.get("baudrate", 38400)
    frame_limit = spec.get("max_frame_bytes", MAX_FRAME_BYTES)
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 0.05 <= timeout <= 2.0:
        raise ValueError("vehicle serial timeout must be between 0.05 and 2 seconds")
    if isinstance(baudrate, bool) or not isinstance(baudrate, int) or not 1200 <= baudrate <= 3_000_000:
        raise ValueError("unsupported vehicle serial baudrate")
    if isinstance(frame_limit, bool) or not isinstance(frame_limit, int) or not 16 <= frame_limit <= MAX_FRAME_BYTES:
        raise ValueError("vehicle serial frame limit must be between 16 and 4096 bytes")

    import serial  # Lazy: systems without a configured vehicle sensor need no pyserial.

    with serial.Serial(source.strip(), baudrate=baudrate, timeout=float(timeout)) as port:
        frame = port.read_until(b"\n", size=frame_limit + 1)
    if len(frame) > frame_limit:
        raise ValueError("vehicle serial frame too large")
    result = parse_vehicle_frame(frame, protocol)
    result.update({"serial_source": source.strip(), "baudrate": baudrate})
    return result
