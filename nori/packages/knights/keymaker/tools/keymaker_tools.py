"""Read-only research and confined Markdown report writing."""
from pathlib import Path
from datetime import datetime,timezone
from uuid import uuid4
from copy import deepcopy
import sys
import time
ROOT=Path(__file__).resolve().parents[4]
if str(ROOT/'shared') not in sys.path:sys.path.insert(0,str(ROOT/'shared'))
from orchestration.apoc_worker import ApocWorker
from permissions.nori_policy import Policy
from ..research.report_template import render


class ResearchAdapterHealth:
    """Cached DDGS readiness with a bounded, injectable recovery probe."""

    def __init__(self, probe, *, recheck_seconds=1800, clock=time.monotonic):
        if not callable(probe) or not callable(clock):
            raise ValueError('Research health probe and clock are required')
        if type(recheck_seconds) not in {int, float} or recheck_seconds <= 0:
            raise ValueError('Research recheck interval must be positive')
        self.probe = probe
        self.recheck_seconds = float(recheck_seconds)
        self.clock = clock
        self._checked_at = None
        self._status = {'status': 'unknown', 'reason': 'not_checked'}

    def check(self, *, force=False):
        now = self.clock()
        if (not force and self._checked_at is not None
                and now - self._checked_at < self.recheck_seconds):
            return deepcopy(self._status)
        try:
            available = bool(self.probe('NORI research adapter health check'))
            status = {'status': 'available', 'reason': None} if available else {
                'status': 'degraded', 'reason': 'zero_results'}
        except Exception as exc:
            status = {'status': 'degraded', 'reason': 'probe_' + type(exc).__name__}
        self._checked_at = now
        self._status = {**status, 'checked_monotonic': now,
                        'recheck_seconds': self.recheck_seconds}
        return deepcopy(self._status)


class KeymakerTools:
    def __init__(self,oracle_tools,output_dir,*,online=False,web_provider=None,
                 health_probe=None,recheck_seconds=1800,clock=time.monotonic):
        self.oracle=oracle_tools;self.output=Path(output_dir).resolve();self.online=online
        self.provider=web_provider or self._web
        self.reader=ApocWorker(Policy(['browser_read']),self.output/'research-audit.jsonl')
        probe = health_probe or (self._provider_probe if web_provider is not None else self._ddgs_probe)
        self.health = ResearchAdapterHealth(probe,recheck_seconds=recheck_seconds,clock=clock)
        if self.online:self.health.check(force=True)
    @staticmethod
    def _ddgs_probe(query):
        from ddgs import DDGS
        return list(DDGS(timeout=10).text(query,max_results=1))
    def _provider_probe(self,query):
        return self.provider(query)
    def _web(self,query):
        from ddgs import DDGS
        rows=DDGS(timeout=15).text(query,max_results=3)
        results=[]
        for row in rows:
            url=row['href']
            page=self.reader.run({'operation':'inspect','url':url})
            if page['status']=='completed':results.append({'source':url,'text':page['result']['text'][:6000]})
        return results
    def web_research(self,query):
        if not self.online:return []
        if self.health.check()['status']!='available':return []
        return self.provider(query)
    def research_status(self):
        if not self.online:return {'status':'offline','reason':'online_mode_disabled'}
        return self.health.check()
    def collect(self,queries):
        sources=[];errors=[];seen=set()
        web_status=self.research_status()
        if self.online and web_status['status']!='available':
            errors.append('Web retrieval degraded: '+str(web_status['reason'])+'; using local Oracle corpus.')
        for query in queries:
            groups=[]
            try:groups.extend(self.oracle.vector_search(query,limit=3))
            except Exception as exc:errors.append('Local retrieval failed: '+type(exc).__name__)
            if self.online and web_status['status']=='available':
                try:groups.extend(self.web_research(query))
                except Exception as exc:errors.append('Web retrieval failed: '+type(exc).__name__)
            for item in groups:
                source=item.get('source');text=item.get('text')
                if not isinstance(source,str) or not isinstance(text,str) or not text.strip():continue
                key=(source,item.get('id',text))
                if key in seen:continue
                seen.add(key);sources.append({'id':'S'+str(len(sources)+1),'source':source,'text':text[:3000],'retrieved_at':datetime.now(timezone.utc).isoformat()})
                if len(sources)>=12:return sources,errors
        return sources,errors
    @staticmethod
    def citation(candidate,sources):
        if not isinstance(candidate,dict):raise ValueError('Invalid citation')
        source=next((s for s in sources if s['id']==candidate.get('id')),None)
        quote=candidate.get('quote')
        if not source or not isinstance(quote,str) or not quote.strip() or quote not in source['text']:raise ValueError('Unverifiable citation')
        return {'id':source['id'],'quote':quote}
    def report_gen(self,report):return render(report)
    def file_write(self,report):
        self.output.mkdir(parents=True,exist_ok=True)
        path=self.output/('research-'+uuid4().hex+'.md')
        # Caller/model never controls the file path or extension.
        path.write_text(self.report_gen(report),encoding='utf-8');return str(path)
