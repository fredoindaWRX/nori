"""Bounded multi-source research with exact evidence validation."""
import json
from pathlib import Path
from ..tools.keymaker_tools import KeymakerTools,ROOT
from ..research.planner import ResearchPlanner
from packages.knights.oracle.knowledge.indexer import LocalOllama

class KeymakerAgent:
    def __init__(self,oracle_tools,output_dir,*,owner_fingerprint,online=False,model=None,planner=None,synthesizer=None,web_provider=None,health_probe=None,recheck_seconds=1800,clock=None):
        if not owner_fingerprint:raise ValueError('Authenticated owner context required')
        self.owner=owner_fingerprint;self.online=online
        self.model=model or json.loads((ROOT/'config.yaml').read_text())['knights']['keymaker']['model']
        self.client=LocalOllama()
        tool_options={'online':online,'web_provider':web_provider,'health_probe':health_probe,
                      'recheck_seconds':recheck_seconds}
        if clock is not None:tool_options['clock']=clock
        self.tools=KeymakerTools(oracle_tools,output_dir,**tool_options)
        self.planner=planner or ResearchPlanner(self._plan)
        self.synthesize=synthesizer or self._synthesize
    @property
    def system_prompt(self):
        return (ROOT/'prompts/covenant.md').read_text().replace('[Name]','The Keymaker').replace('[owner fingerprint]',self.owner)+'\n'+(Path(__file__).resolve().parents[1]/'prompts/keymaker.md').read_text()
    def _model(self,payload):
        result=self.client.post('/api/chat',{'model':self.model,'stream':False,'think':False,'format':'json','options':{'num_ctx':8192,'num_predict':1600},'messages':[{'role':'system','content':self.system_prompt},{'role':'user','content':json.dumps(payload)}]})
        return json.loads(result['message']['content'])
    def _plan(self,question):return self._model({'task':'Return queries: an array of 1 to 6 complementary research queries','question':question})['queries']
    def _synthesize(self,question,sources):
        return self._model({'task':'Return findings: [{claim, evidence:[{id,quote}]}] and limitations: [strings]. Quotes must be exact. Claims must be supported. At most 8 findings. Identify conflicts as findings.','question':question,'sources':sources})
    def run(self,question,*,save=True):
        queries=self.planner.plan(question);sources,errors=self.tools.collect(queries)
        # Bound model input and make omissions explicit.
        budget=14000;selected=[]
        for source in sources:
            if len(source['text'])<=budget:selected.append(source);budget-=len(source['text'])
        limitations=list(errors)
        if len(selected)<len(sources):limitations.append('Some retrieved evidence omitted to fit the model context.')
        findings=[]
        if selected:
            synthesis=self.synthesize(question,selected)
            raw=synthesis.get('findings',[])
            if not isinstance(raw,list) or len(raw)>8:raise ValueError('Invalid findings')
            for finding in raw:
                try:
                    if not isinstance(finding.get('claim'),str) or not finding['claim'].strip():raise ValueError('Missing claim')
                    evidence=finding.get('evidence')
                    if not isinstance(evidence,list) or not 1<=len(evidence)<=5:raise ValueError('Evidence required')
                    findings.append({'claim':finding['claim'],'evidence':[self.tools.citation(c,selected) for c in evidence]})
                except (ValueError,AttributeError):limitations.append('An unsupported finding was discarded.')
            extra=synthesis.get('limitations',[])
            if isinstance(extra,list):limitations.extend(x for x in extra if isinstance(x,str))
        else:limitations.append('No evidence retrieved from the available sources.')
        limitations.append('Citations verify source excerpts; synthesis still requires review for relevance and accuracy.')
        report={'question':question,'queries':queries,'mode':'online' if self.online else 'offline',
                'research_adapter':self.tools.research_status(),
                'findings':findings,'sources':selected,'limitations':limitations}
        result={'status':'completed' if findings and not errors else 'partial' if findings else 'insufficient_evidence','report':report}
        if save:result['path']=self.tools.file_write(report)
        return result
