"""Gemma selects exact local evidence; unverifiable generated prose is not returned."""
import json
from pathlib import Path
from ..knowledge.indexer import LocalOllama
from ..tools.oracle_tools import OracleTools
ROOT=Path(__file__).resolve().parents[4]

class OracleAgent:
    def __init__(self,indexer,*,owner_fingerprint,model='gemma4:12b',endpoint='http://127.0.0.1:11434',selector=None):
        if not owner_fingerprint:raise ValueError('Authenticated owner context required')
        self.owner=owner_fingerprint;self.model=model
        self.tools=OracleTools(indexer);self.client=LocalOllama(endpoint);self.selector=selector or self._select
    @property
    def system_prompt(self):
        return (ROOT/'prompts/covenant.md').read_text().replace('[Name]','The Oracle').replace('[owner fingerprint]',self.owner)+'\n'+(Path(__file__).resolve().parents[1]/'prompts/oracle.md').read_text()
    def _select(self,question,evidence):
        result=self.client.post('/api/chat',{'model':self.model,'stream':False,'format':'json','options':{'num_ctx':8192,'num_predict':1024,'temperature':0},'messages':[{'role':'system','content':self.system_prompt},{'role':'user','content':json.dumps({'question':question,'evidence':evidence})}]})
        return json.loads(result['message']['content'])
    def run(self,question):
        try:return self.tools.document_qa(question,self.selector)
        except Exception as exc:return {'status':'failed','error_type':type(exc).__name__,'answer':None,'citations':[]}
