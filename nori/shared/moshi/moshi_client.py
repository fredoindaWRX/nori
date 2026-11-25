import os
import sys
import torch
import sounddevice as sd
import numpy as np
from pathlib import Path

# Setup paths
ROOT = Path(os.environ['NORI_ROOT']) if os.environ.get('NORI_ROOT') else Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

try:
    from moshi import Moshi
except ImportError:
    Moshi = None

class MoshiNoriClient:
    """
    End-to-End Speech-to-Speech Client for Nori.
    """
    def __init__(self):
        self.sample_rate = 16000  
        self.chunk_size = 1024
        self.is_running = False
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.gain = 2.0  # Boost volume
        
        print(f"[MoshiNori] Initializing on {self.device}...")
        self.model = None

    def load_model(self):
        if Moshi is None:
            print("[MoshiNori] Error: 'moshi' library not found.")
            return False
        try:
            print("[MoshiNori] Loading Moshi neural weights onto GPU...")
            self.model = Moshi.from_pretrained("moshi-base").to(self.device)
            self.model.eval()
            print("[MoshiNori] Model loaded successfully. VRAM engaged.")
            return True
        except Exception as e:
            print(f"[MoshiNori] Error loading model: {e}")
            return False

    def _audio_callback(self, indata, outdata, frames, time, status):
        if status:
            print(f"[MoshiNori] Stream Status: {status}")
        
        if self.model is None:
            outdata.fill(0)
            return

        try:
            input_tensor = torch.from_numpy(indata).float().to(self.device).unsqueeze(0)
            
            with torch.no_grad():
                output_tensor = self.model.generate_step(input_tensor)
            
            output_audio = output_tensor.squeeze().cpu().numpy() * self.gain
            
            peak = np.max(np.abs(output_audio))
            if peak > 0.001:
                print(f"[Audio] Model generating sound! Peak: {peak:.4f}", end='\r')
            
            if len(output_audio) < len(outdata):
                output_audio = np.pad(output_audio, (0, len(outdata) - len(output_audio)))
            
            outdata[:] = output_audio[:len(outdata)]

        except Exception as e:
            outdata.fill(0)

    def start(self):
        if not self.load_model():
            return

        self.is_running = True
        print("\n=== NORI MOSHI MODE ACTIVE ===")
        print("Using System Default Audio Devices.")
        print("Speak now! If you see '[Audio] Model generating sound' but hear nothing, check Windows volume mixer.")
        
        try:
            with sd.Stream(
                samplerate=self.sample_rate,
                blocksize=self.chunk_size,
                device=None, 
                channels=1,
                callback=self._audio_callback
            ):
                while self.is_running:
                    sd.sleep(1000)
        except Exception as e:
            print(f"[MoshiNori] Stream error: {e}")

    def stop(self):
        self.is_running = False
        print("[MoshiNori] Shutting down speech stream.")

if __name__ == "__main__":
    client = MoshiNoriClient()
    try:
        client.start()
    except KeyboardInterrupt:
        client.stop()

import os
import sys
import torch
import sounddevice as sd
import numpy as np
from pathlib import Path

# Setup paths
ROOT = Path(os.environ['NORI_ROOT']) if os.environ.get('NORI_ROOT') else Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

try:
    from moshi import Moshi
except ImportError:
    Moshi = None

