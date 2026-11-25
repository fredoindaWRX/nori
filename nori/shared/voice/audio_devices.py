"""Audio-device discovery used by NORI voice components.

This module is deliberately inside the NORI package so voice runtime and tests do
not depend on a desktop-only module living outside the installed application.
Windows Speech Recognition still opens the Windows default input; this helper
only reports the selected local device and detects when no usable input exists.
"""
try:
    import sounddevice as sd
except ImportError:  # Supported on minimal/no-audio installs.
    sd = None

PREFERRED_INPUT_NAMES = (
    "Microphone (Arctis Nova Pro Wireless)",
    "Microphone (2- ME6S)",
    "Microphone (ME6S)",
    "Microphone (Voicemod)",
    "Voicemod",
)


def _host_name(device):
    try:
        return sd.query_hostapis(device["hostapi"])["name"] if sd and device else None
    except Exception:
        return None


def _usable_input(index, device):
    if not sd or device.get("max_input_channels", 0) <= 0 or "WDM-KS" in (_host_name(device) or ""):
        return False
    try:
        sd.check_input_settings(device=index, samplerate=16000, channels=1, dtype="int16")
        return True
    except Exception:
        return False


def get_audio_devices():
    """Resolve Windows/PortAudio defaults and a diagnostic input fallback.

    Windows Speech Recognition opens the Windows default input itself.  The
    ``default_input_*`` fields therefore describe the device the wake engine is
    expected to use.  ``input_*`` may identify a tested fallback for manual
    diagnostics, but wake listening must not pretend that fallback was opened.
    The function resolves defaults on every call so Windows device changes do
    not require a NORI restart.
    """
    empty = {"input_index": None, "input_name": None, "input_host": None,
             "input_source": None, "default_input_index": None,
             "default_input_name": None, "default_input_host": None,
             "default_input_usable": False, "output_index": None,
             "output_name": None, "output_host": None,
             "output_source": None}
    if not sd:
        return empty
    try:
        devices = sd.query_devices()
    except Exception:
        return empty
    candidates = []
    default_input = None
    try:
        default_index = int(sd.default.device[0])
        if 0 <= default_index < len(devices):
            default_input = (default_index, devices[default_index])
            candidates.append(default_index)
    except Exception:
        pass
    for preferred in PREFERRED_INPUT_NAMES:
        candidates.extend(index for index, device in enumerate(devices)
                          if preferred.casefold() in str(device.get("name", "")).casefold())
    candidates.extend(range(len(devices)))
    seen = set()
    selected = None
    for index in candidates:
        if index in seen or not 0 <= index < len(devices):
            continue
        seen.add(index)
        if _usable_input(index, devices[index]):
            selected = (index, devices[index]); break
    output = None
    try:
        output_index = int(sd.default.device[1])
        if output_index >= 0 and devices[output_index].get("max_output_channels", 0) > 0:
            output = (output_index, devices[output_index])
    except Exception:
        pass
    default_usable = bool(default_input and _usable_input(*default_input))
    return {
        "input_index": selected[0] if selected else None,
        "input_name": selected[1]["name"] if selected else None,
        "input_host": _host_name(selected[1]) if selected else None,
        "input_source": ("windows_default" if selected and default_input
                         and selected[0] == default_input[0] else
                         "validated_fallback" if selected else None),
        "default_input_index": default_input[0] if default_input else None,
        "default_input_name": default_input[1]["name"] if default_input else None,
        "default_input_host": _host_name(default_input[1]) if default_input else None,
        "default_input_usable": default_usable,
        "output_index": output[0] if output else None,
        "output_name": output[1]["name"] if output else None,
        "output_host": _host_name(output[1]) if output else None,
        "output_source": "windows_default" if output else None,
    }
