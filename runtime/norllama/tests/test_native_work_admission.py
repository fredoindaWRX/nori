"""Fixture admission checks; no models, listeners, files or tools are started."""
import asyncio
from copy import deepcopy
import io
import json
from email.message import Message
from pathlib import Path
import sys
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'nori'))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'nori' / 'shared'))
from work_sessions import WorkSessionManager, NativeTaskQualificationError
from work_http import handle_work


def manager_fixture(native=True):
    manager = object.__new__(WorkSessionManager)
    manager.gateway = SimpleNamespace(workers={
        'architect': SimpleNamespace(native_inference=object() if native else None)})
    manager.sessions, manager.tasks, manager.stopping = {}, {}, False
    manager._auth = AsyncMock()
    manager._event = Mock()
    manager._save = Mock(side_effect=AssertionError('Admission must not persist'))
    manager._request = AsyncMock(side_effect=AssertionError('Admission must not dispatch'))
    return manager


class NativeWorkAdmissionTests(unittest.IsolatedAsyncioTestCase):
    async def test_native_create_rejects_before_persistence_or_dispatch(self):
        manager = manager_fixture()
        with self.assertRaises(NativeTaskQualificationError):
            await manager.create('Read notes.txt', 'fixture')
        manager._auth.assert_awaited_once_with('fixture', 'work_create')
        self.assertEqual(manager.sessions, {})
        self.assertEqual(manager.tasks, {})
        manager._save.assert_not_called()
        manager._event.assert_not_called()
        manager._request.assert_not_awaited()

    async def test_auth_denial_takes_precedence_over_qualification(self):
        manager = manager_fixture()
        manager._auth.side_effect = PermissionError('fixture denial')
        with self.assertRaises(PermissionError): await manager.create('Read notes.txt', 'wrong')
        self.assertEqual(manager.sessions, {})

    async def test_resume_preserves_saved_evidence_and_task_state(self):
        manager = manager_fixture()
        original = {'goal': 'Read notes.txt', 'status': 'interrupted',
                    'artifacts': ['fixture evidence'], 'response': 'Original failure'}
        manager.sessions['fixture'] = deepcopy(original)
        with self.assertRaises(NativeTaskQualificationError): await manager.resume('fixture', 'fixture')
        self.assertEqual(manager.sessions['fixture'], original)
        self.assertEqual(manager.tasks, {})
        manager._save.assert_not_called()
        manager._event.assert_not_called()

    async def test_recovered_internal_run_blocks_before_legacy_planner(self):
        manager = manager_fixture()
        state = {'task_id': 'fixture', 'goal': 'Read notes.txt', 'status': 'queued',
                 'artifacts': ['fixture evidence'], 'executed_tools': [],
                 'accepted_review': {'decision': 'accept'}, 'execution_authorized': True}
        await manager._run(state, 'fixture')
        self.assertEqual(state['status'], 'blocked')
        self.assertEqual(state['failure']['kind'], 'native_task_execution_unqualified')
        self.assertEqual(state['artifacts'], ['fixture evidence'])
        self.assertEqual(state['executed_tools'], [])
        manager._request.assert_not_awaited()

    async def test_standalone_greeting_still_completes_without_model_or_tools(self):
        manager = manager_fixture()
        manager._cancelled = Mock(return_value=False)
        state = {'goal': 'hey nori', 'executed_tools': []}
        await manager._run(state, 'fixture')
        self.assertEqual(state['status'], 'completed')
        self.assertEqual(state['completion_kind'], 'answer_only')
        manager._request.assert_not_awaited()

    def test_chat_and_closeout_allowed_but_evidence_requests_blocked(self):
        manager = manager_fixture()
        for goal in ('hey nori', '  hello  ', 'What is a star?', '*END'):
            manager._require_work_qualification(goal)
        for goal in ('hey, write a file', 'What is in notes.py?', 'Where am I?',
                     'Check the codebase', 'Can you fix this?', 'read notes.txt'):
            with self.subTest(goal=goal), self.assertRaises(NativeTaskQualificationError):
                manager._require_work_qualification(goal)

    def test_mixed_worker_configuration_cannot_bypass_gate(self):
        manager = manager_fixture(native=False)
        manager.gateway.workers['neo'] = SimpleNamespace(native_inference=object())
        with self.assertRaises(NativeTaskQualificationError):
            manager._require_work_qualification('Read notes.txt')

    def test_legacy_mode_is_not_changed_or_certified_by_native_gate(self):
        manager = manager_fixture(native=False)
        manager._require_work_qualification('Read notes.txt')
        manager.worker_activation = SimpleNamespace(snapshot=lambda: {})
        manager.delivery_recovery = []
        self.assertIsNone(manager.runtime_status()['native_task_execution_qualified'])
        manager.gateway.workers['architect'].native_inference = object()
        self.assertIs(manager.runtime_status()['native_task_execution_qualified'], False)


