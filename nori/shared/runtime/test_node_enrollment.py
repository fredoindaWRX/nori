import concurrent.futures
import tempfile
import unittest
from pathlib import Path
from node_enrollment import EnrollmentStore


class EnrollmentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'peers.db'
        self.now = 1000
        self.principal = 'owner.vanguard.001'
        self.store = EnrollmentStore(self.path, 'home-A', self.principal, clock=lambda: self.now)
        self.fp = 'a' * 64

    def test_scope_identity_replay_and_restart(self):
        token = self.store.issue('server', self.fp)
        for home, node, fp in [('home-B', 'server', self.fp), ('home-A', 'other', self.fp), ('home-A', 'server', 'b'*64)]:
            self.assertFalse(self.store.redeem(home, self.principal, node, fp, token))
        self.assertFalse(self.store.redeem('home-A', 'owner.other.002', 'server', self.fp, token))
        self.assertTrue(self.store.redeem('home-A', self.principal, 'server', self.fp, token))
        self.assertFalse(self.store.redeem('home-A', self.principal, 'server', self.fp, token))
        reopened = EnrollmentStore(self.path, 'home-A', self.principal)
        self.assertTrue(reopened.trusted('home-A', self.principal, 'server', self.fp))
        self.assertFalse(reopened.trusted('home-B', self.principal, 'server', self.fp))
        self.assertFalse(reopened.trusted('home-A', 'owner.other.002', 'server', self.fp))
        with self.assertRaises(ValueError):
            EnrollmentStore(self.path, 'home-B', self.principal)
        with self.assertRaises(ValueError):
            EnrollmentStore(self.path, 'home-A', 'owner.other.002')

    def test_expiry_reissue_revoke(self):
        expired = self.store.issue('server', self.fp, ttl=1)
        self.now += 1
        self.assertFalse(self.store.redeem('home-A', self.principal, 'server', self.fp, expired))
        old = self.store.issue('server', self.fp)
        new = self.store.issue('server', self.fp)
        self.assertFalse(self.store.redeem('home-A', self.principal, 'server', self.fp, old))
        self.assertTrue(self.store.redeem('home-A', self.principal, 'server', self.fp, new))
        pending = self.store.issue('server', self.fp)
        self.store.revoke('server')
        self.assertFalse(self.store.trusted('home-A', self.principal, 'server', self.fp))
        self.assertFalse(self.store.redeem('home-A', self.principal, 'server', self.fp, pending))

    def test_concurrent_redeem_has_one_winner(self):
        token = self.store.issue('server', self.fp)
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(lambda _: self.store.redeem('home-A', self.principal, 'server', self.fp, token), range(4)))
        self.assertEqual(results.count(True), 1)

    def test_certificate_cannot_be_shared_and_token_not_stored(self):
        first = self.store.issue('server', self.fp)
        self.assertTrue(self.store.redeem('home-A', self.principal, 'server', self.fp, first))
        other = self.store.issue('other', self.fp)
        self.assertFalse(self.store.redeem('home-A', self.principal, 'other', self.fp, other))
        self.assertNotIn(first.encode(), self.path.read_bytes())
        self.assertNotIn(other.encode(), self.path.read_bytes())


if __name__ == '__main__':
    unittest.main()
