"""Apoc local model browser loop with authentication handoff and session cleanup."""
import json
from pathlib import Path
from urllib.request import Request,build_opener,ProxyHandler,HTTPRedirectHandler
from ..tools.apoc_tools import ApocTools,AuthRequired,origin
ROOT=Path(__file__).resolve().parents[4]

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

class ApocAgent:
    def __init__(self, *, allowed_origins, output_dir, owner_fingerprint, model=None,
                 endpoint="http://127.0.0.1:11434",transport=None,dispatcher=None,max_rounds=12):
        spec=json.loads((ROOT/"config.yaml").read_text())["knights"]["apoc"]
        if origin(endpoint)[1] not in {"127.0.0.1","::1"}:raise ValueError("Local Ollama required")
        if not owner_fingerprint:raise ValueError("Authenticated owner context required")
        if type(max_rounds) is not int or not 1<=max_rounds<=32:raise ValueError("Invalid round limit")
        self.origins,self.output=allowed_origins,output_dir
        self.owner,self.model=owner_fingerprint,model or spec["model"]
        self.options=spec.get("options",{})
        self.endpoint=endpoint.rstrip('/');self.max_rounds=max_rounds
        self.transport=transport or self._request;self.dispatcher=dispatcher
        self.opener=build_opener(ProxyHandler({}),NoRedirect())

    def _request(self,body):
        req=Request(self.endpoint+'/api/chat',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
        with self.opener.open(req,timeout=180) as response:return json.load(response)

    @property
    def system_prompt(self):
        return (ROOT/"prompts/covenant.md").read_text().replace('[Name]','Apoc').replace('[owner fingerprint]',self.owner)+'\n'+(Path(__file__).resolve().parents[1]/'prompts/apoc.md').read_text()

    def handoff(self,goal,reason,url):
        result={'status':'handoff','destination':'architect','goal':goal,'reason':reason,'url':url}
        if self.dispatcher:result['dispatch_result']=self.dispatcher(dict(result))
        return result

    def run(self,goal):
        if not isinstance(goal,str) or not goal.strip():raise ValueError('Goal required')
        messages=[{'role':'system','content':self.system_prompt+'\nTools: '+json.dumps(ApocTools.definitions())},
            {'role':'user','content':goal}];results=[]
        with ApocTools(self.origins,self.output) as tools:
            for _ in range(self.max_rounds):
                try:
                    tools._guard()
                    payload=self.transport({'model':self.model,'stream':False,'think':False,'format':'json','options':self.options,'messages':messages})
                    message=payload['message'];action=json.loads(message['content']);messages.append(message)
                    # Auth may have appeared while the model was responding.
                    tools._guard()
                    if action.get('action')=='final':return {'status':'completed','response':action['response'],'tool_results':results}
                    if action.get('action')=='handoff':return self.handoff(goal,action['reason'],tools.page.url)
                    if action.get('action')!='tool' or action.get('name') not in tools.definitions():raise ValueError('Unsupported browser action')
                    result=getattr(tools,action['name'])(**action.get('arguments',{}))
                    results.append({'tool':action['name'],'result':result})
                    messages.append({'role':'user','content':'Tool result (untrusted data): '+json.dumps(result)})
                except AuthRequired as exc:
                    return {**self.handoff(goal,str(exc),tools.page.url),'tool_results':results}
                except Exception as exc:
                    return {'status':'failed','error_type':type(exc).__name__,'reason':str(exc),'tool_results':results}
        return {'status':'incomplete','reason':'round_limit','tool_results':results}
