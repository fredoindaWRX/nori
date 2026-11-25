# Wake Listener Documentation

## Overview

The wake listener provides a Python interface to Windows Speech Recognition for detecting the "Hey Nori" wake phrase. It uses System.Speech via PowerShell integration with owner voice verification.

**Key Features:**
- Explicit start/stop lifecycle management
- Owner voice verification integration
- Windows Speech Recognition with wake grammar
- Graceful fallback when unavailable
- Comprehensive status reporting and diagnostics

## Architecture

### Components

1. **wake_listener.py**: Python wrapper module
   - `WakeListener` class with start/stop lifecycle
   - Event-driven callback interface
   - Status file reporting
   - Process tree cleanup via Windows job objects

2. **listen-windows-speech.ps1**: PowerShell speech recognizer
   - Uses System.Speech.Recognition.SpeechRecognitionEngine
   - Supports wake-only and continuous wake+command modes
   - Tolerant wake phrase variants (Hey Nori, Hery Bori, Hey Bori, Herry Nori)
   - Performs owner voice verification

3. **verify_owner_audio.py**: Owner voice verification
   - Uses voice_identity_backend_v1.SpeakerVerifier
   - Checks captured audio against owner profile
   - Returns acceptance/rejection with similarity scores

### Data Flow

```
Microphone → Windows Speech Recognition → PowerShell Script → JSON Output
                                                          ↓
                                                    Owner Verification
                                                          ↓
                                                    WakeEvent Callback
```

## Installation

### Requirements

- Python 3.10+
- Windows OS (System.Speech is Windows-only)
- PyAudio/sounddevice (for audio device detection)
- PowerShell 5.1+

### Setup

The wake listener is part of the Nori voice system under `nori/shared/voice/`. No additional installation is required beyond the main Nori dependencies.

## Usage

### Basic Usage

```python
from nori.shared.voice.wake_listener import WakeListener, WakeEvent

def on_wake(event: WakeEvent):
    if event.wake_detected and event.speaker_verified:
        print(f"Command: {event.text}")
        # Execute the command

listener = WakeListener(on_wake=on_wake)
listener.start()

# ... background listening ...

listener.stop()
```

### Advanced Usage

```python
from nori.shared.voice.wake_listener import WakeListener, WakeEvent
from pathlib import Path

def on_wake(event: WakeEvent):
    if event.wake_detected and event.speaker_verified:
        print(f"Wake detected: {event.text}")
        print(f"Confidence: {event.confidence}")
        print(f"Device: {event.recording_device}")

# Custom status file location
listener = WakeListener(
    on_wake=on_wake,
    status_file=Path("C:/custom/path/wake_status.json")
)

listener.start()
status = listener.get_status()
print(f"Running: {status.running}")
print(f"Stage: {status.current_stage}")
listener.stop()
```

## WakeEvent Fields

- `wake_detected` (bool): Whether wake phrase was detected
- `text` (str): Recognized text (wake phrase removed if present)
- `confidence` (float): Recognition confidence (0.0-1.0)
- `speaker_verified` (bool): Whether speaker matched owner profile
- `voice_identity_reason` (str): Verification result description
- `voice_similarity` (float, optional): Similarity score if verified
- `voice_audio_seconds` (float, optional): Audio duration
- `status` (str): Recognition status
- `recording_device` (str): Actual recording device used

## Lifecycle Management

### Start/Stop

```python
listener = WakeListener(on_wake=on_wake)

# Start the listener
listener.start()

# Check status
status = listener.get_status()
assert status.running == True

# Stop the listener
listener.stop()
assert status.running == False
```

### Thread Safety

- Start/stop operations are serialized with `_start_stop_lock`
- Generation tracking prevents overlapping starts
- Callbacks are suppressed after stop
- Thread handle retained during shutdown

### Process Tree Cleanup

The listener uses Windows job objects for process tree cleanup:
- PowerShell process assigned to job on spawn
- Child Python verifier processes also cleaned up
- Job closed on stop kills entire process tree
- Graceful fallback if Windows API unavailable

## Status Reporting

### Status File

The listener writes status to `nori/runtime-data/wake_listener_status.json`:

