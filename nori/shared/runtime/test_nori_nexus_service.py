import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest

from nori_nexus_admin import main as admin_main
from nori_nexus_service import config_from_env


class NexusServiceTests(unittest.TestCase):
    def fixture(self, root):
        root = Path(root)
        for name in ('node.pem', 'node.key', 'ca.pem'):
            (root/name).write_text('fixture')
        return {
            'NORI_NEXUS_ROLE':'server', 'NORI_HOUSEHOLD_ID':'home_A',
            'NORI_OPERATOR_PRINCIPAL':'owner.vanguard.001',
            'NORI_NEXUS_BIND':'127.0.0.1', 'NORI_NEXUS_PORT':'9443',
            'NORI_NEXUS_DATABASE':str(root/'peers.db'),
            'NORI_NEXUS_CERTIFICATE':str(root/'node.pem'),
            'NORI_NEXUS_PRIVATE_KEY':str(root/'node.key'),
            'NORI_NEXUS_AUTHORITY':str(root/'ca.pem'),
            'NORI_MODEL_PORT':'9391', 'NORI_NEXUS_READY_FILE':str(root/'ready'),
        }

    def test_configuration_is_explicit_and_bounded(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.fixture(directory)
            config = config_from_env(env)
            self.assertEqual((config.role, config.household, config.principal, config.bind, config.port),
                             ('server', 'home_A', 'owner.vanguard.001', '127.0.0.1', 9443))
            for key, value in (('NORI_NEXUS_ROLE','work'),
                               ('NORI_HOUSEHOLD_ID','bad household'),
                               ('NORI_OPERATOR_PRINCIPAL','Owner Bad'),
                               ('NORI_NEXUS_BIND','localhost'),
                               ('NORI_NEXUS_PORT','9443x')):
                broken = dict(env, **{key:value})
                with self.assertRaises(ValueError):
                    config_from_env(broken)
            missing = dict(env, NORI_NEXUS_CERTIFICATE=str(Path(directory)/'missing'))
            with self.assertRaises(ValueError):
                config_from_env(missing)

    def test_admin_issues_single_use_secret_without_storing_plaintext(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory)/'peers.db'
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                admin_main(['--database',str(database),'--household','home_A',
                            '--principal','owner.vanguard.001','invite',
                            '--node','server_1','--fingerprint','a'*64,'--ttl','60'])
            token = output.getvalue().strip()
            self.assertGreater(len(token), 30)
            self.assertNotIn(token.encode(), database.read_bytes())


class RuntimeStageTests(unittest.TestCase):
    def test_stage_installs_nexus_disabled_by_default(self):
        source = Path(__file__).resolve().parents[2]
        script = source/'OS/build/stage-linux-runtime.py'
        spec = importlib.util.spec_from_file_location('stage_linux_runtime', script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)/'root'
            module.stage(source, target, 'server')
            manifest = json.loads((target/'etc/nori/runtime-files.json').read_text())
            self.assertTrue(manifest['nexus_transport_bundled'])
            self.assertFalse(manifest['nexus_listener_enabled_by_default'])
            init_script = target/'etc/init.d/S61nori-nexus'
            self.assertTrue(init_script.read_text().startswith('#!/bin/sh\n'))
            if os.name == 'posix':
                self.assertTrue(init_script.stat().st_mode & 0o111)
            self.assertFalse((target/'etc/nori/nexus.env').exists())
            self.assertTrue((target/'etc/nori/nexus.env.example').is_file())
            admin = target/'usr/bin/nori-nexus-admin'
            self.assertTrue(admin.read_text().startswith('#!/bin/sh\n'))
            if os.name == 'posix':
                self.assertTrue(admin.stat().st_mode & 0o111)


if __name__ == '__main__':
    unittest.main()
