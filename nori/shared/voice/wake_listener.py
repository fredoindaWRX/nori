"""Wake word listener component with explicit start/stop lifecycle.

This module provides a Python interface to the Windows Speech Recognition
wake detection system, using System.Speech via PowerShell integration.

Wake detection is NOT owner authentication. Commands are only emitted for
execution when the existing owner-verification path (verify_owner_audio.py)
actually accepts them.

NOTE: This implementation uses Windows Speech Recognition with the default
audio device as selected by Windows. The audio_router.py device selection
is verified for availability but not explicitly passed to the recognition
engine, which relies on Windows' default input selection.
"""
import ctypes
import json
import os
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable, Optional, Dict, Any

# Package-local discovery keeps the voice service portable and testable.  Windows
# Speech Recognition still selects the Windows default input itself.
try:
    from .audio_devices import get_audio_devices
except ImportError:  # supports direct script diagnostics from this directory
    from audio_devices import get_audio_devices
# Windows Speech may spawn helper processes.  A partial ctypes Job Object
# wrapper is worse than no wrapper because a bad call can silently leave a
# microphone process behind.  Use Windows taskkill /T for a deterministic
# process-tree request, then retain the normal Popen.kill fallback.  This is
# deliberately reported as a cleanup request, not as proof that Windows killed
# every protected process.
WINDOWS_JOB_OBJECTS_AVAILABLE = False
kernel32 = None


def _terminate_process_tree(process, timeout=5.0):
    """Request termination of a recognizer and its descendants without a console."""
    pid = getattr(process, "pid", None)
    if not isinstance(pid, int) or pid <= 0:
        return False
    requested = False
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=timeout,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            requested = True
        except (OSError, subprocess.SubprocessError):
            pass
    try:
        if getattr(process, "poll", lambda: None)() is None:
            process.kill()
        process.wait(timeout=timeout)
        return True
    except Exception:
        return requested


@dataclass
class WakeEvent:
    """Result of a wake detection cycle."""
    wake_detected: bool
    text: str
    confidence: float
    speaker_verified: bool
    voice_identity_reason: str
    voice_similarity: Optional[float] = None
    voice_audio_seconds: Optional[float] = None
    status: str = "no_speech"
    recording_device: Optional[str] = None  # Actual device used for recording


@dataclass
class WakeListenerStatus:
    """Current status of the wake listener."""
    running: bool
    last_cycle_time: Optional[float] = None
    last_event: Optional[WakeEvent] = None
    current_stage: str = "idle"
    error: Optional[str] = None