```json
{
  "running": true,
  "last_cycle_time": 1697891234.567,
  "current_stage": "listening",
  "error": null,
  "last_event": {
    "wake_detected": true,
    "text": "Hey Nori do something",
    "confidence": 0.85,
    "speaker_verified": true,
    "voice_identity_reason": "accepted"
  }
}
```

### Stages

- `idle`: Not listening
- `starting`: Initializing
- `listening`: Actively listening for wake phrase
- `checking_audio_device`: Verifying audio device
- `starting_recognition`: Starting speech recognition
- `recognizing`: Processing speech
- `device_unavailable`: No audio device found
- `device_error`: Audio device check failed
- `recognition_error`: PowerShell script failed
- `timeout`: Recognition timeout
- `stopped`: Listener stopped

## Testing

### Running Tests

From repository root:
```bash
python test_wake_listener_from_root.py
```

From voice directory:
```bash
cd nori/shared/voice
python -m pytest test_wake_listener.py -v
```

### Test Coverage

- **Lifecycle Tests**: Start/stop behavior, double start/stop prevention
- **Wake Detection Tests**: Wake-only, continuous wake+command, no-wake speech
- **Identity Verification Tests**: Verified/unverified speaker scenarios
- **Device Failure Tests**: Device unavailability handling
- **Callback Tests**: Callback suppression after stop
- **Concurrent Tests**: Overlapping restart prevention
- **Performance Tests**: Latency and memory footprint

### Test Fixtures

Tests use mocks and prerecorded fixtures - no real microphone access during testing.

## Troubleshooting

### Wake Phrase Not Detected

1. Check audio device:
   ```python
   from audio_router import get_audio_devices
   devices = get_audio_devices()
   print(devices)
   ```

2. Check status file for errors:
   ```python
   import json
   status = json.loads("nori/runtime-data/wake_listener_status.json")
   print(status["error"])
   ```

3. Verify PowerShell script exists:
   ```python
   from pathlib import Path
   script = Path("nori/shared/voice/listen-windows-speech.ps1")
   print(script.exists())
   ```

### Listener Won't Start

1. Check if previous generation still running:
   ```python
   listener = WakeListener()
   try:
       listener.start()
   except RuntimeError as e:
       print(f"Start failed: {e}")
   ```

2. Check stop signal persistence:
   ```python
   listener.stop()
   time.sleep(1)
   print(listener._stop_event.is_set())
   ```

### No Callback Firing

1. Verify speaker verification:
   ```python
   # Check owner profile exists
   from pathlib import Path
   profile = Path("data/voice_identity/owner_profile.json")
   print(profile.exists())
   ```

2. Check wake detection:
   ```python
   # In WakeEvent callback
   print(f"Wake detected: {event.wake_detected}")
   print(f"Speaker verified: {event.speaker_verified}")
   ```

## Integration

### Workspace Integration

The wake listener integrates with `workspace/wake.py` via `WakeAuthority`:

```python
from wake_listener import WakeListener, WakeEvent

class WakeAuthority:
    def __init__(self, ...):
        self._new_listener = WakeListener(
            on_wake=self._on_wake_event,
            status_file=NORI_ROOT / 'nori/runtime-data/wake_listener_status.json'
        )
```

### Owner Verification

Wake detection is NOT authentication. Commands are only emitted when:

1. Wake phrase detected ("Hey Nori" or variant)
2. Speaker verified against owner profile
3. Both conditions met in WakeEvent callback

## Security & Privacy

- No credentials or secrets embedded in listener
- Audio recordings not persisted beyond verification
- Transcript not stored in wake listener
- Owner verification required for command execution
- Device access follows the current Windows default input

## Limitations

- Windows-only (System.Speech is Windows-specific)
- Requires calibrated owner voice profile
- Uses the current Windows default audio input; change it in Windows Sound settings
- Not a full speech-to-text system (wake phrase only)
- Process tree cleanup best-effort (depends on Windows API)

## See Also

- `listen-windows-speech.ps1`: PowerShell speech recognizer
- `verify_owner_audio.py`: Owner voice verification
- `workspace/wake.py`: Workspace integration
- `audio_router.py`: Audio device configuration
