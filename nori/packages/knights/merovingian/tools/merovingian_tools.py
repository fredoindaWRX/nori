"""Append-only memory journal with immutable owner and optional Letta replication."""
import json
import sqlite3
import re
from pathlib import Path
from uuid import uuid4
from datetime import datetime,timezone
from urllib.request import Request,build_opener,ProxyHandler,HTTPRedirectHandler
from urllib.parse import urlsplit

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None

class LettaBlocks:
    def __init__(self,endpoint='http://127.0.0.1:8283',token=None):
        u=urlsplit(endpoint)
        if u.scheme!='http' or u.hostname not in {'127.0.0.1','::1'} or u.username or u.password or u.path not in ('','/') or u.query or u.fragment:raise ValueError('Local Letta required')
        self.endpoint=endpoint.rstrip('/');self.token=token;self.opener=build_opener(ProxyHandler({}),NoRedirect())
    def create(self,record):
        body={'label':'nori_'+record['scope']+'_'+record['id'],'value':record['content'],'limit':max(5000,len(record['content'])),
            'metadata':{'nori_id':record['id'],'source_ids':record['source_ids'],'derived':bool(record['source_ids'])},'read_only':True}
        headers={'Content-Type':'application/json'}
        if self.token:headers['Authorization']='Bearer '+self.token
        req=Request(self.endpoint+'/v1/blocks/',data=json.dumps(body).encode(),headers=headers)
        with self.opener.open(req,timeout=20) as response:return json.load(response)['id']