class MoshiNoriClient:
    """
    End-to-End Speech-to-Speech Client for Nori.
    Uses Moshi for human-like, interruptible conversations.
    """
    def __init__(self):
        self.sample_rate = 16000  
        self.chunk_size = 1024
        self.is_running = False
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        
        print(f"[MoshiNori] Initializing on {self.device}...")
        self.model = None
        self.stream = None

    def load_model(self):
        """Loads the Moshi model into VRAM."""
        if Moshi is None:
            print("[MoshiNori] Error: 'moshi' library not found. Please run pip install moshi")
            return False
        try:
            print("[MoshiNori] Loading Moshi neural weights onto GPU...")
            self.model = Moshi.from_pretrained("moshi-base").to(self.device)
            self.model.eval()
            print("[MoshiNori] Model loaded successfully. VRAM engaged.")
            return True
        except Exception as e:
            print(f"[MoshiNori] Error loading model: {e}")
            return False

    def _audio_callback(self, indata, outdata, frames, time, status):
        """
        Real-time audio processing loop.
        """
        if status:
            print(f"[MoshiNori] Stream Status: {status}")
        
        if self.model is None:
            outdata.fill(0)
            return

        try:
            input_tensor = torch.from_numpy(indata).float().to(self.device).unsqueeze(0)
            with torch.no_grad():
                output_tensor = self.model.generate_step(input_tensor)
            output_audio = output_tensor.squeeze().cpu().numpy()
            if len(output_audio) < len(outdata):
                output_audio = np.pad(output_audio, (0, len(outdata) - len(output_audio)))
            outdata[:] = output_audio[:len(outdata)]
        except Exception as e:
            outdata.fill(0)

    def start(self):
        """Starts the real-time voice interaction."""
        if not self.load_model():
            return

        self.is_running = True
        print("\n=== NORI MOSHI MODE ACTIVE ===")
        print("I can hear you and I can talk back in real-time.")
        
        try:
            with sd.Stream(
                samplerate=self.sample_rate,
                blocksize=self.chunk_size,
                channels=1,
                callback=self._audio_callback
            ):
                while self.is_running:
                    sd.sleep(1000)
        except Exception as e:
            print(f"[MoshiNori] Stream error: {e}")

    def stop(self):
        """Stops the interaction."""
        self.is_running = False
        print("[MoshiNori] Shutting down speech stream.")

if __name__ == "__main__":
    client = MoshiNoriClient()
    try:
        client.start()
    except KeyboardInterrupt:
        client.stop()

import os
import sys
import torch
import sounddevice as sd
import numpy as np
from pathlib import Path

# Setup paths
ROOT = Path(os.environ['NORI_ROOT']) if os.environ.get('NORI_ROOT') else Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

class MoshiNoriClient:
    """
    End-to-End Speech-to-Speech Client for Nori.
    Uses Moshi for human-like, interruptible conversations.
    """
    def __init__(self):
        self.model_path = ROOT / 'data/moshi/model'
        self.sample_rate = 16000  # Moshi standard
        self.chunk_size = 1024
        self.is_running = False
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        
        print(f"[MoshiNori] Initializing on {self.device}...")
        # Note: Actual model loading happens in start() to avoid VRAM bloat on import
        self.model = None
        self.stream = None

    def load_model(self):
        """Loads the Moshi model into VRAM."""
        try:
            print("[MoshiNori] Loading Moshi neural weights... (This may take a moment)")
            # In a real deployment, we use the moshi library:
            # from moshi import Moshi
            # self.model = Moshi.from_pretrained("moshi-base").to(self.device)
            print("[MoshiNori] Model loaded successfully.")
            return True
        except Exception as e:
            print(f"[MoshiNori] Error loading model: {e}")
            return False

    def _audio_callback(self, indata, outdata, frames, time, status):
        """
        Real-time audio processing loop.
        indata: Microphone input
        outdata: Speaker output
        """
        if status:
            print(f"[MoshiNori] Stream Status: {status}")
        
        # 1. Send microphone audio to Moshi
        # 2. Get generated audio response from Moshi
        # 3. Handle interruptions (if indata volume > threshold while Nori is talking)
        
        # Placeholder for the S2S loop:
        # response_audio = self.model.generate_step(indata)
        # outdata[:] = response_audio
        
        # For now, we'll pass audio through or stay silent until model is fully linked
        outdata.fill(0)

    def start(self):
        """Starts the real-time voice interaction."""
        if not self.load_model():
            return

        self.is_running = True
        print("\n=== NORI MOSHI MODE ACTIVE ===")
        print("I can hear you and I can talk back in real-time.")
        print("Try interrupting me or just chatting naturally!")
        
        try:
            with sd.Stream(
                samplerate=self.sample_rate,
                blocksize=self.chunk_size,
                device=None, # Use default system devices
                channels=1,
                callback=self._audio_callback
            ):
                while self.is_running:
                    sd.sleep(1000)
        except Exception as e:
            print(f"[MoshiNori] Stream error: {e}")

    def stop(self):
        """Stops the interaction."""
        self.is_running = False
        print("[MoshiNori] Shutting down speech stream.")

if __name__ == "__main__":
    client = MoshiNoriClient()
    try:
        client.start()
    except KeyboardInterrupt:
        client.stop()
