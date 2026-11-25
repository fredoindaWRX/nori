import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
root = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(root / 'nori'))
sys.path.insert(0, str(root / 'nori/shared'))
from memory.primary_memory import PrimaryMemoryStore
from memory.reconciliation_service import MemoryReconciliationService
from nori_memory import MemoryStore
from permissions.nori_policy import Policy
from memory.native_documents import NativeDocumentMemory
from memory.backend import configure_memory


class PrimaryFixture:
    def __init__(self):
        self.documents, self.offline, self.write_count = {}, False, 0
        self.commit_then_fail = False
    def read_optional(self, block):
        if self.offline: raise ConnectionError('fixture outage')
        return self.documents.get(block)
    def write(self, block, content):
        self.write_count += 1
        self.documents[block] = content
        if self.commit_then_fail:
            self.commit_then_fail = False
            raise ConnectionError('fixture lost acknowledgement')


class MemoryRecoveryTests(unittest.TestCase):
    def test_malformed_pending_entries_cannot_poison_primary(self):
        valid = {'id': 'fixture-id', 'content': 'valid', 'tags': []}
        variants = [{'id': 'fixture-id'}, {**valid, 'content': 42},
                    {**valid, 'tags': [None]}, {**valid, 'id': ''},
                    {**valid, 'id': 'x' * 257}]
        self.store._pending_path.parent.mkdir(parents=True, exist_ok=True)
        for entry in variants:
            with self.subTest(entry=entry):
                content = json.dumps({'schema': self.store._JOURNAL_SCHEMA,
                                      'records': [{'scope': 'fixture', 'entry': entry}]})
                self.store._pending_path.write_text(content, encoding='utf8')
                with self.assertRaises(ValueError): self.store.reconcile()
                self.assertEqual(self.primary.write_count, 0)
                self.assertEqual(self.store._pending_path.read_text(encoding='utf8'), content)

    def test_conflicting_pending_identity_is_preserved_for_recovery(self):
        entries = [{'id': 'same-id', 'content': value, 'tags': []}
                   for value in ('original', 'different')]
        content = json.dumps({'schema': self.store._JOURNAL_SCHEMA,
                              'records': [{'scope': 'fixture', 'entry': entry} for entry in entries]})
        self.store._pending_path.parent.mkdir(parents=True, exist_ok=True)
        self.store._pending_path.write_text(content, encoding='utf8')
        with self.assertRaisesRegex(ValueError, 'Conflicting'): self.store.reconcile()
        self.assertEqual(self.primary.write_count, 0)
        self.assertEqual(self.store._pending_path.read_text(encoding='utf8'), content)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='.memory-recovery-test-', dir=root / 'verification')
        self.path = Path(self.temp.name)
        self.primary = PrimaryFixture()
        self.backup = MemoryStore(self.path / 'cold', Policy(['memory_read', 'memory_write', 'memory_export']), self.path / 'audit.jsonl')
        self.store = PrimaryMemoryStore(self.primary, self.backup)
    def tearDown(self): self.temp.cleanup()
    def test_native_primary_restart_recovery_and_separate_journal(self):
        native_root = self.path / 'native'
        native_root.mkdir()
        primary = NativeDocumentMemory(native_root, self.backup.policy)
        store = PrimaryMemoryStore(primary, self.backup)
        entry, status = store.remember_with_status('fixture', 'Native persistent memory')
        self.assertEqual(status['backend'], 'nori-sqlite')
        self.assertEqual(store._pending_path.name, '.nori-sqlite-pending.json')
        restarted = PrimaryMemoryStore(NativeDocumentMemory(native_root, self.backup.policy), self.backup)
        entries, status = restarted.recall_with_status('fixture')
        self.assertEqual(status['backend'], 'nori-sqlite')
        self.assertEqual([item['id'] for item in entries], [entry['id']])
        local = self.backup.remember('fixture', 'Cold-only fixture')
        result = restarted.reconcile('fixture')
        self.assertTrue(result['local_synced'])
        self.assertTrue(result['primary_synced'])
        self.assertFalse(result['letta_synced'])
        self.assertEqual(result['backend'], 'nori-sqlite')
        entries, _ = restarted.recall_with_status('fixture')
        self.assertEqual({item['id'] for item in entries}, {entry['id'], local['id']})

    def test_managed_core_selects_native_memory_without_mutating_original(self):
        from core_supervision import managed_native_config
        original = {'knights': {'merovingian': {'port': 8799}},
                    'memory': {'backend': 'letta'}, 'sensors': ['fixture']}
        candidate = managed_native_config(original, 'fixture-model')
        primary = configure_memory(candidate, root, self.backup)
        self.assertEqual(primary.backend, 'nori-sqlite')
        self.assertEqual(primary.root, self.backup.root)
        self.assertEqual(original['memory']['backend'], 'letta')
        with self.assertRaises(ValueError):
            configure_memory({'memory': {'backend': 'unknown'}}, root, self.backup)

    def test_export_uses_authoritative_content_and_honest_failover(self):
        entry, _ = self.store.remember_with_status('fixture', 'Cold original')
        block = self.store._block('fixture')
        document = json.loads(self.primary.documents[block])
        document['entries'][0]['content'] = 'Primary latest'
        self.primary.documents[block] = json.dumps(document)
        exported = self.store.export('fixture')
        self.assertEqual(exported['entries'][0]['content'], 'Primary latest')
        self.assertTrue(exported['storage']['primary_available'])
        self.primary.offline = True
        exported = self.store.export('fixture')
        self.assertEqual(exported['entries'][0]['content'], 'Cold original')
        self.assertFalse(exported['storage']['primary_available'])
        self.backup.policy = Policy(['memory_read'])
        with self.assertRaises(PermissionError): self.store.export('fixture')

    def test_corrupt_primary_documents_are_never_rewritten_by_recovery(self):
        block = self.store._block('fixture')
        valid = {'id': 'fixture-id', 'content': 'Original', 'tags': []}
        documents = [
            '{"schema":"nori.memory.v1","scope":"fixture","entries":[],"entries":[]}',
            '{"schema":"nori.memory.v1","scope":"fixture","entries":[],"extra":NaN}',
            json.dumps({'schema':'nori.memory.v1','scope':'fixture','entries':[valid,valid]}),
            json.dumps({'schema':'nori.memory.v1','scope':'fixture','entries':[{'content':'Missing id'}]})]
        for document in documents:
            with self.subTest(document=document):
                self.primary.documents[block] = document
                before = self.primary.write_count
                result = self.store.reconcile('fixture')
                self.assertEqual(result['status'], 'retry_pending')
                self.assertFalse(result['primary_synced'])
                self.assertEqual(self.primary.write_count, before)
                self.assertEqual(self.primary.documents[block], document)

    def test_native_forget_survives_restart_pending_replay_and_backup_recovery(self):
        self.backup.policy = Policy(['memory_read','memory_write','memory_export','memory_delete'])
        primary = NativeDocumentMemory(self.backup.root, self.backup.policy)
        store = PrimaryMemoryStore(primary, self.backup)
        deleted, _ = store.remember_with_status('fixture', 'Forget synthetic entry')
        kept, _ = store.remember_with_status('fixture', 'Keep synthetic entry')
        store.forget('fixture', deleted['id'])
        # Original cold bytes deliberately survive; the marker must suppress them.
        self.assertIn(deleted['id'], {entry['id'] for entry in self.backup.export('fixture')['entries']})
        restarted = PrimaryMemoryStore(NativeDocumentMemory(self.backup.root,self.backup.policy), self.backup)
        restarted._write_pending([{'scope':'fixture','entry':deleted}])
        self.assertEqual([entry['id'] for entry in restarted.recall_with_status('fixture')[0]], [kept['id']])
        self.assertEqual([entry['id'] for entry in restarted.export('fixture')['entries']], [kept['id']])
        self.assertEqual(restarted.reconcile()['pending'], 0)
        self.assertEqual(restarted.reconcile('fixture')['entries_count'], 1)
        self.assertEqual([entry['id'] for entry in restarted.recall_with_status('fixture')[0]], [kept['id']])
        with patch.object(restarted.primary, 'read_optional', side_effect=ConnectionError('fixture')):
            self.assertEqual([entry['id'] for entry in restarted.recall_with_status('fixture')[0]], [kept['id']])
        with patch.object(restarted.primary, 'deleted_ids', side_effect=ConnectionError('fixture')):
            with self.assertRaises(ConnectionError): restarted.recall_with_status('fixture')

    def test_forget_denial_and_marker_failure_preserve_visible_memory(self):
        primary = NativeDocumentMemory(self.backup.root,self.backup.policy)
        store = PrimaryMemoryStore(primary,self.backup)
        entry, _ = store.remember_with_status('fixture','Preserve synthetic entry')
        with self.assertRaises(PermissionError): store.forget('fixture',entry['id'])
        self.backup.policy = Policy(['memory_read','memory_write','memory_export','memory_delete'])
        primary.policy = self.backup.policy
        with patch.object(primary,'mark_deleted',side_effect=OSError('fixture write failure')):
            with self.assertRaises(OSError): store.forget('fixture',entry['id'])
        self.assertEqual(primary.deleted_ids(store._block('fixture')),set())
        self.assertEqual([item['id'] for item in store.recall_with_status('fixture')[0]],[entry['id']])
        with self.assertRaises(KeyError): store.forget('fixture','unknown-id')
        self.assertEqual(primary.deleted_ids(store._block('fixture')),set())

    def test_invalid_pending_journal_is_not_rewritten(self):
        documents = [
            '{"schema":"nori.memory-pending.v1","records":[],"records":[]}',
            '{"schema":"nori.memory-pending.v1","records":[],"extra":Infinity}',
            'x' * (2 * 1024 * 1024 + 1)]
        self.store._pending_path.parent.mkdir(parents=True,exist_ok=True)
        for document in documents:
            with self.subTest(size=len(document)):
                self.store._pending_path.write_text(document,encoding='utf-8')
                before = self.primary.write_count
                with self.assertRaises(ValueError): self.store.reconcile()
                self.assertEqual(self.primary.write_count,before)
                self.assertEqual(self.store._pending_path.read_text(encoding='utf-8'),document)
                backup_path = self.backup._path('fixture')
                with self.assertRaises(ValueError):
                    self.store.remember_with_status('fixture','Must not partially accept')
                self.assertFalse(backup_path.exists())

    def test_journal_capacity_is_checked_before_accepting_backup_entry(self):
        self.store._MAX_JOURNAL_BYTES = 200
        self.store._write_pending([])
        original = self.store._pending_path.read_bytes()
        with self.assertRaises(ValueError):
            self.store.remember_with_status('fixture','x' * 150)
        self.assertFalse(self.backup._path('fixture').exists())
        self.assertEqual(self.store._pending_path.read_bytes(),original)
        self.assertEqual(self.primary.write_count,0)
    def test_pending_survives_restart_and_reconciles_without_duplicate(self):
        self.primary.offline = True
        entry, status = self.store.remember_with_status('fixture', 'Test memory only')
        self.assertFalse(status['primary_available'])
        restarted = PrimaryMemoryStore(self.primary, self.backup)
        self.assertEqual(restarted.pending_count(), 1)
        service = MemoryReconciliationService(restarted)
        self.assertEqual(service.tick()['pending'], 1)
        self.primary.offline = False
        self.primary.commit_then_fail = True
        self.assertEqual(service.tick()['pending'], 1)
        self.assertEqual(service.tick()['pending'], 0)
        self.assertEqual(service.tick()['attempted'], 0)
        document = json.loads(next(iter(self.primary.documents.values())))
        self.assertEqual([item['id'] for item in document['entries']], [entry['id']])
        service.start()
        self.assertTrue(service.status()['running'])
        self.assertTrue(service.stop())
    def test_scoped_recovery_never_overwrites_unread_primary(self):
        self.store.remember_with_status('fixture', 'Local test entry')
        block = self.store._block('fixture')
        document = json.loads(self.primary.documents[block])
        document['entries'].append({'id': 'primary-only', 'content': 'Primary-only test record', 'tags': []})
        self.primary.documents[block] = json.dumps(document)
        original = self.primary.documents[block]
        self.primary.offline = True
        before = self.primary.write_count
        result = self.store.reconcile('fixture')
        self.assertFalse(result['letta_synced'])
        self.assertEqual(self.primary.write_count, before)
        self.assertEqual(self.primary.documents[block], original)
    def test_scoped_recovery_requires_memory_write_permission(self):
        self.backup.policy = Policy(['memory_read', 'memory_export'])
        with self.assertRaises(PermissionError): self.store.reconcile('fixture')
        self.assertEqual(self.primary.write_count, 0)
    def test_scoped_recovery_preserves_primary_content_and_local_only_entries(self):
        entry, _ = self.store.remember_with_status('fixture', 'Original local text')
        block = self.store._block('fixture')
        document = json.loads(self.primary.documents[block])
        document['entries'][0]['content'] = 'Updated primary text'
        self.primary.documents[block] = json.dumps(document)
        local_only = self.backup.remember('fixture', 'Local-only recovery text')
        result = self.store.reconcile('fixture')
        self.assertTrue(result['letta_synced'])
        self.assertTrue(result['local_synced'])
        primary_entries = json.loads(self.primary.documents[block])['entries']
        self.assertEqual({item['id'] for item in primary_entries}, {entry['id'], local_only['id']})
        self.assertEqual(self.backup.recall('fixture')[0]['content'], 'Updated primary text')
        self.assertEqual(self.store.reconcile('fixture')['entries_count'], 2)
    def test_mirror_failure_is_reported_and_original_backup_survives(self):
        self.store.remember_with_status('fixture', 'Original test memory')
        backup_path = self.backup._path('fixture')
        original = backup_path.read_bytes()
        real_replace = Path.replace
        def failed_replace(path, target):
            if path.suffix == '.reconciled': raise OSError('private fixture failure')
            return real_replace(path, target)
        with patch.object(Path, 'replace', failed_replace):
            result = self.store.reconcile('fixture')
        self.assertFalse(result['local_synced'])
        self.assertEqual(result['error'], 'OSError')
        self.assertEqual(backup_path.read_bytes(), original)


if __name__ == '__main__': unittest.main()
