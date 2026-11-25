"""Routing and selection logic for Nori development workers."""
from __future__ import annotations

import asyncio
import logging
from typing import List, Optional, Dict
from pathlib import Path

from .base import (
    DevelopmentWorkerAdapter, 
    WorkerMetadata, 
    WorkerHealth, 
    DispatchMode, 
    WorkOrder, 
    WorkResult
)

logger = logging.getLogger("nori.worker_router")

class DevelopmentWorkerRouter:
    """Selects the most suitable development worker based on capability, health, and availability."""

    def __init__(self):
        self._adapters: Dict[str, DevelopmentWorkerAdapter] = {}
        self._priority_list: List[str] = []

    def register_worker(self, adapter: DevelopmentWorkerAdapter, priority: int = 0):
        """Registers a worker adapter. Higher priority values are preferred."""
        self._adapters[adapter.metadata.worker_id] = adapter
        # Maintain a sorted list of worker IDs based on priority
        self._priority_list = sorted(
            self._adapters.keys(), 
            key=lambda wid: self._adapters[wid].metadata.priority, 
            reverse=True
        )
        logger.info(f"Registered development worker: {adapter.metadata.worker_id} (priority={priority})")

    async def get_best_worker(self, required_capabilities: List[str], *, excluded_worker_ids=()) -> Optional[DevelopmentWorkerAdapter]:
        """
        Selects the best available worker.
        Selection Order:
        1. Priority-sorted healthy workers with required capabilities.
        2. Local fallbacks (Aider/Local Qwen) if preferred workers are exhausted/unavailable.
        """
        for worker_id in self._priority_list:
            if worker_id in excluded_worker_ids:
                continue
            adapter = self._adapters[worker_id]
            meta = await adapter.get_status()
            
            if not self._is_worker_available(meta, required_capabilities):
                continue
                
            return adapter
        
        return None

    def _is_worker_available(self, meta: WorkerMetadata, required_capabilities: List[str]) -> bool:
        """Checks if a worker is fit for the current request."""
        # Check capabilities
        if not all(cap in meta.capabilities for cap in required_capabilities):
            return False
        
        # Check health
        if meta.health in {WorkerHealth.UNAVAILABLE, WorkerHealth.QUOTA_EXHAUSTED,
                           WorkerHealth.AUTH_REQUIRED, WorkerHealth.BUSY}:
            return False
        if meta.waiting_for_auth or meta.usage_exhausted or meta.context_exhausted:
            return False
        
        # Check workload
        if meta.busy:
            # We might allow multiple tasks for some workers, but for coding, 
            # we generally want one bounded set of files per worker.
            return False
            
        return True

    async def dispatch_with_failover(self, order: WorkOrder) -> WorkResult:
        """
        Attempts to execute a work order, failing over to other workers 
        if the primary choice fails due to infrastructure/quota issues.
        """
        # Determine capabilities needed based on the order (simplification: use a general 'coding' capability)
        required = ["coding"] 
        
        attempted_workers = []
        
        while True:
            worker = await self.get_best_worker(required, excluded_worker_ids=attempted_workers)
            if not worker:
                return WorkResult(
                    success=False, 
                    stdout="", 
                    stderr="No available development workers found.", 
                    changed_files=[], 
                    exit_code=-1, 
                    error_type="NO_WORKER_AVAILABLE"
                )
            
            if worker.metadata.worker_id in attempted_workers:
                # We've tried everyone available and healthy
                break
                
            attempted_workers.append(worker.metadata.worker_id)
            
            try:
                result = await worker.dispatch(order)
                
                # Failover on specific error types
                if result.error_type in {"QUOTA_EXHAUSTED", "TIMEOUT", "CONTEXT_EXHAUSTED", "AUTH_REQUIRED"}:
                    logger.warning(f"Worker {worker.metadata.worker_id} failed with {result.error_type}. Failing over...")
                    # Update health to prevent immediate re-selection in the next loop iteration
                    if result.error_type == "QUOTA_EXHAUSTED":
                        worker.metadata.health = WorkerHealth.QUOTA_EXHAUSTED
                    elif result.error_type == "TIMEOUT":
                        worker.metadata.health = WorkerHealth.UNAVAILABLE
                    elif result.error_type == "AUTH_REQUIRED":
                        worker.metadata.health = WorkerHealth.AUTH_REQUIRED
                    continue
                
                return result
                
            except Exception as e:
                logger.exception(f"Critical failure in worker {worker.metadata.worker_id}: {e}")
                # Mark as degraded/unavailable locally for this session
                worker.metadata.health = WorkerHealth.UNAVAILABLE
                continue

        return WorkResult(
            success=False, 
            stdout="", 
            stderr="All compatible workers exhausted or failed.", 
            changed_files=[], 
            exit_code=-1, 
            error_type="ALL_WORKERS_FAILED"
        )

    def registered_workers(self) -> List[str]:
        """Return deterministic worker order for status and audit surfaces."""
        return list(self._priority_list)
