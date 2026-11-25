"""The Machine is a model service facade, not an LLM agent."""
from ..inference.router import InferenceRouter
from ..inference.embeddings import Embeddings
from ..inference.reranker import Reranker

class Machine:
    def __init__(self,registry=None,backend=None,notify_architect=None):
        self.router=InferenceRouter(registry,backend,notify_architect)
        self.embeddings=Embeddings(self.router);self.reranker=Reranker(self.embeddings)
    def model_inference(self,*args,**kwargs):return self.router.model_inference(*args,**kwargs)
    def embed(self,texts):return self.embeddings.embed(texts)
    def rerank(self,query,documents,top_k=5):return self.reranker.rerank(query,documents,top_k)
    def model_status(self):return self.router.model_status()
