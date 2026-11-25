"""Command-line access to NORI's memory and context graph."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

try:
    from nori.shared.context.nori_context import ContextGraph
except ModuleNotFoundError:
    from shared.context.nori_context import ContextGraph


ROOT = Path(__file__).resolve().parent


def _graph(path: str | None) -> ContextGraph:
    data_root = Path(path or os.getenv("NORI_CONTEXT_ROOT", ROOT / "runtime-data" / "context-graph"))
    profile = ROOT / "shared" / "identity" / "operator-profile.json"
    return ContextGraph(data_root, profile)


def parser() -> argparse.ArgumentParser:
    cli = argparse.ArgumentParser(prog="nori-context", description="NORI memory and selective context graph")
    cli.add_argument("--root", help="context graph data directory")
    commands = cli.add_subparsers(dest="command", required=True)

    project = commands.add_parser("project")
    project.add_argument("action", choices=("add", "list"))
    project.add_argument("name", nargs="?")
    project.add_argument("--path", default="")
    project.add_argument("--status", default="active")
    project.add_argument("--description", default="")

    task = commands.add_parser("task")
    task.add_argument("action", choices=("add", "list", "update"))
    task.add_argument("name", nargs="?")
    task.add_argument("--project")
    task.add_argument("--status", default="pending")
    task.add_argument("--details", default="")

    domain = commands.add_parser("domain")
    domain.add_argument("action", choices=("add", "list"))
    domain.add_argument("name", nargs="?")
    domain.add_argument("--mode", choices=("always", "triggered"), default="triggered")
    domain.add_argument("--prompt-keyword", action="append", default=[])
    domain.add_argument("--path-keyword", action="append", default=[])

    rule = commands.add_parser("rule")
    rule.add_argument("action", choices=("add", "list"))
    rule.add_argument("--domain", default="global")
    rule.add_argument("--text")

    learn = commands.add_parser("learn")
    source = learn.add_mutually_exclusive_group(required=True)
    source.add_argument("--text")
    source.add_argument("--file", help="read a bounded UTF-8 source document into memory")
    learn.add_argument("--domain", default="global")
    learn.add_argument("--type", default="note")
    learn.add_argument("--tag", action="append", default=[])

    recall = commands.add_parser("recall")
    recall.add_argument("query")
    recall.add_argument("--limit", type=int, default=10)

    session = commands.add_parser("session")
    session.add_argument("action", choices=("start", "prompt", "end"))
    session.add_argument("session_id")
    session.add_argument("--prompt", default="Session start")
    session.add_argument("--path", action="append", default=[])

    commands.add_parser("status")
    return cli


def run(argv: list[str] | None = None) -> dict:
    args = parser().parse_args(argv)
    graph = _graph(args.root)
    if args.command == "project":
        if args.action == "add":
            if not args.name:
                raise ValueError("project name is required")
            return graph.add_project(args.name, args.path, args.status, args.description)
        return {"projects": list(graph.snapshot()["projects"].values())}
    if args.command == "task":
        if args.action == "add":
            if not args.project or not args.name:
                raise ValueError("project and task name are required")
            return graph.add_task(args.project, args.name, args.status, args.details)
        if args.action == "update":
            if not args.name:
                raise ValueError("task id is required")
            return graph.update_task(args.name, args.status)
        return {"tasks": list(graph.snapshot()["tasks"].values())}
    if args.command == "domain":
        if args.action == "add":
            if not args.name:
                raise ValueError("domain name is required")
            return graph.add_domain(args.name, mode=args.mode, prompt_keywords=args.prompt_keyword,
                                    path_keywords=args.path_keyword)
        return {"domains": graph.snapshot()["domains"]}
    if args.command == "rule":
        if args.action == "add":
            if not args.text:
                raise ValueError("rule text is required")
            return graph.add_rule(args.domain, args.text)
        snapshot = graph.snapshot()
        return {"rules": snapshot["domains"].get(args.domain, {}).get("rules", [])}
    if args.command == "learn":
        text = args.text
        tags = list(args.tag)
        if args.file:
            source = Path(args.file).resolve()
            if not source.is_file() or source.stat().st_size > 16 * 1024:
                raise ValueError("memory source file is missing or too large")
            text = source.read_text(encoding="utf-8")
            tags.extend(["source-document", "source:" + source.name])
        return graph.learn(text, domain=args.domain, kind=args.type, tags=tags)
    if args.command == "recall":
        return {"memories": graph.recall(args.query, limit=args.limit)}
    if args.command == "session":
        if args.action == "end":
            return graph.end_session(args.session_id)
        return graph.context_for_prompt(args.session_id, args.prompt, paths=args.path).as_dict()
    snapshot = graph.snapshot()
    return {"schema": snapshot["schema"], "revision": snapshot["revision"],
            "projects": len(snapshot["projects"]), "tasks": len(snapshot["tasks"]),
            "domains": len(snapshot["domains"]), "memories": len(snapshot["memories"]),
            "decisions": len(snapshot["decisions"]), "closeouts": len(snapshot["closeouts"])}


def main() -> int:
    try:
        print(json.dumps(run(), ensure_ascii=False, indent=2))
        return 0
    except (ValueError, KeyError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "error", "error": str(exc)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
