import importlib.util
import io
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch


class WhisperFileOwnershipTests(unittest.TestCase):
    def test_transcription_preserves_caller_file(self):
        worker = Path(__file__).resolve().parents[3] / 'apps/desktop/bridge/whisper_stt.py'
        spec = importlib.util.spec_from_file_location('whisper_ownership_fixture', worker)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        class Model:
            def __init__(self, *args, **kwargs):
                pass
            def transcribe(self, path, **kwargs):
                if kwargs.get('hotwords') != 'Nori':
                    raise AssertionError('Nori vocabulary hint missing')
                return [types.SimpleNamespace(text='test recording')], None
        with tempfile.TemporaryDirectory() as directory:
            audio = Path(directory) / 'owner-recording.wav'
            audio.write_bytes(b'controlled fixture')
            output = io.StringIO()
            fake_audio = types.SimpleNamespace(size=1, any=lambda: True)
            def pad(audio, width, mode):
                self.assertIs(audio, fake_audio)
                self.assertEqual(width, (8000, 8000))
                self.assertEqual(mode, 'constant')
                return audio
            with patch.dict('sys.modules', {'faster_whisper': types.SimpleNamespace(WhisperModel=Model),
                                          'faster_whisper.audio': types.SimpleNamespace(decode_audio=lambda *a, **k: fake_audio),
                                          'numpy': types.SimpleNamespace(pad=pad)}), \
                 patch.object(module.sys, 'stdin', io.StringIO(str(audio) + '\n')), \
                 patch.object(module.sys, 'stdout', output):
                self.assertEqual(module.main(), 0)
            self.assertEqual(audio.read_bytes(), b'controlled fixture')
            self.assertIn('test recording', output.getvalue())


if __name__ == '__main__':
    unittest.main()
