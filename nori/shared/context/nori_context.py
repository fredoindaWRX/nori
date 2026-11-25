"""A Nori-native memory and context layer for every owner session.

The context graph deliberately uses a small, auditable JSON document rather
than a second external memory service.  It connects Nori's operator, projects,
tasks, rules, decisions and session observations, then returns only the slice
that matches the current prompt.  Context is fingerprinted per session so a
rule is not repeated until the configured refresh bracket is reached.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import re
from threading import RLock
import time
from typing import Any, Iterable
from uuid import uuid4


SCHEMA = "nori.context-graph.v1"
SESSION_SCHEMA = "nori.context-session.v1"
_SLUG = re.compile(r"[a-z0-9][a-z0-9._-]{0,79}")
_WORD = re.compile(r"[a-z0-9][a-z0-9._-]{1,63}")
_STATUS = frozenset({"active", "pending", "blocked", "completed", "archived"})
_RULE_SCOPE = frozenset({"always", "triggered"})


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slug(value: str, label: str = "identifier") -> str:
    if not isinstance(value, str):
        raise ValueError(f"{label} is invalid")
    raw = value.strip()
    if not raw or "/" in raw or "\\" in raw or ".." in raw or "\x00" in raw:
        raise ValueError(f"{label} is invalid")
    normalized = re.sub(r"[^a-z0-9._-]+", "-", raw.casefold()).strip("-._")
    if not _SLUG.fullmatch(normalized):
        raise ValueError(f"{label} is invalid")
    return normalized


def _text(value: Any, label: str, maximum: int = 4096) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum:
        raise ValueError(f"{label} is invalid")
    return value.strip()


def _terms(value: str) -> set[str]:
    return set(_WORD.findall(value.casefold()))


def _string_list(value: Iterable[str] | None, label: str, *, limit: int = 64) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, (list, tuple, set)):
        raise ValueError(f"{label} must be a list")
    result: list[str] = []
    for item in value:
        cleaned = _text(item, label, 160)
        if cleaned.casefold() not in {known.casefold() for known in result}:
            result.append(cleaned)
    if len(result) > limit:
        raise ValueError(f"{label} has too many entries")
    return result


@dataclass(frozen=True)
class ContextResult:
    """The bounded context selected for one prompt."""

    session_id: str
    bracket: str
    prompt_count: int
    domains: tuple[str, ...]
    injected: tuple[str, ...]
    deduped: tuple[str, ...]
    text: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "session_id": self.session_id,
            "bracket": self.bracket,
            "prompt_count": self.prompt_count,
            "domains": list(self.domains),
            "injected": list(self.injected),
            "deduped": list(self.deduped),
            "text": self.text,
        }


class ContextGraph:
    """Persistent typed context with keyword/path activation and session dedup."""

    def __init__(self, root: str | Path, operator_profile: str | Path | None = None):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.graph_path = self.root / "graph.json"
        self.sessions_root = self.root / "sessions"
        self.sessions_root.mkdir(parents=True, exist_ok=True)
        self.operator_profile = Path(operator_profile).resolve() if operator_profile else None
        self._lock = RLock()
        if not self.graph_path.exists():
            self._write_graph(self._empty_graph())
        else:
            self._validate_graph(self._read_json(self.graph_path))

    @staticmethod
    def _empty_graph() -> dict[str, Any]:
        return {
            "schema": SCHEMA,
            "revision": 0,
            "updated_at": _now(),
            "projects": {},
            "tasks": {},
            "domains": {
                "global": {
                    "name": "GLOBAL",
                    "mode": "always",
                    "prompt_keywords": [],
                    "path_keywords": [],
                    "rules": [],
                    "updated_at": _now(),
                }
            },
            "decisions": [],
            "memories": [],
            "edges": [],
            "closeouts": [],
        }

    @staticmethod
    def _read_json(path: Path) -> dict[str, Any]:
        if path.stat().st_size > 8 * 1024 * 1024:
            raise ValueError("context graph is too large")
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError("context graph is invalid")
        return value

    @staticmethod
    def _validate_graph(graph: dict[str, Any]) -> None:
        required = {"schema", "revision", "updated_at", "projects", "tasks", "domains",
                    "decisions", "memories", "edges", "closeouts"}
        if set(graph) != required or graph.get("schema") != SCHEMA:
            raise ValueError("context graph schema is invalid")
        if type(graph.get("revision")) is not int or graph["revision"] < 0:
            raise ValueError("context graph revision is invalid")
        for key in ("projects", "tasks", "domains"):
            if not isinstance(graph[key], dict):
                raise ValueError(f"context graph {key} are invalid")
        for key in ("decisions", "memories", "edges", "closeouts"):
            if not isinstance(graph[key], list):
                raise ValueError(f"context graph {key} are invalid")

    @staticmethod
    def _atomic_json(path: Path, value: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        staged = path.with_suffix(path.suffix + ".tmp")
        with staged.open("w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        for attempt in range(6):
            try:
                staged.replace(path)
                break
            except PermissionError as error:
                if getattr(error, "winerror", None) not in {5, 32, 33} or attempt == 5:
                    raise
                time.sleep(0.02 * (attempt + 1))

    def _read_graph(self) -> dict[str, Any]:
        graph = self._read_json(self.graph_path)
        self._validate_graph(graph)
        return graph

    def _write_graph(self, graph: dict[str, Any]) -> None:
        self._validate_graph(graph)
        self._atomic_json(self.graph_path, graph)

    def _mutate(self, operation) -> Any:
        with self._lock:
            graph = self._read_graph()
            result = operation(graph)
            graph["revision"] += 1
            graph["updated_at"] = _now()
            self._write_graph(graph)
            return result

    @staticmethod
    def _upsert_edge(graph: dict[str, Any], source: str, relation: str, target: str) -> None:
        edge = {"source": source, "relation": relation, "target": target}
        if edge not in graph["edges"]:
            graph["edges"].append(edge)

    def set_operator(self, profile: dict[str, Any]) -> dict[str, Any]:
        required = {"principal_id", "callsign", "display_name", "title", "owner_number"}
        if not isinstance(profile, dict) or not required <= set(profile):
            raise ValueError("operator profile is invalid")
        operator = {key: profile[key] for key in sorted(required)}
        operator["updated_at"] = _now()

        def apply(graph):
            graph["operator"] = operator  # added through migration below
            return dict(operator)

        # Older graph documents intentionally lack operator. Keep the on-disk
        # schema compact by storing it as a typed memory node instead.
        return self.learn(json.dumps(operator, ensure_ascii=False), domain="global",
                          kind="operator", tags=["operator-profile"], replace_key="operator-profile")

    def add_project(self, name: str, path: str = "", status: str = "active",
                    description: str = "") -> dict[str, Any]:
        project_id = _slug(name, "project name")
        display = _text(name, "project name", 160)
        if status not in _STATUS:
            raise ValueError("project status is invalid")
        if not isinstance(path, str) or len(path) > 1024:
            raise ValueError("project path is invalid")
        if not isinstance(description, str) or len(description) > 4096:
            raise ValueError("project description is invalid")

        def apply(graph):
            previous = graph["projects"].get(project_id, {})
            value = {"id": project_id, "name": display, "path": path.strip(), "status": status,
                     "description": description.strip(), "created_at": previous.get("created_at", _now()),
                     "updated_at": _now()}
            graph["projects"][project_id] = value
            return dict(value)
        return self._mutate(apply)

    def add_task(self, project: str, name: str, status: str = "pending",
                 details: str = "") -> dict[str, Any]:
        project_id = _slug(project, "project")
        task_id = project_id + "." + _slug(name, "task name")
        display = _text(name, "task name", 240)
        if status not in _STATUS:
            raise ValueError("task status is invalid")
        if not isinstance(details, str) or len(details) > 4096:
            raise ValueError("task details are invalid")

        def apply(graph):
            if project_id not in graph["projects"]:
                raise KeyError("project not found")
            previous = graph["tasks"].get(task_id, {})
            value = {"id": task_id, "project": project_id, "name": display, "status": status,
                     "details": details.strip(), "created_at": previous.get("created_at", _now()),
                     "updated_at": _now()}
            graph["tasks"][task_id] = value
            self._upsert_edge(graph, project_id, "has_task", task_id)
            return dict(value)
        return self._mutate(apply)

    def update_task(self, task: str, status: str) -> dict[str, Any]:
        task_id = _slug(task, "task")
        if status not in _STATUS:
            raise ValueError("task status is invalid")

        def apply(graph):
            if task_id not in graph["tasks"]:
                raise KeyError("task not found")
            graph["tasks"][task_id]["status"] = status
            graph["tasks"][task_id]["updated_at"] = _now()
            return dict(graph["tasks"][task_id])
        return self._mutate(apply)

    def add_domain(self, name: str, *, mode: str = "triggered",
                   prompt_keywords: Iterable[str] = (), path_keywords: Iterable[str] = ()) -> dict[str, Any]:
        domain_id = _slug(name, "domain name")
        if mode not in _RULE_SCOPE:
            raise ValueError("domain mode is invalid")
        prompts = _string_list(prompt_keywords, "prompt keyword")
        paths = _string_list(path_keywords, "path keyword")

        def apply(graph):
            previous = graph["domains"].get(domain_id, {})
            value = {"name": _text(name, "domain name", 120), "mode": mode,
                     "prompt_keywords": prompts, "path_keywords": paths,
                     "rules": list(previous.get("rules", [])), "updated_at": _now()}
            graph["domains"][domain_id] = value
            return dict(value)
        return self._mutate(apply)

    def add_rule(self, domain: str, text: str) -> dict[str, Any]:
        domain_id = _slug(domain, "domain")
        rule_text = _text(text, "rule", 4096)
        rule_id = "rule-" + sha256((domain_id + "\0" + rule_text).encode("utf-8")).hexdigest()[:16]

        def apply(graph):
            if domain_id not in graph["domains"]:
                raise KeyError("domain not found")
            rules = graph["domains"][domain_id]["rules"]
            existing = next((item for item in rules if item["id"] == rule_id), None)
            if existing:
                return dict(existing)
            value = {"id": rule_id, "text": rule_text, "created_at": _now()}
            rules.append(value)
            self._upsert_edge(graph, domain_id, "has_rule", rule_id)
            return dict(value)
        return self._mutate(apply)

    def log_decision(self, domain: str, decision: str, rationale: str = "") -> dict[str, Any]:
        domain_id = _slug(domain, "domain")
        text = _text(decision, "decision", 4096)
        if not isinstance(rationale, str) or len(rationale) > 4096:
            raise ValueError("rationale is invalid")
        value = {"id": "decision-" + uuid4().hex, "domain": domain_id, "decision": text,
                 "rationale": rationale.strip(), "created_at": _now()}

        def apply(graph):
            if domain_id not in graph["domains"] and domain_id not in graph["projects"]:
                raise KeyError("decision domain not found")
            graph["decisions"].append(value)
            self._upsert_edge(graph, domain_id, "has_decision", value["id"])
            return dict(value)
        return self._mutate(apply)

    def learn(self, text: str, *, domain: str = "global", kind: str = "note",
              tags: Iterable[str] = (), replace_key: str | None = None) -> dict[str, Any]:
        domain_id = _slug(domain, "domain")
        content = _text(text, "memory", 16384)
        kind_id = _slug(kind, "memory kind")
        clean_tags = _string_list(tags, "memory tag")
        if replace_key is not None:
            replace_key = _slug(replace_key, "replace key")
        value = {"id": "memory-" + uuid4().hex, "domain": domain_id, "kind": kind_id,
                 "text": content, "tags": clean_tags, "created_at": _now()}
        if replace_key:
            value["replace_key"] = replace_key

        def apply(graph):
            if replace_key:
                graph["memories"][:] = [item for item in graph["memories"]
                                          if item.get("replace_key") != replace_key]
            graph["memories"].append(value)
            self._upsert_edge(graph, domain_id, "has_memory", value["id"])
            return dict(value)
        return self._mutate(apply)

    def recall(self, query: str, *, limit: int = 10) -> list[dict[str, Any]]:
        needle = _text(query, "query", 512)
        if type(limit) is not int or not 1 <= limit <= 50:
            raise ValueError("limit is invalid")
        terms = _terms(needle)
        graph = self._read_graph()
        results = []
        for item in graph["memories"]:
            haystack = item["text"] + " " + " ".join(item.get("tags", []))
            score = len(terms & _terms(haystack))
            if score:
                results.append((score, item))
        results.sort(key=lambda pair: (-pair[0], pair[1]["created_at"]), reverse=False)
        return [dict(item, score=score) for score, item in results[:limit]]

    def snapshot(self) -> dict[str, Any]:
        return self._read_graph()

    def _operator(self, graph: dict[str, Any]) -> dict[str, Any] | None:
        memory = next((item for item in reversed(graph["memories"])
                       if item.get("replace_key") == "operator-profile"), None)
        if memory:
            try:
                value = json.loads(memory["text"])
                return value if isinstance(value, dict) else None
            except json.JSONDecodeError:
                return None
        if self.operator_profile and self.operator_profile.is_file():
            try:
                value = json.loads(self.operator_profile.read_text(encoding="utf-8"))
                return value if isinstance(value, dict) else None
            except (OSError, json.JSONDecodeError):
                return None
        return None

    def _session_path(self, session_id: str) -> Path:
        return self.sessions_root / (_slug(session_id, "session id") + ".json")

    def _read_session(self, session_id: str) -> dict[str, Any]:
        path = self._session_path(session_id)
        if not path.exists():
            return {"schema": SESSION_SCHEMA, "session_id": _slug(session_id, "session id"),
                    "prompt_count": 0, "injected": {}, "turns": [], "started_at": _now(),
                    "updated_at": _now(), "closed_at": None}
        value = self._read_json(path)
        if value.get("schema") != SESSION_SCHEMA or value.get("session_id") != path.stem:
            raise ValueError("context session is invalid")
        return value

    @staticmethod
    def _bracket(prompt_count: int) -> str:
        if prompt_count <= 3:
            return "fresh"
        if prompt_count <= 10:
            return "moderate"
        if prompt_count <= 20:
            return "depleted"
        return "critical"

    @staticmethod
    def _matches(domain: dict[str, Any], prompt: str, paths: Iterable[str]) -> bool:
        if domain["mode"] == "always":
            return True
        lowered = prompt.casefold()
        normalized_paths = [str(path).replace("\\", "/").casefold() for path in paths]
        return (any(keyword.casefold() in lowered for keyword in domain["prompt_keywords"])
                or any(keyword.casefold() in path for keyword in domain["path_keywords"]
                       for path in normalized_paths))

    @staticmethod
    def _fingerprint(kind: str, identifier: str, value: Any) -> str:
        encoded = json.dumps([kind, identifier, value], ensure_ascii=False, sort_keys=True)
        return sha256(encoded.encode("utf-8")).hexdigest()

    def context_for_prompt(self, session_id: str, prompt: str, *, paths: Iterable[str] = (),
                           max_chars: int = 12000) -> ContextResult:
        prompt = _text(prompt, "prompt", 16000)
        if type(max_chars) is not int or not 1000 <= max_chars <= 32000:
            raise ValueError("context limit is invalid")
        with self._lock:
            graph = self._read_graph()
            session = self._read_session(session_id)
            session["prompt_count"] += 1
            session["updated_at"] = _now()
            session["closed_at"] = None
            bracket = self._bracket(session["prompt_count"])
            active = [(identifier, domain) for identifier, domain in graph["domains"].items()
                      if self._matches(domain, prompt, paths)]
            items: list[tuple[str, str, Any, str]] = []
            operator = self._operator(graph)
            if operator:
                label = operator.get("callsign") or operator.get("display_name") or "Owner"
                items.append(("operator", "operator", operator, f"Operator: {label} — {operator.get('title', '')}".rstrip(" —")))
            active_projects = [item for item in graph["projects"].values() if item["status"] == "active"]
            if active_projects:
                rendered = [f"{item['id']}: {item['name']}" + (f" ({item['path']})" if item["path"] else "")
                            for item in active_projects]
                items.append(("projects", "active", rendered, "Active projects: " + "; ".join(rendered)))
            active_tasks = [item for item in graph["tasks"].values() if item["status"] in {"active", "pending", "blocked"}]
            if active_tasks:
                rendered = [f"{item['id']} [{item['status']}]: {item['name']}" for item in active_tasks[:24]]
                items.append(("tasks", "active", rendered, "Open tasks: " + "; ".join(rendered)))
            active_ids = {identifier for identifier, _ in active}
            for identifier, domain in active:
                for rule in domain["rules"]:
                    items.append(("rule", rule["id"], rule["text"],
                                  f"Rule [{domain['name']}]: {rule['text']}"))
            for decision in graph["decisions"][-100:]:
                if decision["domain"] in active_ids:
                    line = f"Decision [{decision['domain']}]: {decision['decision']}"
                    if decision.get("rationale"):
                        line += f" — {decision['rationale']}"
                    items.append(("decision", decision["id"], decision, line))
            prompt_terms = _terms(prompt)
            memories = []
            for memory in graph["memories"][-500:]:
                if memory.get("kind") == "operator" or memory["domain"] not in active_ids:
                    continue
                score = len(prompt_terms & _terms(memory["text"] + " " + " ".join(memory.get("tags", []))))
                if score:
                    memories.append((score, memory))
            memories.sort(key=lambda pair: (-pair[0], pair[1]["created_at"]))
            for _, memory in memories[:8]:
                items.append(("memory", memory["id"], memory["text"],
                              f"Memory [{memory['domain']}/{memory['kind']}]: {memory['text']}"))

            injected, deduped, lines = [], [], []
            force_refresh = bracket in {"depleted", "critical"} and session["prompt_count"] % 5 == 1
            for kind, identifier, value, line in items:
                fingerprint = self._fingerprint(kind, identifier, value)
                key = kind + ":" + identifier
                if not force_refresh and session["injected"].get(key) == fingerprint:
                    deduped.append(key)
                    continue
                candidate = line if not lines else "\n".join(lines + [line])
                if len(candidate) > max_chars:
                    break
                lines.append(line)
                injected.append(key)
                session["injected"][key] = fingerprint
            session["turns"].append({"number": session["prompt_count"], "prompt": prompt[:4000],
                                     "domains": sorted(active_ids), "timestamp": _now()})
            session["turns"] = session["turns"][-100:]
            self._atomic_json(self._session_path(session_id), session)
            text = ""
            if lines:
                text = "NORI CONTEXT GRAPH (trusted local state; apply only when relevant):\n" + "\n".join(lines)
            return ContextResult(_slug(session_id, "session id"), bracket, session["prompt_count"],
                                 tuple(sorted(active_ids)), tuple(injected), tuple(deduped), text)

    def record_turn_result(self, session_id: str, *, goal: str, result: str, status: str,
                           artifacts: Iterable[str] = ()) -> None:
        if status not in {"completed", "blocked", "failed", "cancelled", "interrupted"}:
            raise ValueError("turn status is invalid")
        with self._lock:
            session = self._read_session(session_id)
            session.setdefault("results", []).append({"goal": _text(goal, "goal", 12000)[:4000],
                "result": result.strip()[:4000] if isinstance(result, str) else "", "status": status,
                "artifacts": _string_list(list(artifacts), "artifact", limit=64), "timestamp": _now()})
            session["results"] = session["results"][-100:]
            session["updated_at"] = _now()
            self._atomic_json(self._session_path(session_id), session)

    def end_session(self, session_id: str) -> dict[str, Any]:
        """Close a session and write one reversible, deterministic closeout node."""
        with self._lock:
            session = self._read_session(session_id)
            if session.get("closed_at"):
                existing = session.get("closeout_id")
                graph = self._read_graph()
                return next((dict(item) for item in graph["closeouts"] if item["id"] == existing),
                            {"id": existing, "session_id": session["session_id"], "already_closed": True})
            completed = [item for item in session.get("results", []) if item["status"] == "completed"]
            blocked = [item for item in session.get("results", []) if item["status"] == "blocked"]
            closeout = {"id": "closeout-" + uuid4().hex, "session_id": session["session_id"],
                        "started_at": session["started_at"], "closed_at": _now(),
                        "prompt_count": session["prompt_count"], "completed": len(completed),
                        "blocked": len(blocked), "domains": sorted({domain for turn in session["turns"]
                                                                     for domain in turn.get("domains", [])}),
                        "results": session.get("results", [])[-25:]}

            def apply(graph):
                graph["closeouts"].append(closeout)
                graph["closeouts"][:] = graph["closeouts"][-1000:]
                self._upsert_edge(graph, session["session_id"], "closed_as", closeout["id"])
                return dict(closeout)
            result = self._mutate(apply)
            session["closed_at"] = closeout["closed_at"]
            session["closeout_id"] = closeout["id"]
            session["updated_at"] = _now()
            self._atomic_json(self._session_path(session_id), session)
            return result
