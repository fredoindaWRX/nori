"""Recovered development-router tests; mocks only, never CLI dispatch."""
import unittest
from pathlib import Path
from unittest.mock import AsyncMock
from nori.development_workers.base import DevelopmentWorkerAdapter, WorkerMetadata, WorkerHealth, DispatchMode, WorkOrder, WorkResult
from nori.development_workers.router import DevelopmentWorkerRouter


class MockWorker(DevelopmentWorkerAdapter):
    async def dispatch(self, order):
        raise AssertionError('Instance fixture must replace dispatch')

    async def get_status(self):
        return self.metadata

    async def cancel(self, task_id):
        return True

    def __init__(self, name, priority=0):
        super().__init__(WorkerMetadata(name, 'fixture', DispatchMode.DIRECT,
            ['coding'], ['implementation'], True, priority=priority))
        self.dispatch = AsyncMock()
        self.get_status = AsyncMock(side_effect=lambda: self.metadata)
        self.cancel = AsyncMock(return_value=True)


class WorkerRouterTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.router = DevelopmentWorkerRouter()
        self.order = WorkOrder('fixture', 'Inspect fixture', [Path('fixture.py')],
            [Path('fixture.py')], 'prepared', 'propose', 'fixture evidence', timeout_seconds=1)
        self.low, self.high = MockWorker('low', 1), MockWorker('high', 10)
        self.router.register_worker(self.low)
        self.router.register_worker(self.high)

    async def test_priority_selection(self):
        self.assertIs(await self.router.get_best_worker(['coding']), self.high)

    async def test_exhausted_preferred_worker_not_selected(self):
        self.high.metadata.health = WorkerHealth.QUOTA_EXHAUSTED
        self.assertIs(await self.router.get_best_worker(['coding']), self.low)

    async def test_dispatch_quota_failover(self):
        self.high.dispatch.return_value = WorkResult(False, '', '', [], -1, 'QUOTA_EXHAUSTED')
        self.low.dispatch.return_value = WorkResult(True, 'Fixture', '', [], 0)
        self.assertTrue((await self.router.dispatch_with_failover(self.order)).success)
        self.high.dispatch.assert_awaited_once()
        self.low.dispatch.assert_awaited_once()

    async def test_reported_timeout_failover(self):
        self.high.dispatch.return_value = WorkResult(False, '', '', [], -1, 'TIMEOUT')
        self.low.dispatch.return_value = WorkResult(True, 'Fixture', '', [], 0)
        self.assertTrue((await self.router.dispatch_with_failover(self.order)).success)
        self.low.dispatch.assert_awaited_once()

    async def test_context_exhaustion_skips_attempted_worker_without_changing_global_health(self):
        self.high.dispatch.return_value = WorkResult(False, '', '', [], -1, 'CONTEXT_EXHAUSTED')
        self.low.dispatch.return_value = WorkResult(True, 'Fixture', '', [], 0)
        result = await self.router.dispatch_with_failover(self.order)
        self.assertTrue(result.success)
        self.high.dispatch.assert_awaited_once()
        self.low.dispatch.assert_awaited_once()
        self.assertEqual(self.high.metadata.health, WorkerHealth.HEALTHY)

    async def test_exclusion_does_not_refresh_or_dispatch_excluded_worker(self):
        result = await self.router.get_best_worker(['coding'], excluded_worker_ids=['high'])
        self.assertIs(result, self.low)
        self.high.get_status.assert_not_awaited()
        self.high.dispatch.assert_not_awaited()

    async def test_busy_or_exhausted_metadata_flags_prevent_selection(self):
        for flag in ('busy', 'waiting_for_auth', 'usage_exhausted', 'context_exhausted'):
            with self.subTest(flag=flag):
                setattr(self.high.metadata, flag, True)
                self.assertIs(await self.router.get_best_worker(['coding']), self.low)
                setattr(self.high.metadata, flag, False)
        self.high.metadata.health = WorkerHealth.BUSY
        self.assertIs(await self.router.get_best_worker(['coding']), self.low)
        self.high.dispatch.assert_not_awaited()

    async def test_no_compatible_workers_never_dispatches(self):
        self.assertIsNone(await self.router.get_best_worker(['quantum-coding']))
        self.low.dispatch.assert_not_awaited()
        self.high.dispatch.assert_not_awaited()

    async def test_all_workers_fail(self):
        for worker in (self.low, self.high):
            worker.dispatch.return_value = WorkResult(False, '', '', [], -1, 'QUOTA_EXHAUSTED')
        result = await self.router.dispatch_with_failover(self.order)
        self.assertFalse(result.success)
        self.assertIn(result.error_type, {'ALL_WORKERS_FAILED', 'NO_WORKER_AVAILABLE'})
        self.low.dispatch.assert_awaited_once()
        self.high.dispatch.assert_awaited_once()


if __name__ == '__main__':
    unittest.main()