class MemoryTools:
    def __init__(self,path,owner_fingerprint,letta=None):
        if not isinstance(owner_fingerprint,str) or not owner_fingerprint.strip():raise ValueError('Owner fingerprint required')
        self.path=Path(path);self.path.parent.mkdir(parents=True,exist_ok=True);self.letta=letta
        with self.connect() as db:
            db.executescript("""CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK(id=1), fingerprint TEXT NOT NULL);
            CREATE TRIGGER IF NOT EXISTS owner_no_update BEFORE UPDATE ON owner BEGIN SELECT RAISE(ABORT,'immutable owner'); END;
            CREATE TRIGGER IF NOT EXISTS owner_no_delete BEFORE DELETE ON owner BEGIN SELECT RAISE(ABORT,'immutable owner'); END;
            CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, scope TEXT, content TEXT, actor TEXT, created TEXT, sources TEXT, compressed INTEGER DEFAULT 0, letta_id TEXT);
            """)
            db.execute('INSERT OR IGNORE INTO owner VALUES (1,?)',(owner_fingerprint,))
            if db.execute('SELECT fingerprint FROM owner WHERE id=1').fetchone()[0]!=owner_fingerprint:raise PermissionError('Owner mismatch')
            db.executescript("""CREATE TABLE IF NOT EXISTS identity_covenant (id INTEGER PRIMARY KEY CHECK(id=1), record TEXT NOT NULL);
            CREATE TRIGGER IF NOT EXISTS covenant_no_update BEFORE UPDATE ON identity_covenant BEGIN SELECT RAISE(ABORT,'immutable covenant'); END;
            CREATE TRIGGER IF NOT EXISTS covenant_no_delete BEFORE DELETE ON identity_covenant BEGIN SELECT RAISE(ABORT,'immutable covenant'); END;
            CREATE TRIGGER IF NOT EXISTS covenant_no_replace BEFORE INSERT ON identity_covenant WHEN EXISTS(SELECT 1 FROM identity_covenant) BEGIN SELECT RAISE(ABORT,'immutable covenant'); END;
            """)
            # Development labels remain usable for existing memory; do not
            # fabricate an activated owner covenant for them.
            if re.fullmatch(r'[0-9a-fA-F]{64}',owner_fingerprint):
                from prompts.covenant import identity_record
                current=db.execute('SELECT record FROM identity_covenant WHERE id=1').fetchone()
                if current is None:
                    db.execute('INSERT INTO identity_covenant VALUES (1,?)',
                               (json.dumps(identity_record(owner_fingerprint)),))
                elif json.loads(current[0]).get('owner_fingerprint') != owner_fingerprint.lower():
                    raise PermissionError('Covenant owner mismatch')
    def connect(self):
        db=sqlite3.connect(self.path,timeout=30);db.row_factory=sqlite3.Row;return db
    @staticmethod
    def decode(row):
        value=dict(row);value['source_ids']=json.loads(value.pop('sources'));return value
    def owner(self):
        with self.connect() as db:return db.execute('SELECT fingerprint FROM owner WHERE id=1').fetchone()[0]
    def memory_write(self,content,actor,scope='archival'):
        if scope not in {'core','archival'}:raise ValueError('Only core and archival writes allowed')
        if not isinstance(content,str) or not content.strip() or len(content)>16000:raise ValueError('Invalid memory content')
        if not isinstance(actor,str) or not actor.strip():raise ValueError('Actor required')
        id=uuid4().hex
        with self.connect() as db:
            db.execute('INSERT INTO memories(id,scope,content,actor,created,sources) VALUES (?,?,?,?,?,?)',(id,scope,content,actor,datetime.now(timezone.utc).isoformat(),'[]'))
        return self.memory_read(id)
    def memory_read(self,id):
        if id=='owner_fingerprint':return {'owner_fingerprint':self.owner(),'immutable':True}
        if id=='covenant':
            with self.connect() as db:row=db.execute('SELECT record FROM identity_covenant WHERE id=1').fetchone()
            if row is None:raise RuntimeError('Owner identity covenant pending activation')
            return {**json.loads(row[0]),'immutable':True,'authority':'local_memory_identity'}
        with self.connect() as db:row=db.execute('SELECT * FROM memories WHERE id=?',(id,)).fetchone()
        if row is None:raise KeyError('Memory not found')
        return self.decode(row)
    def memory_search(self,query,limit=20):
        if not isinstance(query,str) or len(query)>1000 or type(limit) is not int or not 1<=limit<=100:raise ValueError('Invalid search')
        with self.connect() as db:
            rows=db.execute('SELECT * FROM memories WHERE instr(lower(content),lower(?))>0 ORDER BY created DESC LIMIT ?',(query,limit)).fetchall()
        return [self.decode(row) for row in rows]
    def sync_letta(self):
        if self.letta is None:return {'status':'unconfigured'}
        with self.connect() as db:rows=db.execute('SELECT * FROM memories WHERE letta_id IS NULL').fetchall()
        synced=0
        for row in rows:
            try:
                id=self.letta.create(self.decode(row))
                with self.connect() as db:db.execute('UPDATE memories SET letta_id=? WHERE id=?',(id,row['id']))
                synced+=1
            except Exception as exc:return {'status':'incomplete','synced':synced,'error_type':type(exc).__name__}
        return {'status':'completed','synced':synced}
    def _consolidate(self,summarizer):
        with self.connect() as db:rows=db.execute("SELECT * FROM memories WHERE scope='archival' AND compressed=0 ORDER BY created LIMIT 20").fetchall()
        if len(rows)<2:return {'status':'skipped','reason':'insufficient_memories'}
        # Fit the local model context; leave oversized memories uncompressed.
        selected=[];budget=0
        for row in rows:
            if budget+len(row["content"])>6000:continue
            selected.append(row);budget+=len(row["content"])
        rows=selected
        if len(rows)<2:return {"status":"skipped","reason":"batch_exceeds_context_budget"}
        records=[self.decode(r) for r in rows];summary=summarizer(records)
        if not isinstance(summary,str) or not summary.strip() or len(summary)>16000:raise ValueError('Invalid summary')
        ids=[r['id'] for r in rows];id=uuid4().hex
        with self.connect() as db:
            db.execute('INSERT INTO memories(id,scope,content,actor,created,sources,compressed) VALUES (?,?,?,?,?,?,1)',(id,'core',summary,'merovingian',datetime.now(timezone.utc).isoformat(),json.dumps(ids)))
            db.executemany('UPDATE memories SET compressed=1 WHERE id=?',[(i,) for i in ids])
        return {'status':'completed','summary':self.memory_read(id),'originals_preserved':True}