class WakeListener:
    """Wake word listener with start/stop lifecycle."""

    def __init__(
        self,
        wake_phrase: str = "Hey Nori",
        on_wake: Optional[Callable[[WakeEvent], None]] = None,
        status_file: Optional[Path] = None,
        shutdown_wait_seconds: float = 15.0,
    ):
        """Initialize wake listener.

        Args:
            wake_phrase: Wake phrase to detect (default: "Hey Nori")
            on_wake: Callback when wake is detected and verified
            status_file: Optional file for status reporting
        """
        if not isinstance(shutdown_wait_seconds, (int, float)) or not 0.01 <= shutdown_wait_seconds <= 30:
            raise ValueError("shutdown_wait_seconds must be between 0.01 and 30 seconds")
        self._shutdown_wait_seconds = float(shutdown_wait_seconds)
        self.wake_phrase = wake_phrase
        self.on_wake = on_wake
        self.status_file = status_file or Path(
            os.environ.get("NORI_ROOT", "C:/Nori")
        ) / "nori" / "runtime-data" / "wake_listener_status.json"

        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._status = WakeListenerStatus(running=False)
        self._lock = threading.Lock()
        self._subprocess: Optional[subprocess.Popen] = None
        self._subprocess_lock = threading.Lock()  # Serialize subprocess lifetime
        self._callbacks_enabled = True
        self._generation = 0  # Track restart generation to prevent overlapping starts
        self._start_stop_lock = threading.Lock()  # Serialize start/stop operations
        self._job_handle = None  # Windows job object for process tree management

        # Paths to PowerShell script and verifier
        self._script_dir = Path(__file__).parent
        self._powershell_script = self._script_dir / "listen-windows-speech.ps1"
        self._verify_script = self._script_dir / "verify_owner_audio.py"

        if not self._powershell_script.exists():
            raise RuntimeError(f"PowerShell script not found: {self._powershell_script}")

    def _update_status(self, **kwargs):
        """Update status atomically."""
        with self._lock:
            for key, value in kwargs.items():
                if hasattr(self._status, key):
                    setattr(self._status, key, value)

        # Write status file if configured
        try:
            status_dict = {
                "running": self._status.running,
                "last_cycle_time": self._status.last_cycle_time,
                "current_stage": self._status.current_stage,
                "error": self._status.error,
                "last_event": {
                    "wake_detected": self._status.last_event.wake_detected,
                    "text": self._status.last_event.text,
                    "confidence": self._status.last_event.confidence,
                    "speaker_verified": self._status.last_event.speaker_verified,
                    "voice_identity_reason": self._status.last_event.voice_identity_reason,
                } if self._status.last_event else None,
            }
            self.status_file.parent.mkdir(parents=True, exist_ok=True)
            self.status_file.write_text(json.dumps(status_dict, indent=2))
        except Exception:
            # Status file write failure should not crash the listener
            pass

    def _run_single_cycle(self) -> Optional[WakeEvent]:
        """Run a single wake detection cycle."""
        self._update_status(current_stage="starting_recognition")

        # Create temporary output file for PowerShell script
        import tempfile
        output_file = Path(tempfile.mktemp(suffix=".json"))

        try:
            # Call PowerShell script with WakeOnly flag
            # Timeout: 30s allows wake (5s) + command (15s) + verifier (~10s)
            creation_flags = 0
            if hasattr(subprocess, 'CREATE_NO_WINDOW'):
                creation_flags |= subprocess.CREATE_NO_WINDOW

            proc = subprocess.Popen(
                [
                    "powershell",
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy", "Bypass",
                    "-File", str(self._powershell_script),
                    "-OutputFile", str(output_file),
                    "-WakeOnly",
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=os.environ.copy(),
                creationflags=creation_flags,
            )
            with self._subprocess_lock:
                self._subprocess = proc

            try:
                stdout, stderr = proc.communicate(timeout=30)
                returncode = proc.returncode
            except subprocess.TimeoutExpired:
                proc.kill()
                stdout, stderr = proc.communicate()
                returncode = -1
                self._update_status(
                    current_stage="timeout",
                    error="Recognition timeout (30s exceeded)"
                )
                return None
            finally:
                with self._subprocess_lock:
                    if self._subprocess is proc:
                        self._subprocess = None

            if returncode != 0:
                self._update_status(
                    current_stage="recognition_error",
                    error=f"PowerShell script failed: {stderr}"
                )
                return None

            # Parse output (handle UTF-8 BOM from PowerShell)
            if output_file.exists():
                try:
                    output_data = json.loads(output_file.read_text(encoding='utf-8-sig'))
                except json.JSONDecodeError:
                    # Fallback to regular UTF-8 if utf-8-sig fails
                    output_data = json.loads(output_file.read_text(encoding='utf-8'))

                # Report the device System.Speech actually opens. Device
                # resolution happens on every cycle so a changed Windows
                # default does not require restarting NORI.
                recording_device = "Windows default input"
                try:
                    devices = get_audio_devices()
                    windows_default_device = devices.get("default_input_name")
                    if windows_default_device:
                        recording_device = f"Windows default ({windows_default_device})"
                except Exception:
                    recording_device = "Windows default input"

                event = WakeEvent(
                    wake_detected=output_data.get("wake_detected", False),
                    text=output_data.get("text", ""),
                    confidence=output_data.get("confidence", 0.0),
                    speaker_verified=output_data.get("speaker_verified", False),
                    voice_identity_reason=output_data.get("voice_identity_reason", ""),
                    voice_similarity=output_data.get("voice_similarity"),
                    voice_audio_seconds=output_data.get("voice_audio_seconds"),
                    status=output_data.get("status", "no_speech"),
                    recording_device=recording_device,
                )
                return event
            else:
                self._update_status(
                    current_stage="output_missing",
                    error="PowerShell script did not create output file"
                )
                return None

        except Exception as e:
            self._update_status(
                current_stage="exception",
                error=f"Recognition exception: {e}"
            )
            return None
        finally:
            # Cleanup temporary file
            if output_file.exists():
                try:
                    output_file.unlink()
                except Exception:
                    pass

    def _listen_loop(self):
        """Main listening loop running in background thread."""
        generation = self._generation
        self._update_status(current_stage="listening")

        while self._running and not self._stop_event.is_set() and generation == self._generation:
            cycle_start = time.perf_counter()

            # Check cancellation before device discovery
            if self._stop_event.is_set() or generation != self._generation:
                break

            # Verify audio device is available (Windows default will be used by recognition)
            try:
                devices = get_audio_devices()
                default_usable = devices.get("default_input_usable")
                if default_usable is None:
                    # Backward-compatible injected adapters used by older
                    # tests may expose only the selected input.
                    default_usable = devices.get("input_index") is not None
                if not default_usable:
                    self._update_status(
                        current_stage="device_unavailable",
                        error="Windows default input device is unavailable"
                    )
                    break
            except Exception as e:
                self._update_status(
                    current_stage="device_error",
                    error=f"Audio device check failed: {e}"
                )
                break

            # Check cancellation again before spawning subprocess
            if self._stop_event.is_set() or generation != self._generation:
                break

            try:
                event = self._run_single_cycle()

                if event:
                    self._update_status(
                        last_cycle_time=cycle_start,
                        last_event=event,
                        current_stage="idle"
                    )

                    # Only emit verified commands when callbacks are enabled
                    if event.wake_detected and event.speaker_verified and self._callbacks_enabled:
                        if self.on_wake:
                            self.on_wake(event)
                else:
                    self._update_status(
                        last_cycle_time=cycle_start,
                        current_stage="idle"
                    )

            except Exception as e:
                self._update_status(
                    current_stage="loop_error",
                    error=f"Listen loop exception: {e}"
                )

            # Small delay before next cycle
            self._stop_event.wait(0.1)

    def start(self):
        """Start the wake listener in background thread."""
        with self._start_stop_lock:
            if self._running:
                return

            # Refuse restart if old generation still exists
            if self._thread and self._thread.is_alive():
                raise RuntimeError("Cannot start: previous generation still running")

            self._generation += 1
            self._running = True
            self._callbacks_enabled = True
            self._stop_event.clear()

            # Process-tree cleanup uses the deterministic _terminate_process_tree helper.
            self._job_handle = None

            self._thread = threading.Thread(target=self._listen_loop, daemon=True)
            self._thread.start()
            self._update_status(running=True, current_stage="starting")

    def stop(self):
        """Stop the wake listener and suppress callbacks."""
        with self._start_stop_lock:
            if not self._running:
                return

            self._running = False
            self._callbacks_enabled = False  # Suppress any late callbacks
            self._stop_event.set()

            # Terminate recognizer and requested descendants before joining its worker.
            with self._subprocess_lock:
                proc = self._subprocess
                self._subprocess = None
            if proc is not None:
                try:
                    _terminate_process_tree(proc)
                finally:
                    pass
            self._job_handle = None

            # Wait for thread to finish (retain handle longer)
            if self._thread:
                self._thread.join(timeout=self._shutdown_wait_seconds)
                # Only clear thread handle after it's confirmed stopped
                if not self._thread.is_alive():
                    self._thread = None

            # Clear stop flag only after thread has exited
            if not self._thread or not self._thread.is_alive():
                self._stop_event.clear()

            still_stopping = bool(self._thread and self._thread.is_alive())
            self._update_status(
                running=False,
                current_stage="stopping" if still_stopping else "stopped",
                error="Wake listener is still stopping; restart remains blocked." if still_stopping else self._status.error,
            )

    def get_status(self) -> WakeListenerStatus:
        """Get current listener status."""
        with self._lock:
            return WakeListenerStatus(
                running=self._status.running,
                last_cycle_time=self._status.last_cycle_time,
                last_event=self._status.last_event,
                current_stage=self._status.current_stage,
                error=self._status.error,
            )


if __name__ == "__main__":
    # Simple test mode
    def on_wake_handler(event: WakeEvent):
        print(f"WAKE DETECTED: {event.text}")
        print(f"Speaker verified: {event.speaker_verified}")
        print(f"Reason: {event.voice_identity_reason}")

    listener = WakeListener(on_wake=on_wake_handler)
    print("Starting wake listener...")
    listener.start()

    try:
        while True:
            status = listener.get_status()
            print(f"Status: {status.current_stage}, Last event: {status.last_event}")
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping...")
        listener.stop()
        print("Stopped")


