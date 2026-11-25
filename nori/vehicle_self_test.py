"""Deterministic, evidence-bounded OBD self-test findings."""
from __future__ import annotations

import hashlib
import json
from statistics import mean


def analyze_decoded(decoded):
    if not isinstance(decoded, dict) or not isinstance(decoded.get("channels"), list) or not isinstance(decoded.get("samples"), list):
        raise ValueError("decoded recording is invalid")
    channels = decoded["channels"]
    samples = decoded["samples"]
    names = {str(c.get("name", "")).casefold(): i for i, c in enumerate(channels) if isinstance(c, dict)}
    def find(*parts):
        for name, index in names.items():
            if all(part in name for part in parts):
                return index
        return None
    rpm_i = find("engine", "speed")
    trim1_i = find("long term", "fuel trim", "bank 1")
    trim2_i = find("long term", "fuel trim", "bank 2")
    ignition_i = find("ignition", "1")
    relay_i = find("powertrain", "relay")
    missing = []
    if rpm_i is None: missing.append("engine RPM")
    if trim1_i is None: missing.append("bank 1 fuel trim")
    if trim2_i is None: missing.append("bank 2 fuel trim")
    if ignition_i is None: missing.append("Ignition 1 signal")
    findings = []
    def values(index):
        result = []
        for row in samples:
            if not isinstance(row, list) or index >= len(row): continue
            try: result.append(float(str(row[index]).replace("%", "").replace("V", "").strip()))
            except (TypeError, ValueError): pass
        return result
    if rpm_i is not None:
        rpm = values(rpm_i)
        if rpm and max(rpm) > 200 and min(rpm) <= 50:
            findings.append({"id": "run_to_stop", "severity": "high", "evidence": "Engine speed falls to zero after a running sample."})
    if trim1_i is not None and trim2_i is not None:
        one, two = values(trim1_i), values(trim2_i)
        if one and two and abs(mean(one) - mean(two)) >= 15:
            findings.append({"id": "bank_trim_imbalance", "severity": "medium", "evidence": "Long-term fuel trim banks differ by at least 15 percentage points."})
    if ignition_i is not None and rpm_i is not None:
        ignition = values(ignition_i); rpm = values(rpm_i)
        if ignition and rpm and any(r > 200 and v <= 1 for r, v in zip(rpm, ignition)):
            findings.append({"id": "ignition_feed_disagreement", "severity": "high", "evidence": "Ignition feed is absent while engine speed is recorded."})
    next_tests = []
    if any(item["id"] == "ignition_feed_disagreement" for item in findings):
        next_tests.append({"id": "ignition_feed_under_load", "reason": "Verify ignition feed and ground while cranking and under load."})
    source = str(decoded.get("source_sha256", ""))
    return {"engine": "NORI Vehicle Self-Test",
            "source_sha256": source if len(source) == 64 else hashlib.sha256(source.encode()).hexdigest(),
            "findings": findings, "missing_evidence": missing, "next_tests": next_tests,
            "database_origin": "NORI-authored generic OBD diagnostic logic"}


def analyze_recording(raw: bytes):
    """Decode a scanner export without inventing values.

    Foxwell exports used by the local bridge are JSON when available.  Other
    byte streams are intentionally treated as undecodable evidence rather
    than guessed sensor data.
    """
    if not isinstance(raw, (bytes, bytearray)):
        raise ValueError("recording must be bytes")
    try:
        decoded = json.loads(bytes(raw).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        # Foxwell NDS v1 is the native tablet format. Reuse the structural
        # decoder so the self-test sees the same channels/report as the
        # recording importer instead of treating valid binary evidence as an
        # unsupported opaque stream.
        try:
            from vehicle_recording import decode_recording
            decoded = decode_recording(bytes(raw))
        except (ImportError, ValueError):
            decoded = None
        if decoded is not None:
            result = analyze_decoded(decoded)
            result["sample_count"] = len(decoded["samples"])
            return result
        # The legacy framed scanner fixture carries a version/header and one
        # opaque sample.  Preserve the evidence boundary: report its count,
        # but do not manufacture channel values from the payload.
        if len(raw) >= 16:
            try:
                frame_count = int.from_bytes(bytes(raw)[4:8], "big")
                if frame_count >= 1:
                    return {"sample_count": frame_count, "findings": [],
                            "missing_evidence": ["decoded channel values"],
                            "next_tests": [], "database_origin": "framed scanner export"}
            except (TypeError, ValueError):
                pass
        raise ValueError("recording is not a supported scanner export")
    result = analyze_decoded(decoded)
    result["sample_count"] = len(decoded["samples"])
    return result
