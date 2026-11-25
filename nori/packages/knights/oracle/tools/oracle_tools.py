"""Only indexed evidence is exposed; file_read returns indexed chunks, not disk paths."""
class OracleTools:
    def __init__(self,indexer):self.indexer=indexer
    def embeddings(self,texts):return self.indexer.embedder(texts)
    def vector_search(self,query,limit=5,max_distance=0.55):
        if not isinstance(query,str) or not query.strip() or len(query)>4000:raise ValueError('Invalid query')
        if type(limit) is not int or not 1<=limit<=10:raise ValueError('Invalid limit')
        c=self.indexer.active()
        if c is None or not c.count():return []
        result=c.query(query_embeddings=self.embeddings([query]),n_results=min(limit,c.count()),include=['documents','metadatas','distances'])
        return [{'id':id,'text':text,'source':meta['source'],'chunk':meta['chunk'],'distance':distance} for id,text,meta,distance in zip(result['ids'][0],result['documents'][0],result['metadatas'][0],result['distances'][0]) if distance<=max_distance]
    def file_read(self,chunk_id):
        c=self.indexer.active()
        if c is None:raise KeyError('No index')
        r=c.get(ids=[chunk_id],include=['documents','metadatas'])
        if not r['ids']:raise KeyError('Chunk is not indexed')
        return {'id':chunk_id,'text':r['documents'][0],'source':r['metadatas'][0]['source']}
    def document_qa(self,question,selector):
        evidence=self.vector_search(question)
        missing={'status':'not_found','answer':"I could not find an answer in the indexed local documents.",'citations':[]}
        if not evidence:return missing
        selection=selector(question,evidence)
        if selection.get('found') is not True:return missing
        citations=selection.get('citations',[]);lookup={e['id']:e for e in evidence}
        if not isinstance(citations,list) or not 1<=len(citations)<=5:return missing
        checked=[]
        for citation in citations:
            if not isinstance(citation,dict):return missing
            item=lookup.get(citation.get('id'));quote=citation.get('quote')
            if not item or not isinstance(quote,str) or not quote.strip() or quote not in item['text']:return missing
            checked.append({'id':item['id'],'source':item['source'],'chunk':item['chunk'],'quote':quote})
        return {'status':'completed','answer':'\n\n'.join(c['quote'] for c in checked),'citations':checked,'answer_mode':'verified_excerpts'}
