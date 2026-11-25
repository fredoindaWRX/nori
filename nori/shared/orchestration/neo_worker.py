"""NORI-native bounded workspace reader/writer for the Neo Knight."""

from __future__ import annotations

from pathlib import Path
import re
from typing import Any
from uuid import uuid4

from audit.nori_audit import record
from permissions.nori_policy import Policy
from security.hard_floor import HardFloorViolation, assert_file_allowed, assert_output_safe
from orchestration.workspace_paths import reject_link, workspace_path

SOURCE_SUFFIXES = frozenset({".py", ".js", ".ts", ".tsx", ".jsx", ".cs", ".cpp", ".c", ".h", ".hpp", ".java", ".go", ".rs", ".lua", ".html", ".css", ".json", ".md", ".txt", ".yml", ".yaml"})
SYMBOL_PATTERN = re.compile(r"^\s*(?:def|class|function|interface|struct|enum|fn|func)\s+([A-Za-z_][A-Za-z0-9_]*)")


class NeoWorker:
    def __init__(self, root: Path, policy: Policy, audit_path: Path):
        self.root = Path(root).resolve(); self.policy = policy; self.audit_path = Path(audit_path)
        self.project_root = None

    def _path(self, relative: object, *, operation: str = "read") -> tuple[Path, str]:
        path = workspace_path(self.root, relative, operation=operation)
        return path, path.relative_to(self.root).as_posix()

    def _source_files(self) -> list[Path]:
        if not self.root.is_dir(): return []
        files=[]
        for path in self.root.rglob("*"):
            if len(files) >= 500: break
            reject_link(path)
            if path.is_file() and path.suffix.lower() in SOURCE_SUFFIXES and path.stat().st_size <= 512 * 1024:
                resolved = workspace_path(self.root, path.relative_to(self.root).as_posix())
                files.append(resolved)
        return sorted(files)

    def _read_text(self, path: Path, *, errors: str = "strict") -> str:
        assert_file_allowed(path, operation="read")
        with path.open('rb') as handle:
            data = handle.read(512 * 1024 + 1)
        if len(data) > 512 * 1024:
            raise ValueError('Workspace source grew beyond size limit')
        content = data.decode('utf-8', errors=errors).replace('\r\n', '\n').replace('\r', '\n')
        # Inspect the complete file before slicing lines or extracting symbols;
        # otherwise a search could disclose private key material a line at a time.
        assert_output_safe(content)
        return content

    def run(self, request: dict[str, Any]) -> dict:
        if not isinstance(request, dict) or not isinstance(request.get("operation"), str):
            raise ValueError("neo request is invalid")
        task_id = str(uuid4())
        try:
            return self._run(request, task_id)
        except HardFloorViolation as error:
            reason = str(error)
            record(self.audit_path, "neo_workspace", task_id, "denied", {"operation": request["operation"], "reason": reason})
            return {"status": "denied", "task_id": task_id, "reason": reason}

    def _run(self, request: dict[str, Any], task_id: str) -> dict:
        operation = request["operation"]
        if operation == 'project_search' and set(request) == {'operation', 'query', 'directory'}:
            try:
                from orchestration.project_search import search_project
            except ModuleNotFoundError as exc:
                # Native startup and package-based tests expose the shared
                # runtime through different import roots.
                if exc.name != 'orchestration.project_search':
                    raise
                from shared.orchestration.project_search import search_project
            result = search_project(self, request['query'], request['directory'])
            record(self.audit_path, 'neo_project', task_id, result['status'],
                   {'operation': operation, 'matches': len(result.get('matches', []))})
            return result
        if operation == "project_read" and set(request) == {"operation", "path"}:
            if self.project_root is None:
                return {"status": "denied", "reason": "project_source_not_configured"}
            decision = self.policy.decide("workspace_read")
            if not decision.allowed:
                return {"status": "denied", "reason": decision.reason}
            path = workspace_path(self.project_root, request["path"])
            if path.suffix.lower() not in SOURCE_SUFFIXES or not path.is_file() or path.stat().st_size > 512 * 1024:
                raise ValueError("project source file is unavailable or too large")
            content = self._read_text(path)
            import hashlib
            digest = hashlib.sha256(content.encode("utf-8")).hexdigest()
            record(self.audit_path, "neo_project", task_id, "completed",
                   {"operation": operation, "path": request["path"], "text_sha256": digest})
            return {"status": "completed", "path": request["path"], "content": content,
                    "text_sha256": digest, "source": "project"}
        if operation == "search" and set(request) == {"operation", "query"}:
            query=request["query"]
            if not isinstance(query,str) or not query.strip() or len(query)>120: raise ValueError("search query is invalid")
            decision=self.policy.decide("ide_read")
            if not decision.allowed: return {"status":"denied","task_id":task_id,"reason":decision.reason}
            needle=query.casefold(); matches=[]
            for path in self._source_files():
                for line_number,line in enumerate(self._read_text(path, errors="replace").splitlines(),1):
                    if needle in line.casefold():
                        matches.append({"path":path.relative_to(self.root).as_posix(),"line":line_number,"text":line[:240]})
                        if len(matches)>=100: break
                if len(matches)>=100: break
            record(self.audit_path,"neo_ide",task_id,"completed",{"operation":"search","matches":len(matches)})
            return {"status":"completed","task_id":task_id,"matches":matches}
        if operation == "symbols" and set(request) == {"operation", "path"}:
            path,relative=self._path(request["path"]); decision=self.policy.decide("ide_read")
            if not decision.allowed: return {"status":"denied","task_id":task_id,"reason":decision.reason}
            if not path.is_file() or path.suffix.lower() not in SOURCE_SUFFIXES or path.stat().st_size>512*1024: raise ValueError("source file is unavailable")
            symbols=[]
            for line_number,line in enumerate(self._read_text(path, errors="replace").splitlines(),1):
                match=SYMBOL_PATTERN.match(line)
                if match: symbols.append({"name":match.group(1),"line":line_number})
            record(self.audit_path,"neo_ide",task_id,"completed",{"operation":"symbols","path":relative,"symbols":len(symbols)})
            return {"status":"completed","task_id":task_id,"path":relative,"symbols":symbols}
        if operation == "read" and set(request) == {"operation", "path"}:
            path, relative = self._path(request["path"])
            decision = self.policy.decide("workspace_read")
            if not decision.allowed:
                record(self.audit_path,"neo_workspace",task_id,"denied",{"path":relative,"reason":decision.reason}); return {"status":"denied","task_id":task_id,"reason":decision.reason}
            if not path.is_file() or path.stat().st_size > 512 * 1024: raise ValueError("workspace file is unavailable")
            content=self._read_text(path)
            record(self.audit_path,"neo_workspace",task_id,"completed",{"operation":"read","path":relative})
            return {"status":"completed","task_id":task_id,"path":relative,"content":content}
        if operation == "write" and set(request) == {"operation", "path", "content", "approved"}:
            path, relative = self._path(request["path"], operation="write"); content=request["content"]
            if not isinstance(content,str) or len(content.encode("utf-8")) > 512 * 1024: raise ValueError("workspace content is invalid")
            if request["approved"] is not True:
                record(self.audit_path,"neo_workspace",task_id,"denied",{"path":relative,"reason":"explicit_approval_required"}); return {"status":"denied","task_id":task_id,"reason":"explicit_approval_required"}
            decision=self.policy.decide("workspace_write")
            if not decision.allowed:
                record(self.audit_path,"neo_workspace",task_id,"denied",{"path":relative,"reason":decision.reason}); return {"status":"denied","task_id":task_id,"reason":decision.reason}
            assert_file_allowed(path, operation="write", content=content)
            # Preserve the submitted UTF-8 bytes on Windows as well as Linux.
            # Implicit LF -> CRLF translation breaks exact execution receipts.
            path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(content.encode("utf-8"))
            record(self.audit_path,"neo_workspace",task_id,"completed",{"operation":"write","path":relative,"bytes":len(content.encode("utf-8"))})
            return {"status":"completed","task_id":task_id,"path":relative}
        raise ValueError("neo request is invalid")
