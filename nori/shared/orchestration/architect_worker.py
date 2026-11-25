"""NORI-native Architect for edition-aware Council task graphs."""
from __future__ import annotations

import json
from typing import Any, Callable
from uuid import uuid4

from audit.nori_audit import record


class ArchitectWorker:
    """Validate and execute bounded typed graphs through the Knight dispatcher."""

    # These operations complete with a domain-specific status. Queuing an event
    # completes publication only; it does not assert that a consumer handled it.
    _SUCCESS_STATUSES = {
        ("knowledge", "index"): "indexed",
        ("events", "publish"): "queued",
        ("learning", "status"): "ready",
    }

    def __init__(self, policy, audit_path, dispatcher: Callable[[dict], dict]):
        self.policy = policy
        self.audit_path = audit_path
        self.dispatcher = dispatcher

    @staticmethod
    def _validate(request: dict[str, Any]) -> tuple[list[dict], list[str]]:
        if not isinstance(request, dict) or set(request) != {"operation", "nodes"}:
            raise ValueError("invalid_architect_request")
        if request["operation"] != "run_graph":
            raise ValueError("unsupported_architect_operation")
        nodes = request["nodes"]
        if not isinstance(nodes, list) or not 1 <= len(nodes) <= 64:
            raise ValueError("invalid_architect_nodes")
        ids: list[str] = []
        for node in nodes:
            if not isinstance(node, dict) or set(node) != {
                "id", "capability", "request", "depends_on"
            }:
                raise ValueError("invalid_architect_node")
            if (not isinstance(node["id"], str) or not node["id"].strip() or
                    node["id"] in ids):
                raise ValueError("invalid_architect_node_id")
            if (not isinstance(node["capability"], str) or
                    node["capability"] == "orchestration" or
                    not isinstance(node["request"], dict) or
                    not isinstance(node["depends_on"], list) or
                    any(not isinstance(dep, str) for dep in node["depends_on"])):
                raise ValueError("invalid_architect_node")
            ids.append(node["id"])
        if any(dep not in ids for node in nodes for dep in node["depends_on"]):
            raise ValueError("unknown_architect_dependency")
        order: list[str] = []
        pending = list(nodes)
        while pending:
            ready = [node for node in pending
                     if all(dep in order for dep in node["depends_on"])]
            if not ready:
                raise ValueError("cyclic_architect_dependencies")
            for node in ready:
                order.append(node["id"])
                pending.remove(node)
        return nodes, order

    @classmethod
    def _succeeded(cls, node: dict, result: dict) -> bool:
        status = result.get("status")
        if status == "completed":
            return True
        operation = node["request"].get("operation")
        if not isinstance(operation, str):
            return False
        expected = cls._SUCCESS_STATUSES.get((node["capability"], operation))
        return expected is not None and status == expected

    @staticmethod
    def _dispatch_result(dispatched: Any) -> dict:
        """Keep worker evidence while rejecting malformed dispatch results."""
        try:
            json.dumps(dispatched, allow_nan=False)
        except (TypeError, ValueError, RecursionError, OverflowError):
            # Do not retain or stringify an object that would break the gateway.
            return {"status": "failed", "reason": "invalid_dispatch_serialization"}
        if not isinstance(dispatched, dict):
            return {"status": "failed", "reason": "invalid_dispatch_result",
                    "output": dispatched}
        output = dispatched.get("result")
        result = {"status": "failed", "output": output}
        for field in ("knight", "dispatch_id"):
            value = dispatched.get(field)
            if not isinstance(value, str) or not value.strip():
                result["reason"] = "invalid_dispatch_result"
                return result
            result[field] = value
        if (not isinstance(output, dict) or
                not isinstance(output.get("status"), str) or
                not output["status"].strip()):
            result["reason"] = "invalid_dispatch_result"
            return result
        # Unknown or non-success statuses remain visible and block dependents.
        result["status"] = output["status"]
        return result

    def run(self, request: dict[str, Any]) -> dict[str, Any]:
        nodes, order = self._validate(request)
        decision = self.policy.decide("plan")
        if not decision.allowed:
            return {"schema": "nori.architect-graph.v1", "status": "denied",
                    "reason": decision.reason, "results": {}}
        graph_id = str(uuid4())
        lookup = {node["id"]: node for node in nodes}
        results: dict[str, dict] = {}
        record(self.audit_path, "architect_graph", graph_id, "started",
               {"order": order})
        for node_id in order:
            node = lookup[node_id]
            blocked = [dep for dep in node["depends_on"]
                       if not self._succeeded(lookup[dep], results[dep])]
            if blocked:
                result = {"status": "blocked", "dependencies": blocked}
            else:
                try:
                    dispatched = self.dispatcher({
                        "capability": node["capability"],
                        "request": node["request"],
                    })
                    result = self._dispatch_result(dispatched)
                except Exception as error:
                    result = {"status": "failed",
                              "error_type": type(error).__name__}
            results[node_id] = result
            record(self.audit_path, "architect_graph_node", graph_id,
                   result["status"], {"node": node_id})
        status = ("completed" if all(self._succeeded(lookup[node_id], value)
                                    for node_id, value in results.items())
                  else "incomplete")
        record(self.audit_path, "architect_graph", graph_id, status)
        return {"schema": "nori.architect-graph.v1", "graph_id": graph_id,
                "status": status, "order": order, "results": results}
