"""Local embedding-similarity reranker (not a cross-encoder)."""
import math

class Reranker:
    def __init__(self,embeddings):self.embeddings=embeddings
    def rerank(self,query,documents,top_k=5):
        if not isinstance(documents,list) or not documents or len(documents)>63:raise ValueError('Expected 1 to 63 documents')
        if type(top_k) is not int or not 1<=top_k<=63:raise ValueError('Invalid top_k')
        result=self.embeddings.embed([query,*documents],task_type='rerank')
        q,*vectors=result['vectors'];norm=lambda v:math.sqrt(sum(x*x for x in v))
        scored=[]
        for index,v in enumerate(vectors):
            denom=norm(q)*norm(v)
            score=sum(a*b for a,b in zip(q,v))/denom if denom else 0.0
            scored.append({'index':index,'text':documents[index],'score':score})
        return {'results':sorted(scored,key=lambda x:-x['score'])[:top_k],'method':'embedding_cosine','model':result['model'],'fallback':result['fallback']}
