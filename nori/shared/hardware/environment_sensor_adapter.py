"""Bounded read-only serial frames for motion, range, and ambient sensors.

Devices (or a local bridge) must already emit one UTF-8 JSON object or a
comma-separated ``name=value`` line.  This adapter never probes, configures,
or writes to the serial endpoint.
"""
from __future__ import annotations

import json
import math
import re


MAX_FRAME_BYTES = 4096
_SENSOR_TYPES = frozenset(("motion", "range", "ambient"))
_PROTOCOLS = frozenset(("normalized_json", "normalized_line"))
_KEY = re.compile(r"[a-z][a-z0-9_]{0,47}\Z")

# Bounds are deliberately wider than ordinary indoor readings but reject
# corrupted units, non-physical values, and arbitrary unreviewed fields.
_FIELDS = {
    "motion": {
        "accel_x_mps2": (-200.0, 200.0),
        "accel_y_mps2": (-200.0, 200.0),
        "accel_z_mps2": (-200.0, 200.0),
        "gyro_x_dps": (-4000.0, 4000.0),
        "gyro_y_dps": (-4000.0, 4000.0),
        "gyro_z_dps": (-4000.0, 4000.0),
        "heading_deg": (0.0, 360.0),
    },
    "range": {
        "distance_m": (0.0, 10000.0),
        "signal_strength": (0.0, 1.0),
        "field_of_view_deg": (0.0, 180.0),
    },
    "ambient": {
        "temperature_c": (-100.0, 200.0),
        "humidity_pct": (0.0, 100.0),
        "illuminance_lux": (0.0, 2_000_000.0),
        "pressure_hpa": (100.0, 1200.0),
        "air_quality_index": (0.0, 500.0),
        "sound_level_db": (0.0, 200.0),
    },
}


def _number(value, field, bounds):
    if isinstance(value, bool):
        raise ValueError(f"Invalid {field}")
    try:
        number = float(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"Invalid {field}") from error
    if not math.isfinite(number) or not bounds[0] <= number <= bounds[1]:
        raise ValueError(f"Out-of-range {field}")
    return int(number) if number.is_integer() else number


def _decode(raw, protocol):
    if not raw:
        raise ValueError("Empty sensor frame")
    try:
        text = raw.decode("utf-8").strip()
    except UnicodeDecodeError as error:
        raise ValueError("Sensor frame is not UTF-8") from error
    if not text:
        raise ValueError("Empty sensor frame")
    if protocol == "normalized_json":
        try:
            value = json.loads(text, parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()))
        except (json.JSONDecodeError, ValueError) as error:
            raise ValueError("Malformed sensor JSON") from error
        if not isinstance(value, dict):
            raise ValueError("Sensor JSON must be an object")
        return value
    fields = {}
    for item in text.split(","):
        if item.count("=") != 1:
            raise ValueError("Malformed sensor line")
        key, value = (part.strip() for part in item.split("=", 1))
        if not _KEY.fullmatch(key) or not value or key in fields:
            raise ValueError("Malformed sensor line")
        fields[key] = value
    return fields


def parse_environment_frame(raw, sensor_type, protocol):
    """Normalize a frame under the exact configured channel schema."""
    if sensor_type not in _SENSOR_TYPES or protocol not in _PROTOCOLS:
        raise ValueError("Unsupported environmental sensor contract")
    value = _decode(raw, protocol)
    allowed = _FIELDS[sensor_type]
    if not value or set(value) - set(allowed):
        raise ValueError("Unknown or missing sensor fields")
    normalized = {key: _number(item, key, allowed[key]) for key, item in value.items()}
    normalized.update({
        "sensor_type": sensor_type,
        "evidence_protocol": protocol,
        "read_only": True,
    })
    return normalized


def _validated_spec(spec):
    source = spec.get("source")
    sensor_type = spec.get("type")
    protocol = spec.get("protocol")
    if not isinstance(source, str) or not source.strip() or len(source) > 256:
        raise ValueError("Environmental serial source must be explicit")
    if sensor_type not in _SENSOR_TYPES or protocol not in _PROTOCOLS:
        raise ValueError("Environmental sensor type and protocol must be explicit")
    baudrate = spec.get("baudrate", 115200)
    timeout = spec.get("timeout", 0.5)
    maximum = spec.get("max_frame_bytes", 1024)
    if type(baudrate) is not int or not 1200 <= baudrate <= 3_000_000:
        raise ValueError("Invalid environmental serial baudrate")
    if type(timeout) not in (int, float) or isinstance(timeout, bool) or not math.isfinite(timeout) or not 0.05 <= timeout <= 2:
        raise ValueError("Invalid environmental serial timeout")
    if type(maximum) is not int or not 32 <= maximum <= MAX_FRAME_BYTES:
        raise ValueError("Invalid environmental frame limit")
    return source.strip(), sensor_type, protocol, baudrate, float(timeout), maximum


def read_environment_serial(spec):
    """Read exactly one bounded frame without transmitting any bytes."""
    source, sensor_type, protocol, baudrate, timeout, maximum = _validated_spec(spec)
    import serial  # Lazy optional dependency; configuration is checked first.

    with serial.Serial(source, baudrate=baudrate, timeout=timeout) as port:
        raw = port.read_until(b"\n", size=maximum + 1)
    if len(raw) > maximum:
        raise ValueError("Environmental sensor frame is too large")
    result = parse_environment_frame(raw, sensor_type, protocol)
    result.update({"serial_source": source, "baudrate": baudrate})
    return result
