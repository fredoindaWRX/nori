import threading
import time
import os
import sys
from pathlib import Path

# Setup paths
ROOT = Path(os.environ['NORI_ROOT']) if os.environ.get('NORI_ROOT') else Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from nori.shared.moshi.moshi_client import MoshiNoriClient

class VoiceServiceManager:
    """
    Manages the lifecycle of Nori's voice interface.
    Switches from legacy STT/TTS to the new Moshi S2S system.
    """
    def __init__(self):
        self.moshi_client = MoshiNoriClient()
        self.voice_thread = None
        self.is_active = False

    def start_voice_interface(self):
        """Launches the Moshi speech-to-speech stream in a background thread."""
        if self.is_active:
            print("[VoiceService] Interface already running.")
            return

        print("[VoiceService] Activating Moshi S2S Interface...")
        self.is_active = True
        self.voice_thread = threading.Thread(
            target=self.moshi_client.start, 
            daemon=True
        )
        self.voice_thread.start()
        print("[VoiceService] Nori is now listening and speaking in real-time.")

    def stop_voice_interface(self):
        """Gracefully shuts down the voice stream."""
        print("[VoiceService] Deactivating voice interface...")
        self.moshi_client.stop()
        self.is_active = False

if __name__ == "__main__":
    # Standalone test mode
    manager = VoiceServiceManager()
    try:
        manager.start_voice_interface()
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        manager.stop_voice_interface()
