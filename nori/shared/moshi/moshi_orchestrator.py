# AUTO-START: Skip wake-word menu for automated execution
import sys
sys.argv.append('--auto-start')

# AUTO-START: Skip wake-word menu for automated execution
import sys
sys.argv.append('--auto-start')

import os
import sys
from pathlib import Path
import torch
import sounddevice as sd
import numpy as np
import subprocess
import wave
import threading
import speech_recognition as sr

# Setup project root paths
ROOT = Path(os.environ['NORI_ROOT']) if os.environ.get('NORI_ROOT') else Path(__file__).resolve().parents[3]
sys.path.append(str(ROOT))

# CORRECTED IMPORT for Moshi 0.2.x
try:
    from moshi.models.loaders import get_moshi_lm, get_mimi, hf_hub_download
    print('[Bridge] Moshi components located successfully.')
except ImportError as e:
    print(f'[Bridge] Critical Import Error: {e}')
    get_moshi_lm = None
    get_mimi = None
    hf_hub_download = None

class MoshiSiriBridge:
    def __init__(self):
        self.sample_rate = 24000
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        self.gain = 2.0
        
        # State management
        self.waiting_for_wake_word = True
        self.chunk_size = 2048 
        self.active_conversation = False
        self.model = None
        self.mimi = None
        
        # Wake Word Setup
        self.recognizer = sr.Recognizer()
        self.microphone = sr.Microphone()
        
        print(f'[Bridge] Initializing on {self.device}...')

    def load_model(self):
        if get_moshi_lm is None or get_mimi is None:
            print('[Bridge] Error: Moshi loaders could not be imported.')
            return False
        try:
            print('[Bridge] Warming up GPU neural weights on RTX 4080...')
            repo = 'kyutai/moshiko-pytorch-bf16'
            lm_path = hf_hub_download(repo, 'model.safetensors')
            mimi_path = hf_hub_download(repo, 'tokenizer-e351c8d8-checkpoint125.safetensors')
            
            self.model = get_moshi_lm(lm_path).to(device=self.device, dtype=torch.bfloat16)
            self.mimi = get_mimi(mimi_path).to(device=self.device, dtype=torch.bfloat16)
            
            self.model.eval()
            self.mimi.eval()
            torch.cuda.empty_cache()
            print('[Bridge] GPU Model and Mimi Loaded in BF16. Ready.')
            return True
        except Exception as e:
            print(f'[Bridge] Load Error: {e}')
    def _wake_word_listener(self):
        """Background thread that listens for 'Hey Nori' using SpeechRecognition."""
        print('[Wake-Word] Listener thread started.')
        with self.microphone as source:
            # Adjust for ambient noise once at start
            self.recognizer.adjust_for_ambient_noise(source, duration=1)
            
            while True:
                if self.waiting_for_wake_word:
                    try:
                        print('[Wake-Word] Listening...', end='\r')
                        # Listen for a short phrase
                        audio = self.recognizer.listen(source, phrase_time_limit=3)
                        # Use Google for fast, accurate verification (online)
                        text = self.recognizer.recognize_google(audio).lower()
                        print(f'[Wake-Word] Heard: "{text}"')
                        
                        if 'nori' in text:
                            print('\n[Bridge] Wake-word verified! -> Switching to Moshi...')
                            self.waiting_for_wake_word = False
                            self.active_conversation = True
                    except sr.UnknownValueError:
                        pass # Didn't understand audio
                    except sr.RequestError as e:
                        print(f'[Wake-Word] API Error: {e}')
                    except Exception as e:
                        print(f'[Wake-Word] Error: {e}')
                else:
                    import time
                    time.sleep(1)
            return False

    def record_wake_word_samples(self, num_samples=4):
        '''Records samples of the user saying the wake word for reference.'''
        ref_dir = ROOT / 'wake_word_ref'
        ref_dir.mkdir(exist_ok=True)
        print(f'\n--- Wake-Word Recording Mode ---')
        print(f'Saving samples to: {ref_dir}')
        
        for i in range(num_samples):
            filename = ref_dir / f'nori_{i+1}.wav'
            print(f'Get ready for Sample {i+1}/{num_samples}... ')
            sd.sleep(1000)
            print(f'RECORDING NOW! Say "Hey Nori"...')
            
            # Record 2 seconds at 16kHz (Standard for wake-word engines)
            recording = sd.rec(int(2 * 16000), samplerate=16000, channels=1)
            sd.wait()
            
            # Save as WAV
            with wave.open(str(filename), 'wb') as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2) # 16-bit
                wf.setframerate(16000)
                # Convert float32 to int16
                audio_int16 = (recording * 32767).astype(np.int16)
                wf.writeframes(audio_int16.tobytes())
            
            print(f'Saved {filename}\n')
        print('--- Recording Complete! ---\n')

    def _wake_word_listener(self):
        '''Background thread that listens specifically for the wake-word pattern.'''
        print('[Wake-Word] Engine starting...')
        try:
            ref_files = list((ROOT / 'wake_word_ref').glob('*.wav'))
            if not ref_files:
                print('[Wake-Word] Error: No reference samples found. Please record them first!')
                return

            self.detector = WakeWordDetector(ref_files)
            print(f'[Wake-Word] Listening for "Hey Nori" using {len(ref_files)} samples...')
            
            while self.is_running:
                if self.detector.listen():
                    print('\n[Bridge] Wake-word recognized! -> Switching to Moshi...')
                    self.waiting_for_wake_word = False
                    self.active_conversation = True
                
                if not self.active_conversation and not self.waiting_for_wake_word:
                    self.waiting_for_wake_word = True

        except Exception as e:
            print(f'[Wake-Word Error] {e}')

    def _audio_callback(self, indata, outdata, frames, time, status):
        if status:
            print(f'[Audio Status] {status}')

        input_audio = indata[:, 0]

        if self.waiting_for_wake_word:
            outdata.fill(0)
            return

        if self.active_conversation:
            try:
                input_tensor = torch.from_numpy(input_audio).float().to(self.device).unsqueeze(0).unsqueeze(0)
                with torch.inference_mode():
                    tokens = self.mimi.encode(input_tensor)
                    output_tokens = self.model.generate_step(tokens)
                
                if output_tokens is not None:
                    with torch.inference_mode():
                        output_audio_tensor = self.mimi.decode(output_tokens)
                    output_audio = output_audio_tensor.squeeze().cpu().numpy() * self.gain
                    if len(output_audio) < len(outdata):
                        output_audio = np.pad(output_audio, (0, len(outdata) - len(output_audio)))
                    outdata[:] = output_audio[:len(outdata)]
                else:
                    outdata.fill(0)
            except Exception as e:
                print(f'\n[Audio Error] {e}')
                outdata.fill(0)

    def start(self):
        print('\n1. Record New Wake-Word Samples')
        print('2. Start Bridge Normally')
        choice = input('Choice: ')
        
        if choice == '1':
            self.record_wake_word_samples()

        if not self.load_model():
            return

        self.is_running = True
        
        # Start the wake-word detector in a separate thread
        wake_thread = threading.Thread(target=self._wake_word_listener, daemon=True)
        wake_thread.start()

        try:
            with sd.Stream(samplerate=self.sample_rate, blocksize=self.chunk_size, channels=1, callback=self._audio_callback):
                print('\n' + '='*30)
                print('   NORI MASTER BRIDGE ACTIVE')
                print('='*30)
                print('Status: Listening for "Hey Nori" (Pattern Match Mode)')
                print('='*30)
                while self.is_running:
                    sd.sleep(1000)
        except Exception as e:
            print(f'[Bridge] Stream error: {e}')

    def stop(self):
        self.is_running = False

