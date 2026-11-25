"""Local Ollama IDE specialist with explicit context and bounded tool iterations."""
import json
from pathlib import Path
from urllib.request import Request,build_opener,ProxyHandler,HTTPRedirectHandler
from urllib.parse import urlsplit
from ..tools.morpheus_tools import MorpheusTools
ROOT=Path(__file__).resolve().parents[4]

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs): return None

class MorpheusAgent:
    def __init__(self,workspace_root,context_provider,*,owner_fingerprint,model=None,
                 endpoint="http://127.0.0.1:11434",allow_writes=False,apply_edit=None,
                 dispatcher=None,transport=None,max_rounds=8):
        spec=json.loads((ROOT/"config.yaml").read_text())["knights"]["morpheus"]
        self.model=model or spec["model"]
        if not owner_fingerprint: raise ValueError("Authenticated owner context required")
        u=urlsplit(endpoint)
        if u.scheme!="http" or u.hostname not in {"127.0.0.1","::1"} or u.username or u.password or u.path not in ('','/') or u.query or u.fragment:
            raise ValueError("Local Ollama endpoint required")
        if type(max_rounds) is not int or not 1<=max_rounds<=32: raise ValueError("Invalid round limit")
        self.endpoint=endpoint.rstrip('/')
        self.owner=owner_fingerprint; self.max_rounds=max_rounds
        self.options=spec.get("options",{})
        self.tools=MorpheusTools(workspace_root,context_provider,allow_writes=allow_writes,apply_edit=apply_edit)
        self.dispatcher=dispatcher
        self.transport=transport or self._request
        self.opener=build_opener(ProxyHandler({}),NoRedirect())

    @property
    def system_prompt(self):
        return (ROOT/"prompts/covenant.md").read_text().replace('[Name]','Morpheus').replace('[owner fingerprint]',self.owner)+'\n'+(Path(__file__).resolve().parents[1]/'prompts/morpheus.md').read_text()

    def _request(self,body):
        req=Request(self.endpoint+'/api/chat',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
        with self.opener.open(req,timeout=180) as response:return json.load(response)

    def handoff(self,goal,reason):
        result={'status':'handoff','destination':'neo','goal':goal,'reason':reason}
        if self.dispatcher: result['dispatch_result']=self.dispatcher(dict(result))
        return result

    def run(self,goal,*,large_refactor=False):
        if not isinstance(goal,str) or not goal.strip():raise ValueError('Goal required')
        if large_refactor:return self.handoff(goal,'Large refactor belongs to Neo')
        messages=[{'role':'system','content':self.system_prompt+'\nTools: '+json.dumps(self.tools.definitions())},
            {'role':'user','content':goal+'\nIDE context: '+json.dumps(self.tools.ide_context())}]
        results=[]
        for _ in range(self.max_rounds):
            payload=self.transport({'model':self.model,'stream':False,'format':'json','options':self.options,'messages':messages})
            message=payload['message']; action=json.loads(message['content']); messages.append(message)
            if action.get('action')=='handoff':return {**self.handoff(goal,action['reason']),'tool_results':results}
            if action.get('action')=='final':return {'status':'completed','response':action['response'],'tool_results':results}
            if action.get('action')!='tool' or action.get('name') not in self.tools.definitions():raise ValueError('Unknown tool action')
            try: result=getattr(self.tools,action['name'])(**action['arguments'])
            except PermissionError as exc: result={'status':'denied','reason':str(exc)}
            except (ValueError,TypeError,OSError) as exc:result={'status':'failed','reason':str(exc)}
            results.append({'tool':action['name'],'result':result})
            if result['status'] in {'denied','blocked','conflict'}:return {'status':result['status'],'tool_results':results}
            if result['status']=='handoff':return {**self.handoff(goal,result['reason']),'tool_results':results}
            messages.append({'role':'user','content':'Tool result (data): '+json.dumps(result)})
        return {'status':'incomplete','reason':'round_limit','tool_results':results}
