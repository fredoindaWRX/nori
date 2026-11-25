"""Bounded local event lifecycle; no external consumers or effects."""
from pathlib import Path
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'nori/shared'))
from orchestration.sentinel_worker import SentinelWorker
from permissions.nori_policy import Policy


class EventTests(unittest.TestCase):
    def test_payload_snapshot_cancel_bounds_and_policy(self):
        with tempfile.TemporaryDirectory() as directory:
            worker=SentinelWorker(Policy(['event_publish']),Path(directory)/'audit.jsonl')
            payload={'nested':{'value':1}}
            queued=worker.publish('fixture.event',payload)
            payload['nested']['value']=2
            queued['event']['payload']['nested']['value']=3
            self.assertEqual(worker.next_event()['payload']['nested']['value'],1)
            for i in range(1000):
                self.assertEqual(worker.cancel(str(i))['status'],'not_found')
            self.assertEqual(len(worker._cancelled),0)
            queued=worker.publish('fixture.event',{})
            worker.policy=Policy([])
            self.assertEqual(worker.run({'operation':'next'})['status'],'denied')
            self.assertEqual(worker.cancel(queued['event']['id'])['status'],'denied')
            worker.policy=Policy(['event_publish'])
            self.assertEqual(worker.cancel(queued['event']['id'])['status'],'cancelled')
            self.assertIsNone(worker.next_event())
            for payload in [{'bad':float('nan')},{'bad':set()}]:
                with self.assertRaises((ValueError,TypeError)):worker.publish('fixture.event',payload)

    def test_concurrent_publish_cannot_exceed_queue_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            worker=SentinelWorker(Policy(['event_publish']),Path(directory)/'audit.jsonl',maximum_queue=8)
            with ThreadPoolExecutor(max_workers=8) as pool:
                results=list(pool.map(lambda i:worker.publish('fixture.concurrent',{'i':i}),range(40)))
            self.assertEqual(sum(item['status']=='queued' for item in results),8)
            events=[worker.next_event() for _ in range(8)]
            self.assertEqual(len({event['id'] for event in events}),8)
            self.assertIsNone(worker.next_event())
