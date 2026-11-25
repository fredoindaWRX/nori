from pathlib import Path
import sys
import tempfile
import unittest
from types import SimpleNamespace
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
import subprocess
import json
import time
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'nori/shared'))
from memory.native_documents import NativeDocumentMemory
from permissions.nori_policy import Policy


class NativeDocumentTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=ROOT / 'verification')
        self.root = Path(self.temporary.name)
        self.policy = Policy(['memory_read', 'memory_write'])
        self.store = NativeDocumentMemory(self.root, self.policy)

    def tearDown(self):
        self.temporary.cleanup()

    def test_durable_exact_roundtrip_and_missing_document(self):
        text = 'Nori\n🟣 exact whitespace  '
        self.store.write('fixture', text)
        restarted = NativeDocumentMemory(self.root, self.policy)
        self.assertEqual(restarted.read('fixture'), text)
        self.assertIsNone(restarted.read_optional('missing'))

    def test_permissions_before_read_or_write(self):
        self.store.policy = Policy([])
        with self.assertRaises(PermissionError): self.store.write('fixture', 'denied')
        with self.assertRaises(PermissionError): self.store.read_optional('fixture')

    def test_invalid_names_and_bounded_documents_preserve_existing_bytes(self):
        self.store.write('fixture', 'original')
        for name in ('../escape', 'owner_fingerprint', 'covenant', ''):
            with self.assertRaises(ValueError): self.store.write(name, 'invalid')
        with self.assertRaises(ValueError): self.store.write('fixture', 'x' * (self.store.MAX_DOCUMENT_BYTES + 1))
        self.assertEqual(self.store.read('fixture'), 'original')

    def test_full_store_refuses_new_document_but_allows_update(self):
        self.store.MAX_DOCUMENTS = 1
        self.store.write('fixture', 'original')
        with self.assertRaises(ValueError): self.store.write('other', 'overflow')
        self.store.write('fixture', 'updated')
        self.assertEqual(self.store.read('fixture'), 'updated')

    def test_search_literal_unicode_order_limit_and_restart(self):
        for index in reversed(range(25)):
            self.store.write('doc%02d' % index, 'Straße literal %_')
        restarted = NativeDocumentMemory(self.root, self.policy)
        results = restarted.search('STRASSE')
        self.assertEqual(len(results), 20)
        self.assertEqual(results[0]['relative_path'], 'nori/doc00')
        self.assertEqual(results[-1]['relative_path'], 'nori/doc19')
        self.assertEqual(len(restarted.search('%_')), 20)
        self.assertEqual(restarted.search("' OR 1=1 --"), [])

    def test_search_permission_and_query_bounds(self):
        for query in ('', '   ', 'x' * 1001, None):
            with self.assertRaises(ValueError): self.store.search(query)
        self.store.policy = Policy([])
        with self.assertRaises(PermissionError): self.store.search('fixture')

    def test_deletion_marker_is_durable_idempotent_and_permission_gated(self):
        self.store.write('fixture', 'Original document bytes')
        with self.assertRaises(PermissionError): self.store.mark_deleted('fixture', 'entry-id')
        self.assertEqual(self.store.deleted_ids('fixture'), set())
        self.store.policy = Policy(['memory_read', 'memory_write', 'memory_delete'])
        self.store.mark_deleted('fixture', 'entry-id')
        self.store.mark_deleted('fixture', 'entry-id')
        restarted = NativeDocumentMemory(self.root, self.store.policy)
        self.assertEqual(restarted.deleted_ids('fixture'), {'entry-id'})
        self.assertEqual(restarted.deleted_ids('other'), set())
        self.assertEqual(restarted.read('fixture'), 'Original document bytes')
        for identity in ('', None, 'x' * 257):
            with self.assertRaises(ValueError): restarted.mark_deleted('fixture', identity)

    def test_competing_connections_enforce_document_limit_transactionally(self):
        stores = [NativeDocumentMemory(self.root, self.policy) for _ in range(8)]
        for store in stores: store.MAX_DOCUMENTS = 4
        barrier = Barrier(len(stores))
        def write(index):
            barrier.wait(timeout=5)
            try:
                stores[index].write('race%d' % index, 'content%d' % index)
                return index
            except ValueError as error:
                self.assertIn('document limit', str(error))
                return None
        with ThreadPoolExecutor(max_workers=len(stores)) as pool:
            admitted = [index for index in pool.map(write, range(len(stores))) if index is not None]
        self.assertEqual(len(admitted), 4)
        restarted = NativeDocumentMemory(self.root, self.policy)
        for index in range(8):
            self.assertEqual(restarted.read_optional('race%d' % index),
                             'content%d' % index if index in admitted else None)

    def test_competing_connections_preserve_all_deletion_markers(self):
        policy = Policy(['memory_read', 'memory_write', 'memory_delete'])
        stores = [NativeDocumentMemory(self.root, policy) for _ in range(8)]
        barrier = Barrier(len(stores))
        def mark(index):
            barrier.wait(timeout=5)
            stores[index].mark_deleted('fixture', 'entry%d' % index)
            stores[index].mark_deleted('fixture', 'shared-entry')
        with ThreadPoolExecutor(max_workers=len(stores)) as pool:
            list(pool.map(mark, range(len(stores))))
        restarted = NativeDocumentMemory(self.root, policy)
        self.assertEqual(restarted.deleted_ids('fixture'),
                         {'entry%d' % index for index in range(8)} | {'shared-entry'})

    def test_separate_process_writers_share_transactional_capacity(self):
        code = r'''
import json, sys
from pathlib import Path
sys.path.insert(0, sys.argv[1])
from memory.native_documents import NativeDocumentMemory
from permissions.nori_policy import Policy
store = NativeDocumentMemory(Path(sys.argv[2]), Policy(['memory_read','memory_write']))
store.MAX_DOCUMENTS = 25
if sys.stdin.readline().strip() != 'go': raise RuntimeError('Missing fixture start')
admitted = []
for index in range(20):
    name = 'process' + sys.argv[3] + '-' + str(index)
    try:
        store.write(name, name + '-content')
        admitted.append(name)
    except ValueError as error:
        if 'document limit' not in str(error): raise
print(json.dumps(admitted))
'''
        children = []
        try:
            for index in range(2):
                children.append(subprocess.Popen(
                    [sys.executable, '-B', '-c', code, str(ROOT / 'nori/shared'),
                     str(self.root), str(index)], stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                    creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0)))
            for child in children:
                child.stdin.write('go\n')
                child.stdin.flush()
            admitted = []
            for child in children:
                output, error = child.communicate(timeout=15)
                self.assertEqual(child.returncode, 0, error)
                admitted.extend(json.loads(output))
            self.assertEqual(len(admitted), 25)
            self.assertEqual(len(set(admitted)), 25)
            restarted = NativeDocumentMemory(self.root, self.policy)
            for index in range(2):
                for sequence in range(20):
                    name = 'process%d-%d' % (index, sequence)
                    self.assertEqual(restarted.read_optional(name),
                                     name + '-content' if name in admitted else None)
        finally:
            for child in children:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=5)
                for stream in (child.stdin, child.stdout, child.stderr):
                    if stream and not stream.closed: stream.close()

    def test_killed_uncommitted_writer_rolls_back_and_releases_database(self):
        self.store.write('fixture', 'committed-original')
        marker = self.root / 'transaction-open.txt'
        code = r'''
import sqlite3, sys, time
from pathlib import Path
connection = sqlite3.connect(sys.argv[1], timeout=3)
connection.execute('PRAGMA synchronous=FULL')
connection.execute('BEGIN IMMEDIATE')
connection.execute('UPDATE documents SET content=? WHERE name=?', ('uncommitted','fixture'))
connection.execute('INSERT INTO documents(name,content) VALUES (?,?)', ('uncommitted-new','partial'))
Path(sys.argv[2]).write_text('transaction-open', encoding='utf8')
time.sleep(30)
'''
        child = subprocess.Popen([sys.executable, '-B', '-c', code,
                                  str(self.store.path), str(marker)],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
                                 creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        try:
            deadline = time.monotonic() + 5
            while not marker.exists() and child.poll() is None and time.monotonic() < deadline:
                time.sleep(.01)
            self.assertTrue(marker.exists(), 'Fixture transaction did not open within deadline')
            self.assertIsNone(child.poll(), 'Writer must still own the uncommitted transaction')
            child.kill()
            child.wait(timeout=5)
            restarted = NativeDocumentMemory(self.root, self.policy)
            self.assertEqual(restarted.read('fixture'), 'committed-original')
            self.assertIsNone(restarted.read_optional('uncommitted-new'))
            restarted.write('fixture', 'committed-after-recovery')
            self.assertEqual(restarted.read('fixture'), 'committed-after-recovery')
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)
            child.stderr.close()


if __name__ == '__main__': unittest.main()
