"""Memory queries for authenticated Knights and idle-only Phi-4 consolidation."""
import json
from pathlib import Path
from ..prompts.merovingian import SYSTEM_PROMPT
from ..tools.merovingian_tools import MemoryTools
from ..memory.sleep_compute import ActivityGate,SleepCompute
from packages.knights.oracle.knowledge.indexer import LocalOllama
ROOT=Path(__file__).resolve().parents[4]
KNIGHTS={'neo','trinity','morpheus','apoc','oracle','merovingian','architect','keymaker','smith','tank','machine','sentinel'}

class MerovingianAgent:
    def __init__(self,data_root,*,owner_fingerprint,authorize,activity_gate,model='phi4',summarizer=None,letta=None):
        if not callable(authorize):raise ValueError('Authorization callback required')
        self.authorize=authorize;self.gate=activity_gate;self.model=model
        self.tools=MemoryTools(Path(data_root)/'memory.sqlite3',owner_fingerprint,letta)
        self.client=LocalOllama()
        self.sleep=SleepCompute(self.gate,self.tools,summarizer or self._summarize)
    @property
    def system_prompt(self):
        return (ROOT/'prompts/covenant.md').read_text().replace('[Name]','The Merovingian').replace('[owner fingerprint]',self.tools.owner())+'\n'+SYSTEM_PROMPT
    def _summarize(self,records):
        r=self.client.post('/api/chat',{'model':self.model,'stream':False,'format':'json','options':{'num_ctx':4096,'num_predict':768},'messages':[{'role':'system','content':self.system_prompt},{'role':'user','content':json.dumps(records)}]})
        return json.loads(r['message']['content'])['summary']
    def run(self,operation,*,actor,session,**args):
        if actor not in KNIGHTS or self.authorize(session,actor,operation) is not True:return {'status':'denied'}
        if operation=='memory_compress':return self.sleep.run()
        with self.gate.active(actor):
            if operation=='memory_read':return self.tools.memory_read(**args)
            if operation=='memory_write':return self.tools.memory_write(actor=actor,**args)
            if operation=='memory_search':return self.tools.memory_search(**args)
            if operation=='sync_letta':return self.tools.sync_letta()
            raise ValueError('Unsupported memory operation')
