import io
from pathlib import Path
import sys
import threading
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'nori'))
from core_supervision import managed_native_config, supervise_parent, watch_parent


class CoreSupervisionTests(unittest.TestCase):
    def test_parent_eof_requests_shutdown_without_killing_other_processes(self):
        stop = threading.Event()
        watcher = supervise_parent(io.BytesIO(b'owned-parent-data'), stop)
        watcher.join(2)
        self.assertFalse(watcher.is_alive())
        self.assertTrue(stop.is_set())

    def test_managed_config_is_explicit_ephemeral_sensor_free_and_does_not_mutate_source(self):
        source = {'knights': {'architect': {'port': 9107, 'model': 'historical'}},
                  'sensors': [{'type': 'screen'}], 'other': {'preserve': True}}
        candidate = managed_native_config(source, 'llama3.2-3b-instruct')
        self.assertEqual(candidate['knights']['architect']['port'], 0)
        self.assertEqual(candidate['sensors'], [])
        self.assertEqual(candidate['native_inference']['assignments'], {'architect': 'llama3.2-3b-instruct'})
        self.assertEqual(source['knights']['architect']['port'], 9107)
        self.assertEqual(source['sensors'], [{'type': 'screen'}])
        candidate['other']['preserve'] = False
        self.assertTrue(source['other']['preserve'])

    def test_managed_config_refuses_implicit_or_malformed_model(self):
        for identifier in [None, '', 'wrong model', '../model', 'x' * 129]:
            with self.assertRaises(ValueError): managed_native_config({'knights': {}}, identifier)
    def test_pipe_failure_also_requests_shutdown(self):
        class Broken:
            def read(self, count): raise OSError('fixture pipe error')
        stop = threading.Event()
        with self.assertRaises(OSError): watch_parent(Broken(), stop)
        self.assertTrue(stop.is_set())
