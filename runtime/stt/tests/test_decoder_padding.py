"""Offline regression for decoder context; no model, microphone or playback."""
from pathlib import Path
import runpy
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'runtime/stt/packages'))
import numpy as np

decoder_audio = runpy.run_path(str(ROOT / 'apps/desktop/bridge/whisper_stt.py'))['decoder_audio']


class DecoderPaddingTests(unittest.TestCase):
    def test_digital_silence_and_empty_are_not_decoded(self):
        self.assertIsNone(decoder_audio(np.zeros(16000, dtype=np.float32)))
        self.assertIsNone(decoder_audio(np.zeros(0, dtype=np.float32)))

    def test_edges_are_silent_and_content_unchanged(self):
        audio = np.array([0.1, -0.2, 0.3], dtype=np.float32)
        result = decoder_audio(audio)
        self.assertEqual(result.shape, (16003,))
        self.assertEqual(result.dtype, audio.dtype)
        np.testing.assert_array_equal(result[8000:8003], audio)
        self.assertFalse(result[:8000].any())
        self.assertFalse(result[8003:].any())
        np.testing.assert_array_equal(audio, [np.float32(0.1), np.float32(-0.2), np.float32(0.3)])

    def test_quiet_speech_is_not_thresholded_away(self):
        audio = np.array([1e-8], dtype=np.float32)
        result = decoder_audio(audio)
        self.assertIsNotNone(result)
        self.assertEqual(result[8000], audio[0])


if __name__ == '__main__':
    unittest.main()
