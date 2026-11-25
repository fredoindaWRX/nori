"""NORI-native Machine surface for inspecting the local Seth runtime.

The Machine exposes only typed, loopback-only Seth status and model-preflight
operations. It does not download weights or present an unverified model as
usable merely because a file exists.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import uuid4

from audit.nori_audit import record
from hardware.nori_hal import snapshot
from permissions.nori_policy import Policy
from packages.knights.machine.inference.model_hierarchy import ModelHierarchy


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class MachineWorker:
    def __init__(self, endpoint: str, policy: Policy, audit_path: Path, compute_config: dict[str, Any] | None = None):
        address = urlsplit(endpoint)
        if (address.scheme != "http" or address.hostname not in ("127.0.0.1", "::1")
                or address.username or address.password or address.path not in ("", "/")
                or address.query or address.fragment):
            raise ValueError("a literal loopback Seth service address is required")
        self.endpoint = endpoint.rstrip("/")
        self.policy = policy
        self.audit_path = Path(audit_path)
        self.opener = build_opener(ProxyHandler({}), _NoRedirect())
        self.native_provider = None
        self.compute_registry = None
        self.compute_routes = {}
        self.model_hierarchy = None
        if compute_config is not None:
            if not isinstance(compute_config, dict):
                raise ValueError("compute configuration is invalid")
            from packages.knights.machine.inference.compute_nodes import ComputeNodeRegistry
            self.compute_registry = ComputeNodeRegistry.from_config(compute_config.get("nodes"))
            routes = compute_config.get("routing")
            if not isinstance(routes, dict):
                raise ValueError("compute routes are invalid")
            self.compute_routes = routes
            self.configure_hierarchy(compute_config.get("model_hierarchy"))

    def configure_hierarchy(self, hierarchy_config: dict[str, Any] | None):
        self.model_hierarchy = ModelHierarchy.from_config(hierarchy_config) if hierarchy_config else None

    def _get(self, path: str) -> dict[str, Any]:
        if self.native_provider is not None:
            if path == '/v1/models':
                return self.native_provider.models()
            if path == '/health':
                return self.native_provider.health()
            if path == '/v1/runtime':
                return {**self.native_provider.health(), 'runtime': 'NorLlama',
                        'inspection_scope': 'authenticated_native_health',
                        'task_execution_qualified': False}
            raise ValueError('unsupported native inspection operation')
        with self.opener.open(Request(self.endpoint + path), timeout=10) as response:
            payload = json.load(response)
        if not isinstance(payload, dict):
            raise ValueError("invalid Seth response")
        return payload

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any]:
        if self.native_provider is not None:
            if path == '/v1/models/preflight':
                return self.native_provider.preflight(body['model'])
            raise ValueError('unsupported native inspection operation; no legacy fallback')
        data = json.dumps(body, separators=(",", ":")).encode("utf-8")
        request = Request(self.endpoint + path, data=data, headers={"Content-Type": "application/json"})
        with self.opener.open(request, timeout=20) as response:
            payload = json.load(response)
        if not isinstance(payload, dict):
            raise ValueError("invalid Seth response")
        return payload

    def run(self, request: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(request, dict) or set(request) - {"operation", "model", "task_type", "complexity"}:
            raise ValueError("machine request is invalid")
        operation = request.get("operation")
        routes = {"health": "/health", "models": "/v1/models", "runtime": "/v1/runtime"}
        if operation not in {*routes, "preflight", "hardware_snapshot", "compute_nodes", "route_compute", "route_inference"}:
            raise ValueError("machine operation is invalid")
        if operation == "preflight":
            if not isinstance(request.get("model"), str) or not request["model"]:
                raise ValueError("model is required for preflight")
        elif "model" in request:
            raise ValueError("model is only valid for preflight")
        if operation in {"route_compute", "route_inference"}:
            if not isinstance(request.get("task_type"), str) or not request["task_type"]:
                raise ValueError("task_type is required for compute routing")
        elif "task_type" in request:
            raise ValueError("task_type is only valid for compute routing")
        if operation == "route_inference":
            if request.get("complexity", "standard") not in {"instant", "standard", "difficult", "frontier"}:
                raise ValueError("complexity is invalid")
        elif "complexity" in request:
            raise ValueError("complexity is only valid for inference routing")
        task_id = str(uuid4())
        action = "hardware_read" if operation == "hardware_snapshot" else "model_inspect"
        decision = self.policy.decide(action)
        if not decision.allowed:
            record(self.audit_path, "machine_runtime", task_id, "denied", {"operation": operation, "reason": decision.reason})
            return {"status": "denied", "task_id": task_id, "reason": decision.reason}
        try:
            if operation == "hardware_snapshot":
                payload = snapshot()
                if (not isinstance(payload, dict) or
                        not isinstance(payload.get("profile"), dict) or
                        not isinstance(payload.get("tier"), str)):
                    raise ValueError("hardware profile is invalid")
            elif operation == "compute_nodes":
                if self.compute_registry is None:
                    raise RuntimeError("compute registry is not configured")
                payload = {"nodes": self.compute_registry.status(), "routes": self.compute_routes}
            elif operation == "route_compute":
                if self.compute_registry is None:
                    raise RuntimeError("compute registry is not configured")
                route = self.compute_routes.get(request["task_type"])
                if not isinstance(route, dict):
                    raise ValueError("compute task type is not registered")
                node = self.compute_registry.select(
                    route.get("capability"), route.get("minimum_memory_gb", 0), route.get("prefer", ())
                )
                payload = {
                    "task_type": request["task_type"],
                    "node": node.id,
                    "backend": node.backend,
                    "accelerators": list(node.accelerators),
                    "transport": node.transport,
                }
            elif operation == "route_inference":
                if self.compute_registry is None or self.model_hierarchy is None:
                    raise RuntimeError("inference hierarchy is not configured")
                model_route = self.model_hierarchy.route(request["task_type"], request.get("complexity", "standard"))
                if not model_route.available:
                    payload = {"task_type": request["task_type"], "complexity": request.get("complexity", "standard"),
                               "tier": model_route.tier, "status": "unavailable", "reason": "model_not_assigned"}
                else:
                    compute = self.compute_routes.get(model_route.compute_task)
                    if not isinstance(compute, dict):
                        raise ValueError("compute task type is not registered")
                    node = self.compute_registry.select(compute["capability"], compute.get("minimum_memory_gb", 0), compute.get("prefer", ()))
                    preferred = next((item for item in compute.get("prefer", ()) if item in node.accelerators), node.accelerators[0])
                    payload = {"task_type": request["task_type"], "complexity": request.get("complexity", "standard"),
                               "tier": model_route.tier, "model": model_route.model, "node": node.id,
                               "accelerator": preferred, "backend": node.backend, "transport": node.transport}
            elif operation == "preflight":
                model = request.get("model")
                payload = self._post("/v1/models/preflight", {"model": model})
            else:
                payload = self._get(routes[operation])
            record(self.audit_path, "machine_runtime", task_id, "completed", {"operation": operation})
            return {"status": "completed", "task_id": task_id, "result": payload}
        except Exception as error:
            record(self.audit_path, "machine_runtime", task_id, "failed", {"operation": operation, "error_type": type(error).__name__})
            raise
