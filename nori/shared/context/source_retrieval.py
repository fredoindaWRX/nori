"""Deterministic, bounded lexical retrieval over a SourceCatalog archive."""

from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path, PurePosixPath
import re
from typing import Mapping


_TOKEN = re.compile(r"[\w]+", re.UNICODE)
_SCHEMA = "nori.source-catalog.v2"


class SourceRetriever:
    """Search preserved UTF-8 Markdown/text sources without external services."""

    def __init__(self, catalog_root: str | Path, *, max_source_bytes: int = 8 * 1024 * 1024,
                 max_excerpt_chars: int = 1200, max_results: int = 20):
        self.root = Path(catalog_root).resolve()
        if (not isinstance(max_source_bytes, int) or max_source_bytes < 1
                or not isinstance(max_excerpt_chars, int) or max_excerpt_chars < 1
                or not isinstance(max_results, int) or max_results < 1):
            raise ValueError("retrieval bounds must be positive integers")
        self.max_source_bytes = max_source_bytes
        self.max_excerpt_chars = max_excerpt_chars
        self.max_results = max_results

    def _catalog(self) -> dict:
        path = self.root / "catalog.json"
        if path.is_symlink() or not path.is_file():
            raise ValueError("source catalog is missing or linked")
        try:
            catalog = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ValueError("source catalog is invalid") from exc
        if (not isinstance(catalog, dict) or catalog.get("schema") != _SCHEMA
                or not isinstance(catalog.get("sources"), dict)):
            raise ValueError("source catalog is invalid")
        return catalog

    def _source(self, record: object) -> tuple[str, str, str, bytes] | None:
        if not isinstance(record, dict):
            raise ValueError("source record is invalid")
        sid, title, stored = record.get("id"), record.get("title"), record.get("stored_path")
        digest, size = record.get("sha256"), record.get("bytes")
        if (not isinstance(sid, str) or not sid or not isinstance(title, str) or not title
                or not isinstance(stored, str) or not isinstance(digest, str)
                or not re.fullmatch(r"[0-9a-f]{64}", digest)
                or not isinstance(size, int) or isinstance(size, bool) or size < 0):
            raise ValueError("source record is invalid")
        rel = PurePosixPath(stored)
        if rel.is_absolute() or ".." in rel.parts or "\\" in stored or not rel.parts:
            raise ValueError("source path escapes catalog")
        path = self.root.joinpath(*rel.parts)
        current = self.root
        for part in rel.parts:
            current = current / part
            if current.is_symlink():
                raise ValueError("linked source paths are not allowed")
        try:
            path.resolve(strict=True).relative_to(self.root)
        except (OSError, ValueError) as exc:
            raise ValueError("source path escapes catalog") from exc
        if path.suffix.lower() not in {".md", ".txt"}:
            return None
        if size > self.max_source_bytes:
            return None
        if not path.is_file() or path.stat().st_size != size:
            raise ValueError("source file does not match catalog")
        raw = path.read_bytes()
        if len(raw) > self.max_source_bytes or sha256(raw).hexdigest() != digest:
            raise ValueError("source file does not match catalog")
        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError("source file is not UTF-8") from exc
        return sid, title, stored, text.encode("utf-8")

    def search(self, query: str, *, related_terms: Mapping[str, object] | None = None,
               limit: int | None = None) -> list[dict]:
        if not isinstance(query, str) or not query.strip():
            raise ValueError("query must be non-empty text")
        cap = self.max_results if limit is None else limit
        if not isinstance(cap, int) or isinstance(cap, bool) or cap < 1:
            raise ValueError("result limit must be a positive integer")
        cap = min(cap, self.max_results)
        query_terms = set(t.casefold() for t in _TOKEN.findall(query))
        rules: dict[str, set[str]] = {}
        if related_terms is not None:
            if not isinstance(related_terms, Mapping):
                raise ValueError("related_terms must be a mapping")
            for key, values in related_terms.items():
                if not isinstance(key, str) or not isinstance(values, (str, list, tuple, set)):
                    raise ValueError("related-term rule is invalid")
                vals = [values] if isinstance(values, str) else values
                if any(not isinstance(v, str) for v in vals):
                    raise ValueError("related-term rule is invalid")
                rules[key.casefold()] = {t.casefold() for v in vals for t in _TOKEN.findall(v)}
        inferred_terms = set().union(*(rules.get(term, set()) for term in query_terms)) if query_terms else set()
        hits = []
        for record in self._catalog()["sources"].values():
            loaded = self._source(record)
            if loaded is None:
                continue
            sid, title, stored, raw = loaded
            text = raw.decode("utf-8")
            tokens = [t.casefold() for t in _TOKEN.findall(text)]
            overlap = query_terms.intersection(tokens)
            related_overlap = inferred_terms.intersection(tokens) - query_terms
            score = len(overlap) + len(related_overlap) * 0.5
            if score <= 0:
                continue
            # Select the first matching sentence/line as the exact source excerpt.
            candidates = [line.strip() for line in text.splitlines() if line.strip()]
            excerpt = next((line for line in candidates
                            if query_terms.intersection(t.casefold() for t in _TOKEN.findall(line))), None)
            if excerpt is None:
                excerpt = next((line for line in candidates
                                if inferred_terms.intersection(t.casefold() for t in _TOKEN.findall(line))), None)
            if excerpt is None:
                excerpt = candidates[0] if candidates else ""
            excerpt = excerpt[:self.max_excerpt_chars]
            excerpt_terms = {t.casefold() for t in _TOKEN.findall(excerpt)}
            direct_excerpt_terms = query_terms.intersection(excerpt_terms)
            inferred_excerpt_terms = inferred_terms.intersection(excerpt_terms)
            relationship = ("extracted" if query_terms and direct_excerpt_terms == query_terms else
                            "inferred" if not direct_excerpt_terms and inferred_excerpt_terms else
                            "ambiguous")
            hits.append({"source_id": sid, "title": title, "stored_path": stored,
                         "excerpt": excerpt, "sha256": sha256(raw).hexdigest(),
                         "score": score, "relationship": relationship})
        hits.sort(key=lambda item: (-item["score"], item["source_id"]))
        return hits[:cap]
