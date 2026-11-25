from unittest.mock import patch

from shared.voice import audio_devices


class FakeSoundDevice:
    class _Default:
        device = (1, 2)

    default = _Default()

    def __init__(self, unusable=()):
        self.unusable = set(unusable)
        self.devices = [
            {"name": "Fallback Mic", "hostapi": 0, "max_input_channels": 1,
             "max_output_channels": 0},
            {"name": "Windows Default Mic", "hostapi": 0, "max_input_channels": 1,
             "max_output_channels": 0},
            {"name": "Windows Default Speakers", "hostapi": 0,
             "max_input_channels": 0, "max_output_channels": 2},
        ]

    def query_devices(self):
        return self.devices

    def query_hostapis(self, _index):
        return {"name": "Windows WASAPI"}

    def check_input_settings(self, *, device, **_kwargs):
        if device in self.unusable:
            raise ValueError("unavailable")


def test_windows_defaults_are_resolved_each_call():
    fake = FakeSoundDevice()
    with patch.object(audio_devices, "sd", fake):
        result = audio_devices.get_audio_devices()
    assert result["default_input_name"] == "Windows Default Mic"
    assert result["default_input_usable"] is True
    assert result["input_source"] == "windows_default"
    assert result["output_name"] == "Windows Default Speakers"
    assert result["output_source"] == "windows_default"


def test_fallback_is_diagnostic_when_windows_default_is_unusable():
    fake = FakeSoundDevice(unusable={1})
    with patch.object(audio_devices, "sd", fake):
        result = audio_devices.get_audio_devices()
    assert result["default_input_name"] == "Windows Default Mic"
    assert result["default_input_usable"] is False
    assert result["input_name"] == "Fallback Mic"
    assert result["input_source"] == "validated_fallback"


def test_missing_audio_library_returns_complete_empty_contract():
    with patch.object(audio_devices, "sd", None):
        result = audio_devices.get_audio_devices()
    assert result["default_input_usable"] is False
    assert result["default_input_name"] is None
    assert result["output_source"] is None
