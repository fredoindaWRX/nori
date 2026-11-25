"""Validated local vector generation through The Machine's OOM-aware router."""
import math
from .oom_handler import BackendError

class Embeddings:
    def __init__(self,router):self.router=router
    def embed(self,texts,task_type='embeddings'):
        if not isinstance(texts,list) or not 1<=len(texts)<=64 or any(not isinstance(t,str) or not t.strip() or len(t)>8000 for t in texts):raise ValueError('Expected 1 to 64 bounded texts')
        result=self.router.invoke(task_type,'/api/embed',{'input':texts,'truncate':False})
        vectors=result['result'].get('embeddings')
        if not isinstance(vectors,list) or len(vectors)!=len(texts):raise BackendError('Invalid vector count')
        dimension=None
        for vector in vectors:
            if not isinstance(vector,list) or not vector or any(type(n) not in (int,float) or not math.isfinite(n) for n in vector):raise BackendError('Invalid vector')
            if dimension is None:dimension=len(vector)
            if len(vector)!=dimension:raise BackendError('Inconsistent vector dimensions')
        return {**result,'vectors':vectors,'model':self.router.select(task_type)}
