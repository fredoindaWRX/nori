"""Base interface for Nori development workers.
Development workers are agents used to BUILD or REPAIR Nori, 
distinct from Nori's own runtime capabilities.
"""
from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum, auto
from abc import ABC, abstractmethod
from typing import Optional, List, Dict, Any
from pathlib import Path

class DispatchMode(Enum):
    DIRECT = auto()      # Nori can automatically start/stop the worker
    HANDOFF = auto()     # Requires manual human intervention or external trigger

class WorkerHealth(Enum):
    HEALTHY = auto()
    BUSY = auto()
    DEGRADED = auto()
    UNAVAILABLE = auto()
    AUTH_REQUIRED = auto()
    QUOTA_EXHAUSTED = auto()

@dataclass
class WorkerMetadata:
    worker_id: str
    provider: str
    dispatch_mode: DispatchMode
    capabilities: List[str]
    task_types: List[str]
    local_or_remote: bool
    health: WorkerHealth = WorkerHealth.HEALTHY
    busy: bool = False
    waiting_for_auth: bool = False
    usage_exhausted: bool = False
    context_exhausted: bool = False
    last_success: Optional[float] = None
    last_failure: Optional[float] = None
    current_task: Optional[str] = None
    priority: int = 0

@dataclass
class WorkOrder:
    task_id: str
    original_goal: str
    bounded_scope: List[Path]
    allowed_files: List[Path]
    current_state: str
    next_action: str
    acceptance_criteria: str
    context_files: List[Path] = field(default_factory=list)
    timeout_seconds: int = 3600

@dataclass
class WorkResult:
    success: bool
    stdout: str
    stderr: str
    changed_files: List[Path]
    exit_code: int
    error_type: Optional[str] = None # e.g., "QUOTA_EXHAUSTED", "TIMEOUT"

class DevelopmentWorkerAdapter(ABC):
    """Abstract adapter for a development worker."""
    
    def __init__(self, metadata: WorkerMetadata):
        self.metadata = metadata

    @abstractmethod
    async def dispatch(self, order: WorkOrder) -> WorkResult:
        """Execute the work order."""
        pass

    @abstractmethod
    async def get_status(self) -> WorkerMetadata:
        """Refresh and return worker metadata."""
        pass

    @abstractmethod
    async def cancel(self, task_id: str) -> bool:
        """Attempt to cancel an ongoing task."""
        pass

class MockWorker(DevelopmentWorkerAdapter):
    """A mock worker for deterministic testing."""
    def __init__(self, worker_id, capabilities=None, priority=0, health=WorkerHealth.HEALTHY):
        metadata = WorkerMetadata(
            worker_id=worker_id,
            provider="mock",
            dispatch_mode=DispatchMode.DIRECT,
            capabilities=capabilities or ["coding"],
            task_types=["implementation"],
            local_or_remote=True,
            health=health,
            priority=priority
        )
        super().__init__(metadata)
        self._dispatch_result = None

    async def dispatch(self, order: WorkOrder) -> WorkResult:
        if self._dispatch_result:
            return self._dispatch_result
        return WorkResult(True, "Success", "", [], 0)

    async def get_status(self) -> WorkerMetadata:
        return self.metadata

    async def cancel(self, task_id: str) -> bool:
        return True

