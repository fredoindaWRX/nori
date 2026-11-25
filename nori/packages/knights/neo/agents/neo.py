"""CrewAI-compatible NORI Neo agent.

CrewAI is imported only when the caller explicitly builds its adapter.  NORI's
native Neo tools remain the authority for workspace boundaries and auditing.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import sys
from typing import Any

_PACKAGE = Path(__file__).resolve().parents[1]
_NORI = _PACKAGE.parents[2]
if str(_NORI) not in sys.path:
    sys.path.insert(0, str(_NORI))
from packages.knights.neo.tools.neo_tools import NeoTools


@dataclass
class NeoAgent:
    """NORI's first Knight: a bounded, production-code engineering agent."""

    workspace_root: Path
    audit_path: Path
    grants: tuple[str, ...] = ("workspace_read", "workspace_write", "ide_read")
    model: str = "devstral"
    ollama_base_url: str = "http://127.0.0.1:11434"

    def __post_init__(self) -> None:
        self.workspace_root = Path(self.workspace_root).resolve()
        self.audit_path = Path(self.audit_path)
        self.tools = NeoTools(self.workspace_root, self.audit_path, self.grants)

    @property
    def system_prompt(self) -> str:
        return (_PACKAGE / "prompts" / "neo.md").read_text(encoding="utf-8")

    def mcp_tools(self):
        """Return framework-neutral MCP-shaped definitions for an MCP host."""
        return self.tools.definitions()

    def build_crewai_agent(self, *, crewai_agent_class: Any | None = None, llm: Any | None = None):
        """Create the optional CrewAI adapter using the declared Devstral route.

        This does not start Ollama, download a model, or bypass NORI policy. The
        caller must explicitly provide a reachable local model service.
        """
        if crewai_agent_class is None:
            try:
                from crewai import Agent as crewai_agent_class
            except ImportError as error:
                raise RuntimeError("CrewAI is not installed; use Neo's native MCP tools or install the optional adapter.") from error
        if llm is None:
            llm = f"ollama/{self.model}"
        return crewai_agent_class(
            role="NORI Neo — Software Engineer",
            goal="Write, debug, test, and prepare production code inside the approved repository.",
            backstory=self.system_prompt,
            tools=list(self.mcp_tools()),
            llm=llm,
            allow_delegation=False,
            verbose=False,
        )


def create_neo_agent(workspace_root: Path, audit_path: Path, grants: tuple[str, ...] = ("workspace_read", "workspace_write", "ide_read")) -> NeoAgent:
    return NeoAgent(workspace_root=workspace_root, audit_path=audit_path, grants=grants)
