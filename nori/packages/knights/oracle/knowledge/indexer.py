"""Explicit local corpus snapshots with persistent Chroma vectors and local embeddings."""
import hashlib
import json
from pathlib import Path
from uuid import uuid4
from urllib.request import Request,build_opener,ProxyHandler,HTTPRedirectHandler
from urllib.parse import urlsplit

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

class LocalOllama:
    def __init__(self,endpoint="http://127.0.0.1:11434"):
        u=urlsplit(endpoint)
        if u.scheme!='http' or u.hostname not in {'127.0.0.1','::1'} or u.username or u.password or u.path not in ('','/') or u.query or u.fragment:
            raise ValueError('Literal loopback Ollama endpoint required')
        self.endpoint=endpoint.rstrip('/');self.opener=build_opener(ProxyHandler({}),NoRedirect())
    def post(self,path,body):
        req=Request(self.endpoint+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
        with self.opener.open(req,timeout=180) as response:return json.load(response)

class OllamaEmbeddings:
    def __init__(self,model='embeddinggemma',endpoint='http://127.0.0.1:11434'):
        self.model=model;self.client=LocalOllama(endpoint)
    def __call__(self,texts):
        return self.client.post('/api/embed',{'model':self.model,'input':texts,'truncate':False})['embeddings']

class DocumentIndexer:
    def __init__(self,db_path,embedder=None):
        import chromadb
        from chromadb.config import Settings
        self.root=Path(db_path).resolve();self.root.mkdir(parents=True,exist_ok=True)
        self.client=chromadb.PersistentClient(path=str(self.root/'chroma'),settings=Settings(anonymized_telemetry=False))
        self.embedder=embedder or OllamaEmbeddings()
        self.manifest=self.root/'active.json'

    @staticmethod
    def text(path):
        if path.suffix.lower() in {'.txt','.md','.csv','.json','.rst'}:return path.read_text(encoding='utf-8')
        if path.suffix.lower()=='.pdf':
            import pdfplumber
            with pdfplumber.open(path) as pdf:return '\n'.join(page.extract_text() or '' for page in pdf.pages)
        if path.suffix.lower()=='.docx':
            from zipfile import ZipFile
            from xml.etree import ElementTree
            with ZipFile(path) as z:
                info=z.getinfo('word/document.xml')
                if info.file_size>10_000_000:raise ValueError('DOCX expanded text too large')
                tree=ElementTree.fromstring(z.read(info))
            return '\n'.join(''.join(p.itertext()) for p in tree.iter('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}p'))
        raise ValueError('Unsupported document format')

    def build(self,docs_root):
        docs=Path(docs_root).resolve()
        if not docs.is_dir():raise ValueError('Document folder required')
        if docs==self.root or docs in self.root.parents:raise ValueError('Database must be outside document corpus')
        name='oracle-'+uuid4().hex
        collection=self.client.create_collection(name,metadata={'hnsw:space':'cosine'},embedding_function=None)
        count=0;skipped=[]
        try:
            for path in sorted(docs.rglob('*')):
                if not path.is_file():continue
                resolved=path.resolve()
                if docs not in resolved.parents:raise ValueError('Document symlink escapes corpus')
                if path.suffix.lower() not in {'.txt','.md','.csv','.json','.rst','.pdf','.docx'}:
                    skipped.append(path.relative_to(docs).as_posix());continue
                if path.stat().st_size>20_000_000:raise ValueError('Document exceeds 20MB limit')
                text=self.text(path)
                if not text.strip():skipped.append(path.relative_to(docs).as_posix());continue
                if len(text)>2_000_000:raise ValueError('Extracted text too large')
                source=path.relative_to(docs).as_posix();digest=hashlib.sha256(text.encode()).hexdigest()
                chunks=[text[i:i+1600] for i in range(0,len(text),1400)]
                for start in range(0,len(chunks),32):
                    batch=chunks[start:start+32]
                    ids=[hashlib.sha256(f'{source}:{digest}:{start+i}'.encode()).hexdigest() for i in range(len(batch))]
                    collection.add(ids=ids,documents=batch,embeddings=self.embedder(batch),metadatas=[{'source':source,'chunk':start+i,'sha256':digest} for i in range(len(batch))])
                    count+=len(batch)
            state={'collection':name,'embedding_model':self.embedder.model,'chunks':count,'skipped':skipped}
            temp=self.root/(uuid4().hex+'.json');temp.write_text(json.dumps(state),encoding='utf-8');temp.replace(self.manifest)
            return {'status':'completed',**state}
        except Exception:
            self.client.delete_collection(name);raise

    def active(self):
        if not self.manifest.exists():return None
        state=json.loads(self.manifest.read_text())
        if state['embedding_model']!=self.embedder.model:raise ValueError('Embedding model changed: rebuild required')
        return self.client.get_collection(state['collection'],embedding_function=None)
