"""Local learning evidence integrity, not training/model qualification."""
import json
import hashlib
from pathlib import Path
import sys
import tempfile
import subprocess
import os
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'nori/shared'))
from learning.candidate_gate import evaluate
from learning.experience_store import ExperienceStore


class LearningIntegrityTests(unittest.TestCase):
    def test_separate_process_writers_preserve_single_chain(self):
        script = '''
import sys
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from learning.experience_store import ExperienceStore
store=ExperienceStore(Path(sys.argv[2]))
for i in range(20):
    store.append(dict(task_id=sys.argv[3]+str(i),knight='neo',capability='coding',outcome='completed',score=0.5,training_opt_in=False))
'''
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'experience.jsonl'
            shared=str(Path(__file__).resolve().parents[3]/'nori/shared')
            processes=[subprocess.Popen([sys.executable,'-B','-c',script,shared,str(path),prefix],
                stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0) for prefix in ['first-','second-']]
            try:
                for process in processes:
                    _,error=process.communicate(timeout=15)
                    self.assertEqual(process.returncode,0,error.decode())
                records=ExperienceStore(path).verified_records()
                self.assertEqual(len(records),40)
                self.assertEqual(len({item['task_id'] for item in records}),40)
            finally:
                for process in processes:
                    if process.poll() is None:
                        process.kill()
                        process.communicate(timeout=5)

    def test_busy_writer_times_out_without_touching_history(self):
        from learning.writer_lock import writer_lock
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'fixture.writer-lock'
            with writer_lock(path):
                with self.assertRaisesRegex(TimeoutError,'learning_writer_busy'):
                    with writer_lock(path,timeout=0.02): pass
            with writer_lock(path,timeout=0.02): pass

    def test_rehashed_invalid_records_and_capacity_refuse_without_mutation(self):
        request={'task_id':'fixture','knight':'neo','capability':'coding','outcome':'completed',
                 'score':0.5,'training_opt_in':True,'sample':'synthetic example'}
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'experience.jsonl'
            store=ExperienceStore(path)
            valid=store.append(request)
            for field,value in [('score',2),('training_opt_in',False),('sample_sha256','0'*64),('schema','unknown'),('recorded_at','yesterday')]:
                record={**valid,field:value}
                body={key:value for key,value in record.items() if key!='record_hash'}
                record['record_hash']=hashlib.sha256(json.dumps(body,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest()
                path.write_text(json.dumps(record)+'\n',encoding='utf-8')
                self.assertFalse(store.verify())
            path.write_text(json.dumps(valid)+'\n',encoding='utf-8')
            before=path.read_bytes()
            with patch('learning.experience_store.MAX_LOG_BYTES',len(before)+1):
                with self.assertRaisesRegex(ValueError,'capacity'): store.append(request)
            with patch('learning.experience_store.MAX_RECORDS',1):
                with self.assertRaisesRegex(ValueError,'capacity'): store.append(request)
            self.assertEqual(path.read_bytes(),before)
            duplicate=json.dumps(valid)[:-1]+',"score":0.5}\n'
            path.write_text(duplicate,encoding='utf-8')
            self.assertFalse(store.verify())

    def test_each_consumer_uses_one_verified_snapshot(self):
        request={'task_id':'fixture','knight':'neo','capability':'coding','outcome':'completed',
                 'score':0.5,'training_opt_in':True,'sample':'synthetic opted-in example'}
        with tempfile.TemporaryDirectory() as directory:
            store=ExperienceStore(Path(directory)/'experience.jsonl')
            valid=store.append(request)
            changed={**valid,'sample':'unverified replacement','score':1}
            for consumer in [store.training_examples,store.routing_scores,store.status_snapshot,store._last_hash]:
                with self.subTest(consumer=consumer.__name__), patch.object(store,'records',side_effect=[[valid],[changed]]) as read:
                    result=consumer()
                    self.assertEqual(read.call_count,1)
                    self.assertNotIn('unverified replacement',str(result))
            with patch.object(store,'records',return_value=[changed]):
                with self.assertRaisesRegex(ValueError,'experience_chain_invalid'):
                    store.status_snapshot()

    def test_invalid_metrics_cannot_pass_promotion(self):
        baseline={'quality':0.5,'safety':1,'reliability':1,'latency_ms':100}
        for value in [float('nan'),float('inf'),float('-inf'),-1,True]:
            for key in baseline:
                candidate={**baseline,key:value}
                with self.subTest(key=key,value=value), self.assertRaises(ValueError):
                    evaluate(baseline,candidate)
        with self.assertRaises(ValueError): evaluate(None,baseline)
        self.assertEqual(evaluate(baseline,{**baseline,'quality':0.6})['decision'],'promote')

    def test_corrupt_chain_refuses_append_and_routing_without_changing_bytes(self):
        request={'task_id':'fixture','knight':'neo','capability':'coding','outcome':'completed',
                 'score':0.5,'training_opt_in':False,'sample':'Do not retain this sample'}
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'experience.jsonl'
            store=ExperienceStore(path)
            record=store.append(request)
            self.assertNotIn('sample',record)
            self.assertTrue(store.verify())
            record['score']=0.9
            for damaged in [json.dumps(record)+'\n','{bad JSON\n','null\n']:
                path.write_text(damaged,encoding='utf-8')
                before=path.read_bytes()
                self.assertFalse(store.verify())
                with self.assertRaisesRegex(ValueError,'experience_chain_invalid'): store.append(request)
                with self.assertRaisesRegex(ValueError,'experience_chain_invalid'): store.routing_scores()
                self.assertEqual(path.read_bytes(),before)
