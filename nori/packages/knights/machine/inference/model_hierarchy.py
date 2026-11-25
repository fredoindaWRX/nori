"""Deterministic model-tier selection for NORI's local inference fabric."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


_COMPLEXITIES = {"instant", "standard", "difficult", "frontier"}


@dataclass(frozen=True)
class ModelRoute:
    tier: str
    model: str | None
    compute_task: str
    available: bool


class ModelHierarchy:
    """Choose a model class before the compute registry chooses hardware."""

    def __init__(self, tiers: dict[str, Any], task_models: dict[str, str]):
        if not isinstance(tiers, dict) or set(tiers) != {"fast", "worker", "deep", "frontier"}:
            raise ValueError("model hierarchy requires fast, worker, deep and frontier tiers")
        if not isinstance(task_models, dict) or not task_models:
            raise ValueError("worker task models are required")
        normalized = {}
        for name, value in tiers.items():
            if not isinstance(value, dict) or set(value) != {"model", "compute_task"}:
                raise ValueError("model tier is invalid")
            model, compute_task = value["model"], value["compute_task"]
            if model is not None and (not isinstance(model, str) or not model):
                raise ValueError("tier model is invalid")
            if not isinstance(compute_task, str) or not compute_task:
                raise ValueError("tier compute task is invalid")
            normalized[name] = {"model": model, "compute_task": compute_task}
        if any(not isinstance(k, str) or not k or not isinstance(v, str) or not v
               for k, v in task_models.items()):
            raise ValueError("worker task model map is invalid")
        self.tiers, self.task_models = normalized, dict(task_models)

    @classmethod
    def from_config(cls, value: dict[str, Any]) -> "ModelHierarchy":
        if not isinstance(value, dict) or set(value) != {"tiers", "worker_task_models"}:
            raise ValueError("model hierarchy configuration is invalid")
        return cls(value["tiers"], value["worker_task_models"])

    def route(self, task_type: str, complexity: str = "standard") -> ModelRoute:
        if not isinstance(task_type, str) or not task_type:
            raise ValueError("task type is required")
        if complexity not in _COMPLEXITIES:
            raise ValueError("complexity is invalid")
        tier = {"instant": "fast", "standard": "worker", "difficult": "deep", "frontier": "frontier"}[complexity]
        spec = self.tiers[tier]
        model = self.task_models.get(task_type) if tier == "worker" else spec["model"]
        if tier == "worker" and model is None:
            model = self.task_models.get("general")
        return ModelRoute(tier, model, spec["compute_task"], model is not None)

