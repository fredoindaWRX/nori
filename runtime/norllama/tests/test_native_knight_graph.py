"""Actual roster and graph policy; controlled dispatcher, not12live workers."""
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
import os
import json
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[3]
sys.path.insert(0,str(ROOT/'nori/shared'))
sys.path.insert(0,str(ROOT/'nori'))
from orchestration.knight_registry import KnightRegistry, EXPECTED_KNIGHTS
from orchestration.architect_worker import ArchitectWorker


class GraphTests(unittest.TestCase):
    def test_native_code_readers_refuse_growth_and_denied_content_access(self):
        from orchestration.neo_worker import NeoWorker
        from orchestration.morpheus_worker import MorpheusWorker
        from permissions.nori_policy import Policy
        with tempfile.TemporaryDirectory(prefix='.native-reader-bounds-',dir=ROOT/'verification') as directory:
            workspace = Path(directory)
            document = workspace/'fixture.py'
            document.write_bytes(b'x' * (512 * 1024 + 1))
            audit = workspace/'audit.jsonl'
            workers = [(NeoWorker(workspace,Policy(['workspace_read']),audit),{'operation':'read','path':'fixture.py'}),
                       (MorpheusWorker(workspace,Policy(['ide_read']),audit),{'operation':'symbols','path':'fixture.py'})]
            original_stat = Path.stat
            def small_stat(path,*args,**kwargs):
                result = original_stat(path,*args,**kwargs)
                if path == document:
                    class SmallStat:
                        st_size = 1
                        def __getattr__(self,name): return getattr(result,name)
                    return SmallStat()
                return result
            with patch.object(Path,'stat',small_stat):
                for worker,request in workers:
                    with self.subTest(worker=type(worker).__name__):
                        with self.assertRaisesRegex(ValueError,'grew beyond'):
                            worker.run(request)
            original_open = Path.open
            def guarded_open(path,*args,**kwargs):
                if path == document: raise AssertionError('Denied code read')
                return original_open(path,*args,**kwargs)
            with patch.object(Path,'open',guarded_open):
                for worker,request in workers:
                    worker.policy = Policy([])
                    self.assertEqual(worker.run(request)['status'],'denied')

    def test_real_neo_read_then_morpheus_navigation_uses_same_fixture_workspace(self):
        from orchestration.knight_runtime import KnightRuntime
        from permissions.nori_policy import Policy
        with tempfile.TemporaryDirectory(prefix='.native-code-graph-',dir=ROOT/'verification') as directory:
            workspace = Path(directory)/'workspace'
            workspace.mkdir()
            source = 'def synthetic_function():\n    return 7\n'
            (workspace/'fixture.py').write_text(source,encoding='utf-8')
            runtime = KnightRuntime('http://127.0.0.1:1','fixture-no-inference',
                Policy(['plan','workspace_read','ide_read']),Path(directory)/'audit.jsonl',workspace_root=workspace)
            runtime.configure_edition('home')
            result = runtime.run_architect({'operation':'run_graph','nodes':[
                {'id':'read','capability':'coding','request':{'operation':'read','path':'fixture.py'},'depends_on':[]},
                {'id':'symbols','capability':'ide','request':{'operation':'symbols','path':'fixture.py'},'depends_on':['read']}]})
            self.assertEqual(result['status'],'completed')
            self.assertEqual(result['results']['read']['knight'],'neo')
            self.assertEqual(result['results']['read']['output']['content'],source)
            self.assertEqual(result['results']['symbols']['knight'],'morpheus')
            self.assertEqual(result['results']['symbols']['output']['symbols'],[{'name':'synthetic_function','line':1}])
            self.assertEqual((workspace/'fixture.py').read_text(encoding='utf-8'),source)

    def test_real_denied_dispatch_blocks_dependency_and_audits_denial(self):
        from orchestration.knight_runtime import KnightRuntime
        from permissions.nori_policy import Policy
        with tempfile.TemporaryDirectory(prefix='.native-graph-denial-',dir=ROOT/'verification') as directory:
            knowledge = Path(directory)/'knowledge'
            knowledge.mkdir()
            (knowledge/'fixture.txt').write_text('Synthetic denied-index fixture',encoding='utf-8')
            audit = Path(directory)/'audit.jsonl'
            runtime = KnightRuntime('http://127.0.0.1:1','fixture-no-inference',Policy(['plan']),audit,knowledge_root=knowledge)
            runtime.configure_edition('home')
            result = runtime.run_architect({'operation':'run_graph','nodes':[
                {'id':'index','capability':'knowledge','request':{'operation':'index','path':'fixture.txt'},'depends_on':[]},
                {'id':'report','capability':'research','request':{'operation':'report','question':'fixture'},'depends_on':['index']}]})
            self.assertEqual(result['status'],'incomplete')
            self.assertEqual(result['results']['index']['status'],'denied')
            self.assertEqual(result['results']['report']['status'],'blocked')
            events = [json.loads(line) for line in audit.read_text(encoding='utf-8').splitlines()]
            dispatches = [event for event in events if event['action']=='knight_dispatch']
            self.assertEqual([event['outcome'] for event in dispatches],['started','denied'])
            self.assertFalse((knowledge/'knowledge-index.sqlite3').exists())

    def test_oracle_index_survives_restart_and_denied_index_never_reads_content(self):
        from orchestration.oracle_worker import OracleWorker
        from permissions.nori_policy import Policy
        with tempfile.TemporaryDirectory(prefix='.oracle-persistence-',dir=ROOT/'verification') as directory:
            corpus = Path(directory)/'knowledge'
            corpus.mkdir()
            (corpus/'fixture.txt').write_text('Synthetic purple habitat evidence',encoding='utf-8')
            audit = Path(directory)/'audit.jsonl'
            denied = OracleWorker(corpus,Policy([]),audit)
            original_open = Path.open
            def guarded_open(path,*args,**kwargs):
                if path == corpus/'fixture.txt': raise AssertionError('Denied content read')
                return original_open(path,*args,**kwargs)
            with patch.object(Path,'open',guarded_open):
                self.assertEqual(denied.run({'operation':'index','path':'fixture.txt'})['status'],'denied')
            self.assertFalse((corpus/'knowledge-index.sqlite3').exists())
            writer = OracleWorker(corpus,Policy(['knowledge_index']),audit)
            self.assertEqual(writer.run({'operation':'index','path':'fixture.txt'})['status'],'indexed')
            with self.assertRaises(PermissionError): writer.run({'operation':'manifest'})
            restarted = OracleWorker(corpus,Policy(['knowledge_read']),audit)
            manifest = restarted.run({'operation':'manifest'})
            self.assertEqual(manifest['manifest']['documents'][0]['path'],'fixture.txt')
            matches = restarted.run({'operation':'search','query':'purple habitat'})
            self.assertEqual(matches['status'],'completed')
            self.assertEqual(matches['results'][0]['source'],'fixture.txt')
            self.assertIn('Synthetic purple habitat evidence',matches['results'][0]['excerpt'])

    def test_oracle_rechecks_actual_read_size_after_small_stat(self):
        from orchestration.oracle_worker import OracleWorker
        from permissions.nori_policy import Policy
        with tempfile.TemporaryDirectory(prefix='.oracle-growth-',dir=ROOT/'verification') as directory:
            corpus = Path(directory)
            document = corpus/'fixture.txt'
            document.write_bytes(b'x' * (512 * 1024 + 1))
            worker = OracleWorker(corpus,Policy(['knowledge_index']),corpus/'audit.jsonl')
            original_stat = Path.stat
            def small_stat(path,*args,**kwargs):
                result = original_stat(path,*args,**kwargs)
                if path == document:
                    values = list(result)
                    values[6] = 1
                    return os.stat_result(values)
                return result
            with patch.object(Path,'stat',small_stat):
                with self.assertRaisesRegex(ValueError,'grew beyond'):
                    worker.run({'operation':'index','path':'fixture.txt'})
            self.assertFalse((corpus/'knowledge-index.sqlite3').exists())

    def test_oracle_report_cannot_claim_completion_when_knowledge_read_denied(self):
        from orchestration.oracle_worker import OracleWorker
        from permissions.nori_policy import Policy
        with tempfile.TemporaryDirectory(prefix='.oracle-denial-',dir=ROOT/'verification') as directory:
            worker = OracleWorker(Path(directory)/'knowledge',Policy(['research_report']),Path(directory)/'audit.jsonl')
            result = worker.run({'operation':'report','question':'synthetic fixture'})
            self.assertEqual(result['status'],'denied')
            self.assertEqual(result['reason'],'knowledge_read_not_granted')
            self.assertNotIn('report',result)

    def test_real_graph_indexes_with_oracle_then_reports_with_keymaker(self):
        from orchestration.knight_runtime import KnightRuntime
        from permissions.nori_policy import Policy
        with tempfile.TemporaryDirectory(prefix='.native-research-graph-',dir=ROOT/'verification') as directory:
            knowledge = Path(directory)/'knowledge'
            knowledge.mkdir()
            (knowledge/'fixture.txt').write_text('Purple habitat has three synthetic research towers.',encoding='utf-8')
            runtime = KnightRuntime('http://127.0.0.1:1','fixture-no-inference',
                Policy(['plan','knowledge_index','knowledge_read','research_report']),
                Path(directory)/'audit.jsonl',knowledge_root=knowledge)
            runtime.configure_edition('home')
            result = runtime.run_architect({'operation':'run_graph','nodes':[
                {'id':'index','capability':'knowledge','request':{'operation':'index','path':'fixture.txt'},'depends_on':[]},
                {'id':'report','capability':'research','request':{'operation':'report','question':'habitat towers'},'depends_on':['index']}]})
            self.assertEqual(result['status'],'completed')
            self.assertEqual(result['results']['index']['knight'],'oracle')
            self.assertEqual(result['results']['report']['knight'],'keymaker')
            report = result['results']['report']['output']['report']
            self.assertEqual(report['finding_count'],1)
            self.assertEqual(report['citations'][0]['source'],'fixture.txt')
            self.assertIn('three synthetic research towers',report['citations'][0]['excerpt'])

    def test_real_native_dispatch_graph_reaches_persistent_memory_worker(self):
        from orchestration.knight_runtime import KnightRuntime
        from orchestration.merovingian_worker import MerovingianWorker
        from permissions.nori_policy import Policy
        from memory.native_documents import NativeDocumentMemory
        from memory.primary_memory import PrimaryMemoryStore
        with tempfile.TemporaryDirectory(prefix='.native-graph-live-',dir=ROOT/'verification') as directory:
            runtime = KnightRuntime('http://127.0.0.1:1','fixture-no-inference',
                Policy(['plan','memory_read','memory_write','memory_export']),Path(directory)/'audit.jsonl')
            runtime.configure_edition('home')
            cold = runtime.memory_worker.store
            runtime.memory_worker = MerovingianWorker(PrimaryMemoryStore(NativeDocumentMemory(cold.root,cold.policy),cold))
            result = runtime.run_architect({'operation':'run_graph','nodes':[
                {'id':'save','capability':'memory','request':{'operation':'remember','scope':'fixture','content':'Synthetic native graph entry'},'depends_on':[]},
                {'id':'read','capability':'memory','request':{'operation':'recall','scope':'fixture'},'depends_on':['save']}]})
            self.assertEqual(result['status'],'completed')
            self.assertEqual(result['order'],['save','read'])
            self.assertEqual(result['results']['save']['knight'],'merovingian')
            self.assertEqual(result['results']['read']['knight'],'merovingian')
            output = result['results']['read']['output']
            self.assertEqual(output['storage']['backend'],'nori-sqlite')
            self.assertEqual(output['entries'][0]['content'],'Synthetic native graph entry')
            self.assertTrue((cold.root/'native-documents.sqlite3').is_file())

    def execute(self,dispatch):
        policy=SimpleNamespace(decide=lambda permission:SimpleNamespace(allowed=True,reason='test-only'))
        request={'operation':'run_graph','nodes':[
            {'id':'first','capability':'coding','request':{'id':'first'},'depends_on':[]},
            {'id':'dependent','capability':'knowledge','request':{'id':'dependent'},'depends_on':['first']},
            {'id':'independent','capability':'events','request':{'id':'independent'},'depends_on':[]}]}
        with tempfile.TemporaryDirectory(prefix='.native-graph-probe-',dir=ROOT/'verification') as directory:
            return ArchitectWorker(policy,Path(directory)/'audit.jsonl',dispatch).run(request)

    def test_canonical_roster_contains_all_twelve_native_sources(self):
        registry=KnightRegistry(ROOT/'nori/shared/orchestration/knights.json')
        self.assertEqual(set(registry.knights),EXPECTED_KNIGHTS)
        self.assertEqual(len(registry.for_edition('home')),12)
        for role in EXPECTED_KNIGHTS:
            self.assertTrue((ROOT/'nori/packages/knights'/role).is_dir())
            self.assertTrue((ROOT/'nori/shared/orchestration'/f'{role}_worker.py').is_file())

    def test_bad_graphs_refused_before_policy_or_dispatch(self):
        for nodes in ([{'id':'a','capability':'coding','request':{},'depends_on':['missing']}],
                      [{'id':'a','capability':'coding','request':{},'depends_on':['a']}],[]):
            with self.assertRaises(ValueError):
                ArchitectWorker._validate({'operation':'run_graph','nodes':nodes})

    def test_denied_plan_dispatches_nothing_and_writes_no_audit(self):
        calls=[]
        policy=SimpleNamespace(decide=lambda permission:SimpleNamespace(allowed=False,reason='test-denial'))
        with tempfile.TemporaryDirectory(prefix='.native-graph-probe-',dir=ROOT/'verification') as directory:
            audit=Path(directory)/'audit.jsonl'
            worker=ArchitectWorker(policy,audit,lambda request:calls.append(request))
            result=worker.run({'operation':'run_graph','nodes':[
                {'id':'a','capability':'coding','request':{},'depends_on':[]}]})
            self.assertEqual(result['status'],'denied')
            self.assertEqual(calls,[])
            self.assertFalse(audit.exists())

    def test_failed_worker_blocks_dependents_but_not_independent_work(self):
        calls=[]
        def dispatch(request):
            node=request['request']['id'];calls.append(node)
            return {'knight':'test-worker','dispatch_id':node,
                    'result':{'status':'failed' if node=='first' else 'completed'}}
        result=self.execute(dispatch)
        self.assertEqual(result['status'],'incomplete')
        self.assertEqual(calls,['first','independent'])
        self.assertEqual(result['results']['dependent']['status'],'blocked')
        self.assertEqual(result['results']['independent']['status'],'completed')

    def test_worker_exception_is_failure_without_private_error_message(self):
        def dispatch(request):
            raise RuntimeError('private diagnostic must not escape')
        result=self.execute(dispatch)
        self.assertEqual(result['status'],'incomplete')
        self.assertEqual(result['results']['first']['error_type'],'RuntimeError')
        self.assertNotIn('private diagnostic',str(result))
        self.assertEqual(result['results']['dependent']['status'],'blocked')

    def test_missing_identity_and_nonfinite_worker_output_never_succeed(self):
        for output in ({'result':{'status':'completed'}},
                       {'knight':'test','dispatch_id':'id','result':{'status':'completed','value':float('nan')}}):
            result=self.execute(lambda request:output)
            self.assertEqual(result['status'],'incomplete')
            self.assertEqual(result['results']['first']['status'],'failed')
            self.assertEqual(result['results']['dependent']['status'],'blocked')


if __name__=='__main__':
    unittest.main()
