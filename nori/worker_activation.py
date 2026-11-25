"""Task-scoped model activation for the shared NORI Council process.

Workers are lightweight adapters inside one process.  Activation therefore
controls which specialist may consume model inference for a task; deterministic
tool and policy services remain available without warming a model.
"""
from __future__ import annotations

from threading import RLock


INFRASTRUCTURE = frozenset({"sentinel", "architect", "machine"})


class WorkerActivationRegistry:
    def __init__(self, registered):
        workers = frozenset(str(name) for name in registered)
        if not workers or not INFRASTRUCTURE <= workers:
            raise ValueError("Registered workers must include NORI infrastructure")
        self._registered = workers
        self._tasks: dict[str, frozenset[str]] = {}
        self._lock = RLock()

    def reconcile(self, task_id: str, task_graph) -> dict:
        if not isinstance(task_id, str) or not task_id:
            raise ValueError("Task identity is required")
        if not isinstance(task_graph, list):
            raise ValueError("Task graph must be a list")
        requested = frozenset(node.get("worker") for node in task_graph)
        if None in requested or not requested <= self._registered:
            raise ValueError("Task graph references an unregistered worker")
        # Infrastructure is always resident and is not counted as an activated
        # specialist.  It can plan, authenticate, and route without occupying a
        # task-specific model slot.
        specialists = requested - INFRASTRUCTURE
        with self._lock:
            previous = self._tasks.get(task_id, frozenset())
            self._tasks[task_id] = specialists
        return {
            "task_id": task_id,
            "active_workers": sorted(specialists),
            "activated": sorted(specialists - previous),
            "released": sorted(previous - specialists),
        }

    def ensure_model_active(self, task_id: str, worker: str) -> None:
        if worker in INFRASTRUCTURE:
            return
        with self._lock:
            active = self._tasks.get(task_id, frozenset())
        if worker not in active:
            raise PermissionError(f"Worker {worker} is not active for task {task_id}")

    def release(self, task_id: str) -> dict:
        with self._lock:
            released = self._tasks.pop(task_id, frozenset())
        return {"task_id": task_id, "released": sorted(released), "active_workers": []}

    def snapshot(self) -> dict:
        with self._lock:
            # Runtime status is owner-facing and shared across concurrent work
            # sessions.  Task identifiers are internal correlation data: they
            # are unnecessary for health reporting and disclose which private
            # sessions currently own each specialist.  Publish only aggregate
            # activation data; detailed task membership remains inside this
            # registry and the Sentinel audit trail.
            task_count = len(self._tasks)
            workers = {worker for active in self._tasks.values() for worker in active}
        return {
            "active_task_count": task_count,
            "active_worker_count": len(workers),
            "active_workers": sorted(workers),
        }