if __name__ == '__main__':
    bridge = MoshiSiriBridge()
    try:
        bridge.start()
    except KeyboardInterrupt:
        bridge.stop()

import os
import sys
import torch
import sounddevice as sd
import numpy as np
from pathlib import Path
import subprocess

# FORCE the path to the moshi library
MOSHI_LIB_PATH = r'c:\users\studio\appdata\local\programs\python\python310\lib\site-packages'
if MOSHI_LIB_PATH not in sys.path:
    sys.path.insert(0, MOSHI_LIB_PATH)

# Setup project root paths
ROOT = Path(os.environ['NORI_ROOT']) if os.environ.get('NORI_ROOT') else Path(__file__).resolve().parents[3]
sys.path.append(str(ROOT))

# CORRECTED IMPORT for Moshi 0.2.x
try:
    from moshi.models.loaders import get_moshi_lm, get_mimi, hf_hub_download
    print('[Bridge] Moshi components located successfully.')
except ImportError as e:
    print(f'[Bridge] Critical Import Error: {e}')
    get_moshi_lm = None
    get_mimi = None
    hf_hub_download = None

class MoshiSiriBridge:
    '''
    The Master Bridge: Wake-word -> GPU Moshi -> Desktop App
    '''
    def __init__(self):
        self.sample_rate = 24000
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        self.gain = 2.0
        
        # State management
        self.waiting_for_wake_word = True
        self.chunk_size = 2048 # Increased to reduce overflow on RTX 4080
        self.active_conversation = False
        self.model = None
        self.mimi = None
        
        print(f'[Bridge] Initializing on {self.device}...')

    def load_model(self):
        if get_moshi_lm is None or get_mimi is None:
            print('[Bridge] Error: Moshi loaders could not be imported.')
            return False
        try:
            print('[Bridge] Warming up GPU neural weights on RTX 4080...')
            
            # The correct repo for the official BF16 weights
            repo = 'kyutai/moshiko-pytorch-bf16'
            
            print(f'[Bridge] Downloading/Verifying weights from {repo}...')
            
            # Explicit filenames matching the Hugging Face repository
            lm_filename = 'model.safetensors'
            mimi_filename = 'tokenizer-e351c8d8-checkpoint125.safetensors'
            
            lm_path = hf_hub_download(repo, lm_filename)
            mimi_path = hf_hub_download(repo, mimi_filename)
            
            print(f'[Bridge] Loading LM from {lm_path}...')
            self.model = get_moshi_lm(lm_path).to(self.device)
            
            print(f'[Bridge] Loading Mimi from {mimi_path}...')
            self.mimi = get_mimi(mimi_path).to(self.device)
            
            self.model.eval()
            self.mimi.eval()
            
            print('[Bridge] GPU Model & Mimi Loaded. Ready for \'Hey Nori\'.')
            return True
        except Exception as e:
            print(f'[Bridge] Load Error: {e}')
            import traceback
            traceback.print_exc()
            return False

    def launch_desktop_app(self):
        '''Triggers the Nori Desktop App.'''
        print('[Bridge] Triggering Nori Desktop App for deep dive...')
        try:
            app_path = ROOT / 'nori_app.exe' 
            if app_path.exists():
                subprocess.Popen([str(app_path)])
            else:
                print(f'[Bridge] Error: Could not find {app_path}')
        except Exception as e:
            print(f'[Bridge] App Launch Error: {e}')

    def _audio_callback(self, indata, outdata, frames, time, status):
        if status:
            print(f'[Audio Status] {status}')

        input_audio = indata[:, 0]
        peak = np.max(np.abs(input_audio))

        if self.waiting_for_wake_word:
            if peak > 0.4: # Wake-word threshold
                print('\n[Bridge] Wake-word detected! -> Switching to Moshi...')
                self.waiting_for_wake_word = False
                self.active_conversation = True
            
            outdata.fill(0)
            return

        if self.active_conversation:
            try:
                # Correct flow: Audio -> Mimi Encoder -> LM -> Mimi Decoder -> Audio
                input_tensor = torch.from_numpy(input_audio).float().to(self.device).unsqueeze(0)
                with torch.no_grad():
                    tokens = self.mimi.encode(input_tensor)
                
                with torch.no_grad():
                    output_tokens = self.model.generate_step(tokens)
                
                if output_tokens is not None:
                    with torch.no_grad():
                        output_audio_tensor = self.mimi.decode(output_tokens)
                    
                    output_audio = output_audio_tensor.squeeze().cpu().numpy() * self.gain
                    
                    if len(output_audio) < len(outdata):
                        output_audio = np.pad(output_audio, (0, len(outdata) - len(output_audio)))
                    
                    outdata[:] = output_audio[:len(outdata)]
                    
                    out_peak = np.max(np.abs(outdata))
                    if out_peak > 0.001:
                        print(f'[Audio] Moshi speaking... Peak: {out_peak:.4f}', end='\r')
                else:
                    outdata.fill(0)
                
            except Exception as e:
                print(f'\n[Audio Error] {e}')
                outdata.fill(0)

    def start(self):
        if not self.load_model():
            return

        self.is_running = True
        print('\n' + '='*30)
        print('   NORI MASTER BRIDGE ACTIVE')
        print('='*30)
        print('Status: Listening for \'Hey Nori\' (Wake-word Mode)')
        print('Action: Single question -> Voice Response')
        print('Action: Complex request -> Open Desktop App')
        print('='*30)
        
        try:
            with sd.Stream(
                samplerate=self.sample_rate,
                blocksize=self.chunk_size,
                device=None, 
                channels=1,
                callback=self._audio_callback
            ):
                # Start wake-word listener in background
                listener_thread = threading.Thread(target=self._wake_word_listener, daemon=True)
                listener_thread.start()
                
                while self.is_running:
                    sd.sleep(1000)
        except Exception as e:
            print(f'[Bridge] Stream error: {e}')

    def stop(self):
        self.is_running = False
        print('[Bridge] Shutting down.')

if __name__ == '__main__':
    bridge = MoshiSiriBridge()
    try:
        bridge.start()
    except KeyboardInterrupt:
        bridge.stop()
