"""Open-buffer-only IDE tools. IDE context comes from a trusted host callback."""
import hashlib
from pathlib import Path
from threading import RLock

class MorpheusTools:
    def __init__(self, workspace_root, context_provider, *, allow_writes=False, apply_edit=None):
        self.root=Path(workspace_root).resolve()
        self.provider=context_provider
        self.allow_writes=allow_writes
        self.apply_edit=apply_edit
        self.lock=RLock()

    def _path(self,path):
        if not isinstance(path,str) or not path or Path(path).is_absolute() or ".." in Path(path).parts:
            raise ValueError("Relative workspace path required")
        resolved=(self.root/path).resolve()
        if self.root not in resolved.parents: raise PermissionError("Path escapes workspace")
        return resolved

    def _context(self):
        context=self.provider()
        if not isinstance(context,dict) or not isinstance(context.get("open_files"),list):
            raise ValueError("IDE must supply an open_files list")
        return context

    def _buffer(self,path):
        target=self._path(path)
        context=self._context()
        for item in context["open_files"]:
            if self._path(item["path"])==target:
                content=item.get("content")
                if content is None:
                    if item.get("dirty"): raise ValueError("Dirty buffer requires editor content")
                    if target.stat().st_size>512*1024: raise ValueError("File too large")
                    content=target.read_text(encoding="utf-8")
                if not isinstance(content,str) or len(content.encode())>512*1024: raise ValueError("Invalid buffer")
                return target,item,content
        raise PermissionError("File is not open in the IDE")

    @staticmethod
    def digest(content): return hashlib.sha256(content.encode()).hexdigest()

    def ide_context(self):
        context=self._context()
        return {"status":"completed","open_files":[{"path":item["path"],"dirty":bool(item.get("dirty"))} for item in context["open_files"]],
            "project_tree":context.get("project_tree",[]),"diagnostics":context.get("diagnostics",[])}

    def read_file(self,path):
        _,_,content=self._buffer(path)
        return {"status":"completed","path":path,"content":content,"sha256":self.digest(content)}

    def edit_file(self,path,old,new,expected_sha256):
        with self.lock:
            target,item,content=self._buffer(path)
            if not self.allow_writes: return {"status":"denied","reason":"host_write_permission_required"}
            if self.digest(content)!=expected_sha256: return {"status":"conflict","reason":"buffer_changed"}
            if not isinstance(old,str) or not old or not isinstance(new,str) or content.count(old)!=1:
                raise ValueError("Replacement must match exactly one nonempty region")
            if max(len(old),len(new))>8000: return {"status":"handoff","destination":"neo","reason":"Edit exceeds targeted-change limit"}
            updated=content.replace(old,new,1)
            if len(updated.encode())>512*1024: raise ValueError("Updated buffer too large")
            if self.apply_edit:
                # Host must compare the version atomically and apply through the editor API.
                return self.apply_edit(path,expected_sha256,updated)
            if "content" in item or item.get("dirty"):
                return {"status":"blocked","reason":"editor_apply_edit_callback_required"}
            if self.digest(target.read_text(encoding="utf-8"))!=expected_sha256:
                return {"status":"conflict","reason":"disk_changed"}
            target.write_text(updated,encoding="utf-8")
            return {"status":"completed","path":path,"sha256":self.digest(updated)}

    def code_execution(self,path):
        # Compile without imports or executing arbitrary code that can read closed files.
        _,_,content=self._buffer(path)
        if Path(path).suffix!=".py": raise ValueError("Built-in validation supports Python only")
        try: compile(content,path,"exec")
        except SyntaxError as exc:
            return {"status":"failed","check":"python_syntax","line":exc.lineno,"message":exc.msg}
        return {"status":"completed","check":"python_syntax","executed_program":False}

    def definitions(self):
        return {"ide_context":[],"read_file":["path"],"edit_file":["path","old","new","expected_sha256"],"code_execution":["path"]}
