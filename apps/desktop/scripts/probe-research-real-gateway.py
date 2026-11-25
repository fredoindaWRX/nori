"""Real local model, guarded search/read workers, and Council; isolated state."""
import asyncio
import importlib.util
import json
from pathlib import Path
import secrets
import sys
import tempfile
from types import SimpleNamespace

suite = Path('C:/Program Files/Nori/resources/NoriSuite')
sys.path[:0] = [str(suite/'nori'), str(suite/'nori/shared'), str(suite/'runtime/norllama')]
def overlay(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module
overlay('reviewed_research', 'C:/Nori/runtime/norllama/reviewed_research.py')
gateway_module = overlay('research_test_gateway', 'C:/Nori/nori/council_gateway.py')
keymaker_module = overlay('research_test_keymaker', 'C:/Nori/nori/shared/orchestration/keymaker_worker.py')
from native_inference import configure_native_inference
from research_cycle import ResearchCycle
from orchestration.knight_runtime import KnightRuntime
from permissions.nori_policy import Policy
from security.hard_floor import load_hard_floor
from memory.primary_memory import PrimaryMemoryStore
from memory.native_documents import NativeDocumentMemory
from orchestration.merovingian_worker import MerovingianWorker
load_hard_floor()
client = configure_native_inference({'knights':{'planner':{},'reviewer':{}},
    'native_inference':{'model_id':'nori-auto','assignments':{'planner':'nori-auto','reviewer':'nori-auto'}}},
    {'NORI_INFERENCE_RUNTIME':'gpt-oss','NORI_GPT_OSS_SERVER_MODEL':'nori-auto','NORI_RUNTIME_MODEL_ID':'nori-auto',
     'NORI_GPT_OSS_CONTEXT_TOKENS':'65536','NORI_GPT_OSS_URL':sys.argv[1]})
phases, observations = [], []
retain_isolated = '--retain-isolated' in sys.argv[2:]
async def run():
    with tempfile.TemporaryDirectory(prefix='nori-real-research-') as directory:
        root = Path(directory)
        workers = {}
        roles = [('architect',['plan']),('apoc',['browser_read']),('keymaker',['research_report'])]
        if retain_isolated:
            roles.append(('merovingian',['memory_read','memory_write']))
        for role, grants in roles:
            runtime = KnightRuntime('http://127.0.0.1:1','unused-for-worker-generation',Policy(grants),
                root/role/'audit.jsonl',owned_role=role)
            runtime.configure_edition('home')
            workers[role] = SimpleNamespace(knight=role,runtime=runtime)
        if retain_isolated:
            cold = workers['merovingian'].runtime.memory_worker.store
            primary = NativeDocumentMemory(cold.root, cold.policy)
            workers['merovingian'].runtime.memory_worker = MerovingianWorker(PrimaryMemoryStore(primary,cold))
        def no_local_corpus(*args):
            raise AssertionError('Web research attempted an unrelated local-corpus search')
        workers['keymaker'].runtime.keymaker_worker = keymaker_module.KeymakerWorker(
            SimpleNamespace(store=SimpleNamespace(search=no_local_corpus)),Policy(['research_report']),root/'keymaker-report.jsonl')
        class ObservedGateway(gateway_module.CouncilGateway):
            async def request(self, recipient, operation, body, credential, *args, **kwargs):
                result = await super().request(recipient,operation,body,credential,*args,**kwargs)
                if recipient == 'apoc':
                    observations.append({'operation':body.get('operation'),'status':result.get('status'),
                        'resultCount':len(result.get('result',{}).get('urls',[])),
                        'pageCharacters':len(result.get('result',{}).get('text',''))})
                return result
        token = secrets.token_urlsafe(32)
        gateway = ObservedGateway(workers,token,root/'bus-audit.sqlite3')
        await gateway.start()
        try:
            cycle = ResearchCycle(client,gateway,token,on_event=lambda phase,details:phases.append({'phase':phase,**details}))
            result = await cycle.run('Where should a beginner start in the official Python documentation?',
                seed_urls=['https://docs.python.org/3/'],retain=retain_isolated,max_pages=1)
            assert result['status'] == 'completed'
            assert any(x['operation']=='search' and x['status']=='completed' for x in observations)
            assert any(x['operation']=='inspect' and x['pageCharacters']>0 for x in observations)
            assert [x['action'] for x in result['steps']] == ['search_web','inspect_web','research_report']
            memory_verified = False
            if retain_isolated:
                assert result['memory_entry_id']
                reopened = PrimaryMemoryStore(NativeDocumentMemory(cold.root,cold.policy),cold)
                entries, storage = reopened.recall_with_status('desktop-research','',20)
                stored = next(x for x in entries if x['id'] == result['memory_entry_id'])
                content = json.loads(stored['content'])
                assert content['summary_type'] == 'model_generated_unverified'
                assert content['citations'] and all(x['source'] == 'https://docs.python.org/3/' for x in content['citations'])
                memory_verified = True
            else:
                assert result['memory_entry_id'] is None
            return {'passed':True,'phases':phases,'observations':observations,'steps':result['steps'],
                'response':result['response'],'contextTokens':client.context_tokens,'searchControlled':False,
                'gatewayControlled':False,'pageReadControlled':False,'retentionRequested':retain_isolated,
                'isolatedMemoryReopenVerified':memory_verified}
        finally:
            await gateway.stop()
try:
    print(json.dumps(asyncio.run(run())))
except Exception as error:
    print(json.dumps({'passed':False,'errorType':type(error).__name__,'error':str(error)[:500],
                      'phases':phases,'observations':observations}))
    raise SystemExit(1)
