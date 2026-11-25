"""Bounded research decomposition; planning can use a local model."""
class ResearchPlanner:
    def __init__(self,generate=None):self.generate=generate
    def plan(self,question):
        if not isinstance(question,str) or not question.strip() or len(question)>2000:raise ValueError('Invalid research question')
        queries=self.generate(question) if self.generate else [question,question+' evidence and limitations',question+' conflicting findings']
        if not isinstance(queries,list) or not 1<=len(queries)<=6:raise ValueError('Expected 1 to 6 sub-queries')
        if any(not isinstance(q,str) or not q.strip() or len(q)>2200 for q in queries):raise ValueError('Invalid sub-query')
        return list(dict.fromkeys(q.strip() for q in queries))
