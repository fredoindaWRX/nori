"""Explicit task-type routing to registered local Ollama models."""
import json
from pathlib import Path
from urllib.request import Request,build_opener,ProxyHandler,HTTPRedirectHandler
from urllib.error import HTTPError
from urllib.parse import urlsplit
from threading import RLock
from .oom_handler import BackendError,OOMHandler
from .compute_nodes import ComputeNodeRegistry
from .model_hierarchy import ModelHierarchy
ROOT=Path(__file__).resolve().parents[4]

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

class OllamaBackend:
    def __init__(self,endpoint='http://127.0.0.1:11434'):
        u=urlsplit(endpoint)
        if u.scheme!='http' or u.hostname not in {'127.0.0.1','::1'} or u.username or u.password or u.path not in ('','/') or u.query or u.fragment:raise ValueError('Literal loopback endpoint required')
        self.endpoint=endpoint.rstrip('/');self.opener=build_opener(ProxyHandler({}),NoRedirect())
    def __call__(self,path,payload=None):
        request=Request(self.endpoint+path,data=None if payload is None else json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
        try:
            with self.opener.open(request,timeout=180) as response:result=json.load(response)
        except HTTPError as exc:raise BackendError(exc.read(8192).decode(errors='replace'),exc.code) from exc
        if not isinstance(result,dict):raise BackendError('Invalid model response')
        if result.get('error'):raise BackendError(str(result['error']))
        return result

class InferenceRouter:
    def __init__(self,registry=None,backend=None,notify=None,node_registry=None,route_specs=None,backend_factory=None,hierarchy=None):
        if registry is None:
            config=json.loads((ROOT/'config.yaml').read_text())
            c=config['knights']
            registry={'general':c['trinity']['model'],'coding':c['neo']['model'],'knowledge':c['oracle']['model'],'embeddings':'embeddinggemma','rerank':'embeddinggemma'}
            compute=config.get('compute',{})
            if node_registry is None and compute.get('nodes'):
                node_registry=ComputeNodeRegistry.from_config(compute['nodes'])
            if route_specs is None:
                route_specs=compute.get('routing')
            if hierarchy is None and config.get('models',{}).get('hierarchy'):
                hierarchy=ModelHierarchy.from_config(config['models']['hierarchy'])
        if not isinstance(registry,dict) or any(not isinstance(k,str) or not isinstance(v,str) or not v for k,v in registry.items()):raise ValueError('Invalid model registry')
        if node_registry is not None and not isinstance(node_registry,ComputeNodeRegistry):raise ValueError('Invalid compute node registry')
        if route_specs is not None and not isinstance(route_specs,dict):raise ValueError('Invalid compute routes')
        if hierarchy is not None and not isinstance(hierarchy,ModelHierarchy):raise ValueError('Invalid model hierarchy')
        self.registry=dict(registry);self.node_registry=node_registry;self.route_specs=dict(route_specs or {});self.hierarchy=hierarchy
        self.backend=backend;self.backend_factory=backend_factory or OllamaBackend;self.backends={};self.oom=OOMHandler(notify)
        if self.backend is None and self.node_registry is None:self.backend=OllamaBackend()
        self.lock=RLock()
    def select(self,task_type):
        if task_type not in self.registry:raise ValueError('Unregistered task type')
        return self.registry[task_type]
    def select_node(self,task_type):
        if self.node_registry is None:return None
        route=self.route_specs.get(task_type)
        if not isinstance(route,dict):raise ValueError('Unregistered compute route')
        return self.node_registry.select(route.get('capability'),route.get('minimum_memory_gb',0),route.get('prefer',()))
    def _backend_for(self,node):
        if self.backend is not None:return self.backend
        if node.id not in self.backends:self.backends[node.id]=self.backend_factory(node.endpoint)
        return self.backends[node.id]
    def invoke(self,task_type,path,payload,complexity='standard'):
        route=self.hierarchy.route(task_type,complexity) if self.hierarchy else None
        if route is not None and not route.available:raise LookupError(f'no model is assigned to {route.tier} tier')
        model=route.model if route else self.select(task_type)
        compute_task=route.compute_task if route else task_type
        body={**payload,'model':model}
        node=self.select_node(compute_task)
        with self.lock:result=self.oom.execute(self._backend_for(node),path,body)
        return {**result,**({'compute_node':node.id} if node else {}),
                **({'model_tier':route.tier,'compute_task':compute_task} if route else {})}
    def model_inference(self,messages,task_type='general',max_tokens=768,complexity='standard'):
        if task_type in {'embeddings','rerank'}:raise ValueError('Use embedding route')
        if not isinstance(messages,list) or not messages or len(messages)>100:raise ValueError('Messages required')
        if any(not isinstance(m,dict) or m.get('role') not in {'system','user','assistant'} or not isinstance(m.get('content'),str) for m in messages):raise ValueError('Invalid message')
        if sum(len(m['content']) for m in messages)>32000:raise ValueError('Input too large')
        if type(max_tokens) is not int or not 1<=max_tokens<=4096:raise ValueError('Invalid token limit')
        result=self.invoke(task_type,'/api/chat',{'messages':messages,'stream':False,'options':{'num_ctx':4096,'num_predict':max_tokens,'num_thread':8}},complexity)
        content=result['result'].get('message',{}).get('content')
        if not isinstance(content,str):raise BackendError('Missing assistant content')
        selected=self.hierarchy.route(task_type,complexity).model if self.hierarchy else self.select(task_type)
        return {**result,'model':selected,'response':content}
    def model_status(self):
        node=self.select_node('general') if self.node_registry else None
        backend=self._backend_for(node)
        installed=backend('/api/tags').get('models',[])
        loaded=backend('/api/ps').get('models',[])
        def match(name,items):return [m for m in items if m.get('name',m.get('model')) in {name,name+':latest'}]
        return {'routes':{k:{'model':v,'installed':bool(match(v,installed)),'loaded':bool(match(v,loaded))} for k,v in self.registry.items()},'loaded_models':loaded,
                'active_node':node.id if node else 'legacy-local','nodes':self.node_registry.status() if self.node_registry else []}
