from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from norllama import WorkerLifetimeWatcher


class WorkerLifetimeTests(unittest.TestCase):
    def test_healthy_close_does_not_report_failure_or_shutdown(self):
        inspected = threading.Event()
        client = Mock()
        client.health.side_effect = lambda: (inspected.set() or {"ready": True})
        shutdown = Mock()
        watcher = WorkerLifetimeWatcher(client, shutdown)
        watcher.start()
        self.assertTrue(inspected.wait(2))
        watcher.close()
        self.assertFalse(watcher.thread.is_alive())
        self.assertFalse(watcher.failure_detected)
        shutdown.assert_not_called()

    def test_unavailable_worker_triggers_one_shutdown_and_quiesces(self):
        for health in ({"ready": False}, {"ready": None}, {}):
            with self.subTest(health=health):
                client = Mock()
                client.health.return_value = health
                shutdown = Mock()
                watcher = WorkerLifetimeWatcher(client, shutdown)
                watcher.start()
                watcher.thread.join(2)
                watcher.close()
                self.assertTrue(watcher.failure_detected)
                self.assertFalse(watcher.thread.is_alive())
                shutdown.assert_called_once_with()

    def test_health_exception_fails_closed_without_private_error_text(self):
        client = Mock()
        client.health.side_effect = RuntimeError("private fixture body")
        shutdown = Mock()
        watcher = WorkerLifetimeWatcher(client, shutdown)
        watcher.start()
        watcher.thread.join(2)
        watcher.close()
        self.assertTrue(watcher.failure_detected)
        shutdown.assert_called_once_with()

    def test_closed_before_start_does_not_activate_shutdown(self):
        client, shutdown = Mock(), Mock()
        watcher = WorkerLifetimeWatcher(client, shutdown)
        watcher.close()
        watcher.start()
        watcher.thread.join(2)
        self.assertFalse(watcher.failure_detected)
        client.health.assert_not_called()
        shutdown.assert_not_called()


if __name__ == '__main__':
    unittest.main()
