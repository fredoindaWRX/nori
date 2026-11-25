import os
from pathlib import Path
import subprocess
import sys
import unittest

ROOT=Path(__file__).resolve().parents[3]

@unittest.skipUnless(os.name=='nt','Windows parent-pipe integration')
class CoreParentPipeTests(unittest.TestCase):
    def child(self,tail):
        code=f"import sys,threading;sys.path.insert(0,{str(ROOT / 'nori')!r});from core_supervision import supervise_parent;stop=threading.Event();watcher=supervise_parent(sys.stdin.buffer,stop);"+tail
        return subprocess.Popen([sys.executable,'-I','-B','-c',code],stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE,stderr=subprocess.PIPE)

    def test_startup_exception_with_live_parent_does_not_abort_python(self):
        child=self.child("raise RuntimeError('controlled startup failure')")
        try:
            # Keep stdin open until after exit: this reproduces the previously
            # fatal blocked buffered-reader finalization, rather than hiding it
            # by sending EOF first through communicate().
            self.assertEqual(child.wait(timeout=10),1)
            error=child.stderr.read().decode()
            self.assertIn('controlled startup failure',error)
            self.assertNotIn('Fatal Python error',error)
            self.assertNotIn('_enter_buffered_busy',error)
        finally:
            if child.poll() is None: child.kill();child.wait(timeout=5)
            for pipe in (child.stdin,child.stdout,child.stderr): pipe.close()

    def test_parent_eof_sets_stop_and_watcher_finishes(self):
        child=self.child("print('ready',flush=True);assert stop.wait(5);watcher.join(1);assert not watcher.is_alive()")
        try:
            self.assertEqual(child.stdout.readline(),b'ready\r\n')
            child.stdin.close()
            self.assertEqual(child.wait(timeout=10),0,child.stderr.read().decode())
        finally:
            if child.poll() is None: child.kill();child.wait(timeout=5)
            for pipe in (child.stdin,child.stdout,child.stderr): pipe.close()
