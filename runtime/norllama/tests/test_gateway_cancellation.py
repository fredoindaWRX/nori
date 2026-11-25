import asyncio
from pathlib import Path
import sys
import threading
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch, AsyncMock
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'nori'))
from council_gateway import CouncilGateway


class GatewayCancellationTests(unittest.IsolatedAsyncioTestCase):
    async def test_cancelled_bus_request_drains_matching_chat_job(self):
        root = Path(__file__).resolve().parents[3]
        started, stopped = asyncio.Event(), asyncio.Event()
        class Gateway(CouncilGateway):
            async def _execute(self, message):
                started.set()
                try: await asyncio.sleep(30)
                finally: stopped.set()
        with tempfile.TemporaryDirectory(prefix='.native-cancel-probe-', dir=root / 'verification') as state:
            gateway = Gateway({}, 'x' * 32, Path(state) / 'audit.sqlite3')
            await gateway.start()
            try:
                pending = asyncio.create_task(gateway.request('architect', 'chat', {'goal': 'fixture'}, 'x' * 32))
                await asyncio.wait_for(started.wait(), 3)
                pending.cancel()
                with self.assertRaises(asyncio.CancelledError): await pending
                self.assertTrue(stopped.is_set())
                self.assertEqual(gateway.pending, {})
                await asyncio.sleep(0)
                self.assertEqual(gateway.request_jobs, {})
            finally: await gateway.stop()
    async def test_async_cancellation_signals_and_joins_owned_generation(self):
        started, finished = threading.Event(), threading.Event()
        def generate(worker, goal, *, cancel_event):
            started.set()
            if not cancel_event.wait(3): raise AssertionError('cancellation not delivered')
            finished.set()
            raise RuntimeError('cancelled fixture')
        gateway = object.__new__(CouncilGateway)
        with patch('machine_transport.generate', generate):
            task = asyncio.create_task(gateway.generate_inference(SimpleNamespace(native_inference=object()), 'fixture'))
            self.assertTrue(await asyncio.to_thread(started.wait, 3))
            task.cancel()
            with self.assertRaises(asyncio.CancelledError): await task
        self.assertTrue(finished.is_set())
    async def test_native_success_returns_result(self):
        gateway = object.__new__(CouncilGateway)
        with patch('machine_transport.generate', lambda worker, goal, **kwargs: {'response': 'fixture'}):
            self.assertEqual(await gateway.generate_inference(SimpleNamespace(native_inference=object()), 'fixture'),
                             {'response': 'fixture'})
    async def test_unauthorized_work_cancel_leaves_state_and_inference_untouched(self):
        from work_sessions import WorkSessionManager
        manager = object.__new__(WorkSessionManager)
        state = {'task_id': 'fixture', 'status': 'running', 'cancel_requested': False}
        pending = asyncio.create_task(asyncio.sleep(30))
        manager.sessions = {'fixture': state}
        manager.native_inference_requests = {'fixture': pending}
        manager._auth = AsyncMock(side_effect=PermissionError('fixture denial'))
        manager._event = lambda *args: self.fail('denied cancellation emitted an event')
        try:
            with self.assertRaises(PermissionError): await manager.cancel('fixture', 'wrong')
            self.assertEqual(state['status'], 'running')
            self.assertFalse(state['cancel_requested'])
            self.assertFalse(pending.cancelling())
        finally:
            pending.cancel()
            await asyncio.gather(pending, return_exceptions=True)
    async def test_terminal_work_cancel_does_not_rewrite_completed_evidence(self):
        from work_sessions import WorkSessionManager
        manager = object.__new__(WorkSessionManager)
        state = {'task_id': 'fixture', 'status': 'completed', 'cancel_requested': False,
                 'artifacts': ['saved-fixture']}
        manager.sessions = {'fixture': state}
        manager._auth = AsyncMock()
        manager._event = lambda *args: self.fail('terminal cancellation emitted an event')
        self.assertEqual(await manager.cancel('fixture', 'fixture-key'), state)
        self.assertEqual(state['status'], 'completed')
    async def test_work_cancel_interrupts_native_inference_but_preserves_saved_evidence(self):
        from work_sessions import WorkSessionManager
        started, stopped = asyncio.Event(), asyncio.Event()
        async def request(*args):
            started.set()
            try: await asyncio.sleep(30)
            finally: stopped.set()
        manager = object.__new__(WorkSessionManager)
        manager.gateway = SimpleNamespace(workers={'architect': SimpleNamespace(native_inference=object())}, request=request)
        state = {'task_id': 'fixture', 'status': 'running', 'cancel_requested': False, 'artifacts': ['saved-fixture']}
        manager.sessions, manager.native_inference_requests, manager.stopping = {'fixture': state}, {}, False
        manager._auth = AsyncMock()
        manager._event = lambda *args: None
        pending = asyncio.create_task(manager._request(state, 'credential-fixture', 'architect', 'chat', {'goal': 'fixture'}))
        await started.wait()
        result = await manager.cancel('fixture', 'credential-fixture')
        self.assertEqual(result['status'], 'cancelling')
        self.assertEqual(result['artifacts'], ['saved-fixture'])
        with self.assertRaises(asyncio.CancelledError): await pending
        self.assertTrue(stopped.is_set())
        self.assertEqual(manager.native_inference_requests, {})


if __name__ == '__main__': unittest.main()
