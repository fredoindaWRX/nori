import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

path = Path(__file__).resolve().parents[3] / 'runtime/stt/launch_worker.py'
spec = importlib.util.spec_from_file_location('stt_launcher_fixture', path)
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


class STTLauncherTests(unittest.TestCase):
    def test_verified_payload_then_same_size_corruption_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            model = root / 'model'; model.mkdir()
            packages = root / 'packages'; packages.mkdir()
            worker = root / 'worker.py'; worker.write_text('fixture')
            expected = {}
            for name in launcher.REQUIRED:
                data = ('controlled ' + name).encode()
                (model / name).write_bytes(data)
                expected[name] = hashlib.sha256(data).hexdigest()
            with patch.multiple(launcher, ROOT=root, MODEL=model, PACKAGES=packages,
                                WORKER=worker, EXPECTED=expected):
                launcher.validate_payload()
                target = model / 'model.bin'
                target.write_bytes(b'x' * target.stat().st_size)
                with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                    launcher.validate_payload()


if __name__ == '__main__':
    unittest.main()
