import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[3] / 'runtime/voice/launch_worker.py'
spec = importlib.util.spec_from_file_location('nori_voice_launcher_fixture', path)
voice = importlib.util.module_from_spec(spec)
spec.loader.exec_module(voice)


class VoiceLauncherTests(unittest.TestCase):
    def invocation(self):
        return ['launcher', '--kokoro', str(voice.ROOT / 'apps/desktop/bridge/kokoro_tts.py'),
                str(voice.ROOT / 'models/voice/kokoro-v1/kokoro-v1.0.onnx'),
                str(voice.ROOT / 'models/voice/kokoro-v1/voices-v1.0.bin')]

    def test_canonical_and_diagnose_arguments(self):
        self.assertEqual(voice.validate_invocation(self.invocation()), tuple(map(Path, self.invocation()[2:])))
        self.assertIsNone(voice.validate_invocation(['launcher', '--diagnose']))

    def test_unknown_modes_counts_and_worker_code_are_refused(self):
        for args in (['launcher'], ['launcher', '--unknown'], ['launcher', '--diagnose', 'extra'],
                     ['launcher', '--kokoro'], ['launcher', '--kokoro', 'unknown.py', 'model', 'voices']):
            with self.assertRaises(ValueError): voice.validate_invocation(args)
        args = self.invocation(); args[2] = str(voice.ROOT / 'owner-code.py')
        with self.assertRaises(ValueError): voice.validate_invocation(args)

    def test_weights_outside_root_or_swapped_are_refused(self):
        args = self.invocation(); args[3] = str(voice.ROOT.parent / 'outside/kokoro-v1.0.onnx')
        with self.assertRaises(ValueError): voice.validate_invocation(args)
        args = self.invocation(); args[3], args[4] = args[4], args[3]
        with self.assertRaises(ValueError): voice.validate_invocation(args)
        self.assertFalse(voice.contained(voice.ROOT.parent / (voice.ROOT.name + '-not-the-product')))


if __name__ == '__main__': unittest.main()
