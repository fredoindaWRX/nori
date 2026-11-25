"""Operational command surface for the NORI v2 control plane."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys

try:
    from nori.shared.control_plane.v2 import (
        ActionIntent, CapabilityRegistry, GuardrailEngine, ProjectIncubator, SourceCatalog,
    )
    from nori.shared.context.source_retrieval import SourceRetriever
except ModuleNotFoundError:
    from shared.control_plane.v2 import (
        ActionIntent, CapabilityRegistry, GuardrailEngine, ProjectIncubator, SourceCatalog,
    )
    from shared.context.source_retrieval import SourceRetriever


ROOT = Path(__file__).resolve().parent


def _roots(override: str | None):
    root = Path(override or os.getenv("NORI_V2_ROOT", ROOT / "runtime-data" / "v2")).resolve()
    return root, CapabilityRegistry(root / "capabilities.json"), SourceCatalog(root / "sources")


def parser() -> argparse.ArgumentParser:
    cli = argparse.ArgumentParser(prog="nori-v2", description="NORI v2 control plane")
    cli.add_argument("--root", help="v2 runtime data directory")
    commands = cli.add_subparsers(dest="command", required=True)

    capability = commands.add_parser("capability")
    capability.add_argument("action", choices=("register", "approve", "disable", "list", "route"))
    capability.add_argument("name", nargs="?")
    capability.add_argument("--primitive", choices=("knowledge", "skill", "connector", "worker"))
    capability.add_argument("--description")
    capability.add_argument("--trigger", action="append", default=[])
    capability.add_argument("--permission", action="append", default=[])
    capability.add_argument("--risk", choices=("low", "moderate", "high", "critical"), default="low")
    capability.add_argument("--external", action="store_true")
    capability.add_argument("--cost-model", default="local")
    capability.add_argument("--status", choices=("candidate", "approved", "disabled"), default="candidate")
    capability.add_argument("--include-candidates", action="store_true")

    source = commands.add_parser("source")
    source.add_argument("action", choices=("ingest", "list", "verify", "reject", "search"))
    source.add_argument("path", nargs="?")
    source.add_argument("--id")
    source.add_argument("--title")
    source.add_argument("--topic", action="append", default=[])
    source.add_argument("--provenance", default="owner-supplied")
    source.add_argument("--query")
    source.add_argument("--related-terms", help="JSON file mapping query terms to related terms")
    source.add_argument("--limit", type=int, default=10)

    project = commands.add_parser("project")
    project.add_argument("action", choices=("types", "create"))
    project.add_argument("--name")
    project.add_argument("--type", choices=tuple(ProjectIncubator.types()))
    project.add_argument("--answers", help="JSON file containing section answers")

    guard = commands.add_parser("guard")
    guard.add_argument("action")
    guard.add_argument("--target", default="")
    guard.add_argument("--outward-facing", action="store_true")
    guard.add_argument("--destructive", action="store_true")
    guard.add_argument("--financial", action="store_true")
    guard.add_argument("--changes-permissions", action="store_true")
    guard.add_argument("--handles-credentials", action="store_true")
    guard.add_argument("--transmits-sensitive-data", action="store_true")
    guard.add_argument("--source-trust", choices=("owner", "system", "verified", "untrusted"), default="owner")
    guard.add_argument("--estimated-cost", type=float, default=0.0)

    commands.add_parser("status")
    return cli


def run(argv: list[str] | None = None) -> dict:
    args = parser().parse_args(argv)
    root, registry, sources = _roots(args.root)
    if args.command == "capability":
        if args.action == "register":
            if not args.name or not args.primitive or not args.description:
                raise ValueError("name, primitive, and description are required")
            return registry.register(args.name, args.primitive, args.description,
                triggers=args.trigger, permissions=args.permission, risk=args.risk,
                external=args.external, cost_model=args.cost_model, status=args.status)
        if args.action in {"approve", "disable"}:
            if not args.name:
                raise ValueError("capability name is required")
            return registry.set_status(args.name, "approved" if args.action == "approve" else "disabled")
        if args.action == "route":
            if not args.name:
                raise ValueError("route prompt is required")
            return {"matches": registry.route(args.name, primitive=args.primitive,
                                               include_candidates=args.include_candidates)}
        return registry.snapshot()
    if args.command == "source":
        if args.action == "ingest":
            if not args.path or not args.title:
                raise ValueError("source path and title are required")
            return sources.ingest(args.path, title=args.title, topics=args.topic,
                                  provenance=args.provenance)
        if args.action in {"verify", "reject"}:
            if not args.id:
                raise ValueError("source id is required")
            return sources.set_verification(args.id, "verified" if args.action == "verify" else "rejected")
        if args.action == "search":
            if not args.query:
                raise ValueError("source search query is required")
            related = (json.loads(Path(args.related_terms).read_text(encoding="utf-8"))
                       if args.related_terms else None)
            return {"query": args.query,
                    "results": SourceRetriever(root / "sources").search(
                        args.query, related_terms=related, limit=args.limit)}
        return sources.snapshot()
    if args.command == "project":
        incubator = ProjectIncubator()
        if args.action == "types":
            return {"types": incubator.types()}
        if not args.name or not args.type or not args.answers:
            raise ValueError("project name, type, and answers file are required")
        answers = json.loads(Path(args.answers).read_text(encoding="utf-8"))
        brief = incubator.create(args.name, args.type, answers)
        if brief["quality_gate"]["ready"]:
            brief["phases"] = incubator.phases(brief)
        return brief
    if args.command == "guard":
        decision = GuardrailEngine().evaluate(ActionIntent(
            args.action, target=args.target, outward_facing=args.outward_facing,
            destructive=args.destructive, financial=args.financial,
            changes_permissions=args.changes_permissions, handles_credentials=args.handles_credentials,
            transmits_sensitive_data=args.transmits_sensitive_data,
            source_trust=args.source_trust, estimated_cost=args.estimated_cost))
        return {"outcome": decision.outcome, "reasons": list(decision.reasons),
                "requires_owner_confirmation": decision.requires_owner_confirmation}
    capabilities = registry.snapshot()
    source_data = sources.snapshot()
    return {"schema": "nori.v2-status.v1", "root": str(root),
            "capabilities": {status: sum(item["status"] == status for item in capabilities["capabilities"].values())
                             for status in ("approved", "candidate", "disabled")},
            "sources": {state: sum(item["verification"] == state for item in source_data["sources"].values())
                        for state in ("unverified", "partially_verified", "verified", "rejected")}}


def main() -> int:
    try:
        print(json.dumps(run(), ensure_ascii=False, indent=2))
        return 0
    except (ValueError, KeyError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"status": "error", "error": str(exc)}), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
