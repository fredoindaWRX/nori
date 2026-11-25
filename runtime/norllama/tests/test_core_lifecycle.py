import asyncio
from pathlib import Path
import sys
import threading
import sqlite3
import tempfile
from types import SimpleNamespace
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'nori'))
from core_lifecycle import close_core_services


class LifecycleTests(unittest.TestCase):
    def test_proactive_database_connections_close_after_success_and_rollback(self):
        from proactive_routines import ProactiveRoutineService
        root = Path(__file__).resolve().parents[3]
        with tempfile.TemporaryDirectory(prefix='.proactive-close-test-', dir=root / 'verification') as state:
            service = ProactiveRoutineService(Path(state) / 'routines.sqlite3', None)
            with service._connect() as connection:
                connection.execute('SELECT 1')
            with self.assertRaises(sqlite3.ProgrammingError): connection.execute('SELECT 1')
            with self.assertRaises(RuntimeError):
                with service._connect() as failed:
                    raise RuntimeError('rollback fixture')
            with self.assertRaises(sqlite3.ProgrammingError): failed.execute('SELECT 1')
    def test_cleanup_continues_after_multiple_failures_and_closes_loop(self):
        calls = []
        loop = asyncio.new_event_loop()
        thread = threading.Thread(target=loop.run_forever)
        thread.start()
        class Service:
            def __init__(self, name, fail=False): self.name, self.fail = name, fail
            async def stop(self):
                calls.append(self.name)
                if self.fail: raise RuntimeError('private error text')
        class Server:
            def shutdown(self):
                calls.append('http_shutdown')
                raise RuntimeError('failed fixture listener')
            def server_close(self): calls.append('http_close')
        class Memory:
            def stop(self):
                calls.append('memory')
                raise RuntimeError('failed fixture memory')
        class Sensory:
            def stop(self):
                calls.append('sensory')
                return {'stopped': True, 'publisher_stopped': True}
        gateway = Service('gateway')
        gateway.sentinel = SimpleNamespace(locked=False)
        gateway.proactive_routines = Service('proactive', fail=True)
        gateway.work_sessions = Service('work')
        failures = close_core_services(loop, thread, gateway, [Server()], Sensory(), Memory())
        self.assertEqual(failures, ['http_shutdown', 'memory_reconciliation', 'proactive_routines'])
        self.assertEqual(calls, ['http_shutdown', 'http_close', 'memory', 'sensory', 'proactive', 'work', 'gateway'])
        self.assertTrue(gateway.sentinel.locked)
        self.assertFalse(thread.is_alive())
        self.assertTrue(loop.is_closed())
        self.assertNotIn('private', str(failures))


if __name__ == '__main__': unittest.main()