class NativeWorkHttpTests(unittest.TestCase):
    def test_supplied_review_or_permission_fields_cannot_enter_work_admission(self):
        manager = manager_fixture()
        gateway = SimpleNamespace(work_sessions=manager, loop=None)
        for field, value in [('accepted_review', {'decision': 'accept'}),
                             ('review', {'decision': 'accept', 'issues': []}),
                             ('execution_authorized', True), ('qualification_passed', True)]:
            with self.subTest(field=field):
                body = json.dumps({'goal': 'Read notes.txt', field: value}).encode('utf-8')
                headers = Message()
                for key, item in [('Host', '127.0.0.1:12345'), ('Authorization', 'Bearer fixture'),
                                  ('Content-Type', 'application/json'), ('Content-Length', str(len(body)))]:
                    headers[key] = item
                handler = SimpleNamespace(path='/work', command='POST', headers=headers,
                                          server=SimpleNamespace(server_port=12345), rfile=io.BytesIO(body))
                handler.reply = Mock()
                self.assertTrue(handle_work(handler, SimpleNamespace(knight='architect'), 'fixture', gateway))
                handler.reply.assert_called_once_with(400, {'error': 'invalid_work_request'})
        manager._auth.assert_not_awaited()
        manager._save.assert_not_called()
        manager._request.assert_not_awaited()
        self.assertEqual(manager.sessions, {})

    def test_authenticated_http_reports_specific_gate_and_unauthorized_is_denied(self):
        manager = manager_fixture()
        loop = asyncio.new_event_loop()
        thread = threading.Thread(target=loop.run_forever)
        thread.start()
        gateway = SimpleNamespace(work_sessions=manager, loop=loop,
                                  sentinel=SimpleNamespace(log=Mock()))
        def headers(token):
            result = Message()
            result['Host'] = '127.0.0.1:12345'
            result['Authorization'] = 'Bearer ' + token
            result['Content-Type'] = 'application/json'
            result['Content-Length'] = str(len(b'{"goal":"Read notes.txt"}'))
            return result
        class Handler:
            path, command = '/work', 'POST'
            server = SimpleNamespace(server_port=12345)
            rfile = io.BytesIO(b'{"goal":"Read notes.txt"}')
            def reply(self, status, result): self.result = status, result
        try:
            handler = Handler()
            handler.headers = headers('fixture')
            self.assertTrue(handle_work(handler, SimpleNamespace(knight='architect'), 'fixture', gateway))
            self.assertEqual(handler.result[0], 503)
            self.assertEqual(handler.result[1]['error'], 'native_task_execution_unqualified')
            self.assertIs(handler.result[1]['task_started'], False)
            self.assertEqual(manager.sessions, {})
            handler = Handler()
            handler.headers = headers('wrong')
            self.assertTrue(handle_work(handler, SimpleNamespace(knight='architect'), 'fixture', gateway))
            self.assertEqual(handler.result[0], 401)
            manager._auth.assert_awaited_once()
        finally:
            loop.call_soon_threadsafe(loop.stop)
            thread.join(timeout=3)
            self.assertFalse(thread.is_alive())
            loop.close()


if __name__ == '__main__': unittest.main()
