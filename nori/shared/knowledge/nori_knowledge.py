"""NORI-owned local document index for the Oracle Knight.

This deliberately has no network fetcher or embedding dependency.  It accepts
bounded UTF-8 text documents from a configured root and returns scored excerpts
with source paths, making every retrieved fact traceable to a local file.
"""

from __future__ import annotations

import json
import re
import sqlite3
from hashlib import sha256
from pathlib import Path
from typing import Iterable
from uuid import uuid4

from audit.nori_audit import record
from permissions.nori_policy import Policy


MAX_DOCUMENT_BYTES = 512 * 1024
MAX_DOCUMENTS = 1000
MAX_QUERY_CHARS = 512
SUPPORTED_SUFFIXES = frozenset({".txt", ".md", ".json", ".csv"})


def _terms(value: str) -> set[str]:
    return {term for term in re.findall(r"[a-z0-9][a-z0-9_-]{1,63}", value.lower())}


class KnowledgeStore:
    def __init__(self, root: Path, policy: Policy, audit_path: Path):
        self.root = Path(root).resolve()
        self.policy = policy
        self.audit_path = Path(audit_path)
        self.records: dict[str, dict] = {}
        self.index_path = self.root / 'knowledge-index.sqlite3'

    def _index_path(self):
        if self.index_path.is_symlink() or self.index_path.resolve() != self.index_path:
            raise ValueError('Linked knowledge index refused')
        return self.index_path

    def _save_record(self, identifier, text):
        connection = sqlite3.connect(self._index_path(),timeout=3)
        try:
            connection.execute('PRAGMA synchronous=FULL')
            with connection:
                connection.execute('CREATE TABLE IF NOT EXISTS documents (path TEXT PRIMARY KEY,text TEXT NOT NULL)')
                connection.execute('BEGIN IMMEDIATE')
                exists = connection.execute('SELECT 1 FROM documents WHERE path=?',(identifier,)).fetchone()
                count = connection.execute('SELECT COUNT(*) FROM documents').fetchone()[0]
                if not exists and count >= MAX_DOCUMENTS:
                    raise ValueError('knowledge index is full')
                connection.execute('INSERT INTO documents(path,text) VALUES (?,?) ON CONFLICT(path) DO UPDATE SET text=excluded.text',(identifier,text))
        finally:
            connection.close()

    def _load_records(self):
        path = self._index_path()
        if not path.exists():
            return
        connection = sqlite3.connect(path.as_uri()+'?mode=ro',uri=True,timeout=3)
        try:
            loaded = {}
            for identifier,text in connection.execute('SELECT path,text FROM documents ORDER BY path LIMIT ?', (MAX_DOCUMENTS+1,)):
                candidate = (self.root/identifier).resolve()
                if (type(identifier) is not str or len(identifier)>260 or self.root not in candidate.parents
                        or candidate.suffix.lower() not in SUPPORTED_SUFFIXES
                        or type(text) is not str or len(text.encode('utf-8'))>MAX_DOCUMENT_BYTES):
                    raise ValueError('Invalid persisted knowledge record')
                loaded[identifier] = {'path':identifier,'text':text,'terms':sorted(_terms(text))}
            if len(loaded)>MAX_DOCUMENTS:
                raise ValueError('Persisted knowledge index exceeds bounds')
            self.records = loaded
        finally:
            connection.close()

    def _relative_file(self, value: object) -> tuple[Path, str]:
        if not isinstance(value, str) or not value or len(value) > 260:
            raise ValueError("document path is invalid")
        candidate = (self.root / value).resolve()
        if self.root not in candidate.parents or candidate == self.root:
            raise ValueError("document must remain inside knowledge root")
        if candidate.suffix.lower() not in SUPPORTED_SUFFIXES or not candidate.is_file():
            raise ValueError("document is unsupported or missing")
        return candidate, candidate.relative_to(self.root).as_posix()

    def index(self, relative_path: object) -> dict:
        path, identifier = self._relative_file(relative_path)
        task_id = str(uuid4())
        decision = self.policy.decide("knowledge_index")
        if not decision.allowed:
            record(self.audit_path, "oracle_knowledge", task_id, "denied", {"path": identifier, "reason": decision.reason})
            return {"status": "denied", "task_id": task_id, "reason": decision.reason}
        if len(self.records) >= MAX_DOCUMENTS and identifier not in self.records:
            raise ValueError("knowledge index is full")
        if path.stat().st_size > MAX_DOCUMENT_BYTES:
            raise ValueError("document is too large")
        with path.open('rb') as handle:
            contents = handle.read(MAX_DOCUMENT_BYTES + 1)
        if len(contents) > MAX_DOCUMENT_BYTES:
            raise ValueError('document grew beyond size limit')
        text = contents.decode('utf-8')
        if not text.strip():
            raise ValueError("document is empty")
        self._save_record(identifier,text)
        self.records[identifier] = {"path": identifier, "text": text, "terms": sorted(_terms(text))}
        record(self.audit_path, "oracle_knowledge", task_id, "indexed", {"path": identifier, "bytes": len(text.encode("utf-8"))})
        return {"status": "indexed", "task_id": task_id, "path": identifier}

    def search(self, query: object, limit: object = 5) -> dict:
        if not isinstance(query, str) or not query.strip() or len(query) > MAX_QUERY_CHARS:
            raise ValueError("knowledge query is invalid")
        if type(limit) is not int or not 1 <= limit <= 20:
            raise ValueError("knowledge result limit is invalid")
        task_id = str(uuid4())
        decision = self.policy.decide("knowledge_read")
        if not decision.allowed:
            record(self.audit_path, "oracle_knowledge", task_id, "denied", {"reason": decision.reason})
            return {"status": "denied", "task_id": task_id, "reason": decision.reason}
        query_terms = _terms(query)
        self._load_records()
        results = []
        for item in self.records.values():
            score = len(query_terms & set(item["terms"]))
            if not score:
                continue
            match = re.search("|".join(re.escape(term) for term in sorted(query_terms)), item["text"], re.IGNORECASE)
            start = max(0, (match.start() if match else 0) - 120)
            excerpt = item["text"][start:start + 420].replace("\n", " ").strip()
            results.append({"source": item["path"], "score": score, "excerpt": excerpt,
                            'evidence_type': 'indexed_snapshot',
                            'indexed_text_sha256': sha256(item['text'].encode('utf-8')).hexdigest()})
        results.sort(key=lambda entry: (-entry["score"], entry["source"]))
        record(self.audit_path, "oracle_knowledge", task_id, "completed", {"results": min(len(results), limit)})
        return {"status": "completed", "task_id": task_id, "results": results[:limit]}

    def export_manifest(self) -> dict:
        decision = self.policy.decide('knowledge_read')
        if not decision.allowed:
            record(self.audit_path,'oracle_manifest',str(uuid4()),'denied',{'reason':decision.reason})
            raise PermissionError('Knowledge manifest read denied')
        self._load_records()
        return {"documents": [{"path": item["path"], "terms": len(item["terms"])} for item in self.records.values()]}
