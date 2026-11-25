"""Real local inference and reviewed research cycle; controlled worker evidence."""
import asyncio
import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import tempfile

suite = Path('C:/Program Files/Nori/resources/NoriSuite')
sys.path[:0] = [str(suite/'nori'), str(suite/'nori/shared'), str(suite/'runtime/norllama')]
# Overlay only the reviewed source adapter under test, not an alternate runtime.
spec = importlib.util.spec_from_file_location('reviewed_research', 'C:/Nori/runtime/norllama/reviewed_research.py')
module = importlib.util.module_from_spec(spec)
sys.modules['reviewed_research'] = module
spec.loader.exec_module(module)
from native_inference import configure_native_inference
from research_cycle import ResearchCycle
from security.hard_floor import load_hard_floor
from permissions.nori_policy import Policy
from orchestration.apoc_worker import ApocWorker

spec = importlib.util.spec_from_file_location('fixture_keymaker', 'C:/Nori/nori/shared/orchestration/keymaker_worker.py')
keymaker_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(keymaker_module)
load_hard_floor()
client = configure_native_inference({'knights': {'planner': {}, 'reviewer': {}},
    'native_inference': {'model_id':'nori-auto', 'assignments':{'planner':'nori-auto','reviewer':'nori-auto'}}},
    {'NORI_INFERENCE_RUNTIME':'gpt-oss','NORI_GPT_OSS_SERVER_MODEL':'nori-auto','NORI_RUNTIME_MODEL_ID':'nori-auto',
     'NORI_GPT_OSS_CONTEXT_TOKENS':'65536','NORI_GPT_OSS_URL':sys.argv[1]})
url = 'https://docs.python.org/3/'
page = {'url':url, 'content_type':'text/html',
        'text':'Controlled acceptance fixture: the Python tutorial introduces basic concepts. The library reference describes standard modules.'}
phases, calls = [], []
live_page = '--live-page' in sys.argv[2:]

async def run():
    with tempfile.TemporaryDirectory(prefix='nori-research-planner-') as directory:
        def reject_local_search(*args):
            raise AssertionError('Web-only report attempted a local corpus search')
        builder = keymaker_module.KeymakerWorker(SimpleNamespace(store=SimpleNamespace(search=reject_local_search)),
            Policy(['research_report']), Path(directory)/'audit.jsonl')
        reader = ApocWorker(Policy(['browser_read']), Path(directory)/'page-audit.jsonl')
        fetched = {}
        class ControlledGateway:
            async def request(self, recipient, operation, body, credential):
                assert recipient == 'architect' and operation == 'task'
                node = body['nodes'][0]; request = node['request']; calls.append(request['operation'])
                if request['operation'] == 'search':
                    output = {'status':'completed','result':{'query':request['query'],'urls':[url]}}
                elif request['operation'] == 'inspect':
                    assert request['url'] == url
                    output = await asyncio.to_thread(reader.run, request) if live_page else {'status':'completed','result':page}
                    assert output['status'] == 'completed'
                    fetched[url] = output['result']
                elif request['operation'] == 'report':
                    assert request['source_scope'] == 'public_web'
                    output = builder.run_with_web({k:v for k,v in request.items() if k != 'urls'}, [fetched[url]])
                else:
                    raise AssertionError('Unexpected worker action')
                return {'status':'completed','results':{node['id']:{'status':'completed','output':output}}}
        cycle = ResearchCycle(client, ControlledGateway(), 'synthetic-test-credential',
            on_event=lambda phase, details: phases.append({'phase':phase, **details}))
        question = 'Using the official Python documentation page, where should a beginner start?' if live_page else 'Using this controlled documentation fixture, where should a beginner start?'
        result = await cycle.run(question,
            seed_urls=[url], retain=False, max_pages=1)
        assert result['status'] == 'completed'
        assert calls == ['search','inspect','report']
        assert result['memory_entry_id'] is None
        assert result['citations'] and all(c['source'] == url for c in result['citations'])
        return {'passed':True,'calls':calls,'phases':phases,'response':result['response'],
                'contextTokens':client.context_tokens,'retentionRequested':False,
                'actualPageRead':live_page,'searchDiscoveryControlled':True,
                'pageCharacters':len(fetched[url]['text'])}

try:
    print(json.dumps(asyncio.run(run())))
except Exception as error:
    print(json.dumps({'passed':False,'errorType':type(error).__name__,'error':str(error)[:500],
                      'phases':phases,'calls':calls}))
    raise SystemExit(1)
