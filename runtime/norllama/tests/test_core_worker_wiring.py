"""Startup ownership wiring; no sensors, inference, or private data."""
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
import tempfile
from unittest.mock import patch, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'nori' / 'shared'))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'nori'))
from orchestration.core_workers import ROLE_SERVICES, connect_native_workers
from orchestration.knight_runtime import KnightRuntime
from permissions.nori_policy import Policy


class WiringTests(unittest.TestCase):
    def test_managed_roster_constructs_only_owned_services(self):
        names = ['MerovingianWorker', 'SentinelWorker', 'TankWorker', 'MachineWorker',
                 'OracleWorker', 'KeymakerWorker', 'TrinityWorker', 'NeoWorker',
                 'MorpheusWorker', 'SmithWorker', 'ApocWorker', 'ArchitectWorker',
                 'LearningRuntime', 'MemoryStore']
        mocks = {name: Mock(return_value=SimpleNamespace()) for name in names}
        with tempfile.TemporaryDirectory() as temporary, patch.multiple(
                'orchestration.knight_runtime', **mocks):
            workers = {}
            for role, field in ROLE_SERVICES.items():
                runtime = KnightRuntime('http://127.0.0.1:11435', 'fixture',
                                        Policy([]), Path(temporary) / role / 'audit.jsonl',
                                        owned_role=role)
                workers[role] = SimpleNamespace(runtime=runtime)
                for candidate in ROLE_SERVICES.values():
                    self.assertEqual(getattr(runtime, candidate) is not None, candidate == field)
            for constructor in mocks.values(): constructor.assert_called_once()
            connect_native_workers(workers)
            for worker in workers.values():
                self.assertTrue(all(getattr(worker.runtime, field) is not None
                                    for field in ROLE_SERVICES.values()))

    def test_unknown_owned_role_is_refused_before_construction(self):
        with patch('orchestration.knight_runtime.MemoryStore') as store:
            with self.assertRaises(ValueError):
                KnightRuntime('http://127.0.0.1:11435', 'fixture', Policy([]),
                              Path('unused-audit.jsonl'), owned_role='unknown')
            store.assert_not_called()

    def roster(self):
        return {role: SimpleNamespace(runtime=SimpleNamespace(
            **{field: SimpleNamespace(owner=role) for field in ROLE_SERVICES.values()},
            learning_runtime=SimpleNamespace(owner=role))) for role in ROLE_SERVICES}

    def test_all_dispatchers_use_owner_services(self):
        workers = self.roster()
        owned = {field: getattr(workers[role].runtime, field)
                 for role, field in ROLE_SERVICES.items()}
        learning = workers['merovingian'].runtime.learning_runtime
        connect_native_workers(workers)
        for worker in workers.values():
            for field, service in owned.items():
                self.assertIs(getattr(worker.runtime, field), service)
            self.assertIs(worker.runtime.learning_runtime, learning)
        self.assertIs(owned['keymaker_worker'].oracle, owned['oracle_worker'])
        connect_native_workers(workers)
        self.assertIs(workers['architect'].runtime.memory_worker, owned['memory_worker'])

    def test_incomplete_roster_does_not_mutate(self):
        workers = self.roster()
        original = workers['architect'].runtime.memory_worker
        del workers['apoc']
        with self.assertRaises(KeyError):
            connect_native_workers(workers)
        self.assertIs(workers['architect'].runtime.memory_worker, original)

    def test_missing_service_does_not_mutate(self):
        workers = self.roster()
        original = workers['architect'].runtime.memory_worker
        workers['oracle'].runtime.oracle_worker = None
        with self.assertRaises(ValueError):
            connect_native_workers(workers)
        self.assertIs(workers['architect'].runtime.memory_worker, original)
