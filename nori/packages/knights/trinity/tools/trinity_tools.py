"""Trinity tool adapters using existing NORI file, executor and web workers."""
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote_plus
import sys

ROOT = Path(__file__).resolve().parents[4]
if str(ROOT / "shared") not in sys.path:
    sys.path.insert(0, str(ROOT / "shared"))
from packages.knights.neo.tools.neo_tools import NeoTools, _safe_relative
from orchestration.smith_worker import SmithWorker
from orchestration.apoc_worker import ApocWorker
from permissions.nori_policy import Policy

@dataclass(frozen=True)
class ToolDefinition:
    name: str
    description: str
    parameters: dict
    handler: object

    def ollama(self):
        return {"type":"function", "function":{"name":self.name,
            "description":self.description, "parameters":self.parameters}}

class TrinityTools:
    def __init__(self, workspace_root, audit_path, grants, search_provider=None, python_runner=None):
        self.files=NeoTools(Path(workspace_root),Path(audit_path),grants)
        policy=Policy(grants)
        self.executor=SmithWorker(Path(workspace_root),policy,Path(audit_path), python_runner=python_runner)
        self.browser=ApocWorker(policy,Path(audit_path))
        self.search_provider=search_provider
        self.policy=policy

    def read_file(self, path):
        return self.files.read_file(path=path)

    def write_file(self, path, content, approved):
        return self.files.write_file(path=path,content=content,approved=approved)

    def code_execution(self, path, arguments=None, timeout_seconds=30):
        return self.executor.run({"operation":"run_python", "path":_safe_relative(path),
            "arguments":arguments or [], "timeout_seconds":timeout_seconds})

    def inspect_page(self, url):
        return self.browser.run({"operation":"inspect", "url":url})

    def web_search(self, query):
        if not isinstance(query,str) or not query.strip() or len(query)>500:
            raise ValueError("Search requires 1 to 500 characters")
        if not self.policy.decide("browser_read").allowed:
            return {"status":"denied", "reason":"browser_read_required"}
        if self.search_provider:
            return self.search_provider(query)
        # Basic public HTML search. Provider challenges/errors remain visible to caller.
        url="https://html.duckduckgo.com/html/?q=" + quote_plus(query)
        result=self.inspect_page(url)
        return {**result, "query":query, "search_url":url}

    def definitions(self):
        def schema(props,required):
            return {"type":"object","properties":props,"required":required,"additionalProperties":False}
        string={"type":"string"}
        return (
            ToolDefinition("read_file","Read a workspace text file",schema({"path":string},["path"]),self.read_file),
            ToolDefinition("write_file","Write a workspace file; approved reflects host authorization",schema({"path":string,"content":string,"approved":{"type":"boolean"}},["path","content","approved"]),self.write_file),
            ToolDefinition("code_execution","Execute an existing workspace Python script",schema({"path":string,"arguments":{"type":"array","items":string},"timeout_seconds":{"type":"integer","minimum":1,"maximum":60}},["path"]),self.code_execution),
            ToolDefinition("web_search","Quick public web search; not deep research",schema({"query":string},["query"]),self.web_search),
            ToolDefinition("inspect_page","Read public page text; no login or interactive browsing",schema({"url":string},["url"]),self.inspect_page),
        )
