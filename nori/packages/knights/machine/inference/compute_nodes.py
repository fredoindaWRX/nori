"""Validated compute-node inventory and deterministic workload placement.

The registry is deliberately vendor neutral.  CUDA, ROCm, NPU and CPU are
capabilities of a node, not assumptions baked into NORI's task layer.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable
from urllib.parse import urlsplit


_BACKENDS = {"ollama", "nori-model-service"}
_ACCELERATORS = {"cuda", "rocm", "npu", "cpu"}
_TRANSPORTS = {"loopback", "private_pairing"}


def _valid_endpoint(endpoint: str, transport: str) -> bool:
    try:
        address = urlsplit(endpoint)
    except (TypeError, ValueError):
        return False
    if (address.scheme != "http" or address.username or address.password or
            address.path not in ("", "/") or address.query or address.fragment):
        return False
    if transport == "loopback":
        return address.hostname in {"127.0.0.1", "::1"}
    # Private Pairing names are provisioned by NORI.  Raw Internet hosts and
    # literal IP addresses do not become trusted merely by entering a URL.
    return bool(address.hostname and (
        address.hostname.endswith(".nori-paired") or address.hostname.endswith(".ts.net")
    ))


@dataclass(frozen=True)
class ComputeNode:
    id: str
    endpoint: str
    backend: str
    accelerators: tuple[str, ...]
    memory_gb: float
    capabilities: tuple[str, ...]
    priority: int
    enabled: bool
    healthy: bool
    transport: str
    transport_verified: bool

    @classmethod
    def from_mapping(cls, value: dict[str, Any]) -> "ComputeNode":
        if not isinstance(value, dict):
            raise ValueError("compute node must be an object")
        allowed = {
            "id", "endpoint", "backend", "accelerators", "memory_gb",
            "capabilities", "priority", "enabled", "healthy", "transport",
            "transport_verified",
        }
        if set(value) - allowed:
            raise ValueError("compute node contains unknown fields")
        node_id = value.get("id")
        endpoint = value.get("endpoint")
        backend = value.get("backend")
        accelerators = value.get("accelerators")
        memory_gb = value.get("memory_gb")
        capabilities = value.get("capabilities")
        priority = value.get("priority", 0)
        enabled = value.get("enabled", False)
        healthy = value.get("healthy", False)
        transport = value.get("transport")
        verified = value.get("transport_verified", False)
        if not isinstance(node_id, str) or not node_id or len(node_id) > 64:
            raise ValueError("compute node id is invalid")
        if backend not in _BACKENDS:
            raise ValueError("compute backend is unsupported")
        if transport not in _TRANSPORTS or not _valid_endpoint(endpoint, transport):
            raise ValueError("compute endpoint or transport is invalid")
        if (not isinstance(accelerators, list) or not accelerators or
                any(item not in _ACCELERATORS for item in accelerators)):
            raise ValueError("compute accelerators are invalid")
        if (not isinstance(capabilities, list) or not capabilities or
                any(not isinstance(item, str) or not item for item in capabilities)):
            raise ValueError("compute capabilities are invalid")
        if isinstance(memory_gb, bool) or not isinstance(memory_gb, (int, float)) or memory_gb <= 0:
            raise ValueError("compute memory must be positive")
        if type(priority) is not int or not -1000 <= priority <= 1000:
            raise ValueError("compute priority is invalid")
        if any(type(item) is not bool for item in (enabled, healthy, verified)):
            raise ValueError("compute state flags must be booleans")
        if enabled and (not healthy or not verified):
            raise ValueError("enabled compute nodes must be healthy and transport verified")
        return cls(
            node_id, endpoint.rstrip("/"), backend, tuple(dict.fromkeys(accelerators)),
            float(memory_gb), tuple(dict.fromkeys(capabilities)), priority,
            enabled, healthy, transport, verified,
        )


class ComputeNodeRegistry:
    """Select the smallest suitable node, then use priority as a tie breaker."""

    def __init__(self, nodes: Iterable[ComputeNode]):
        self.nodes = tuple(nodes)
        if not self.nodes:
            raise ValueError("at least one compute node is required")
        if len({node.id for node in self.nodes}) != len(self.nodes):
            raise ValueError("compute node ids must be unique")

    @classmethod
    def from_config(cls, values: list[dict[str, Any]]) -> "ComputeNodeRegistry":
        if not isinstance(values, list):
            raise ValueError("compute nodes must be a list")
        return cls(ComputeNode.from_mapping(value) for value in values)

    def select(self, capability: str, minimum_memory_gb: float = 0,
               preferred_accelerators: Iterable[str] = ()) -> ComputeNode:
        if not isinstance(capability, str) or not capability:
            raise ValueError("compute capability is required")
        if (isinstance(minimum_memory_gb, bool) or
                not isinstance(minimum_memory_gb, (int, float)) or minimum_memory_gb < 0):
            raise ValueError("minimum memory is invalid")
        preferred = tuple(preferred_accelerators)
        if any(item not in _ACCELERATORS for item in preferred):
            raise ValueError("preferred accelerator is invalid")
        eligible = [
            node for node in self.nodes
            if node.enabled and node.healthy and node.transport_verified
            and capability in node.capabilities and node.memory_gb >= minimum_memory_gb
        ]
        if not eligible:
            raise LookupError(f"no verified compute node can run {capability}")

        def accelerator_rank(node: ComputeNode) -> int:
            matches = [preferred.index(item) for item in node.accelerators if item in preferred]
            return min(matches) if matches else len(preferred)

        return min(
            eligible,
            key=lambda node: (accelerator_rank(node), node.memory_gb, -node.priority, node.id),
        )

    def status(self) -> list[dict[str, Any]]:
        return [
            {
                "id": node.id,
                "backend": node.backend,
                "accelerators": list(node.accelerators),
                "memory_gb": node.memory_gb,
                "capabilities": list(node.capabilities),
                "enabled": node.enabled,
                "healthy": node.healthy,
                "transport": node.transport,
                "transport_verified": node.transport_verified,
            }
            for node in self.nodes
        ]
