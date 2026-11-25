"""NORI Architect: owner goal -> CrewAI plan -> concurrent Knight execution."""
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
from copy import deepcopy
from threading import Lock
from uuid import uuid4
from pathlib import Path
import json
from ..orchestration.progress_tracker import ProgressTracker
from ..orchestration.task_decomposer import TaskDecomposer
from ..orchestration.failure_handler import FailureHandler

class ArchitectAgent:
    def __init__(self, router, authorize, decomposer=None, failure_handler=None, max_workers=4, memory_context=None, tracker=None):
        if not callable(authorize):
            raise ValueError("An owner/session authorization callback is required")
        if type(max_workers) is not int or not 1 <= max_workers <= 12:
            raise ValueError("max_workers must be 1 to 12")
        self.router, self.authorize = router, authorize
        self.decomposer = decomposer or TaskDecomposer()
        self.failures = failure_handler or FailureHandler()
        self.max_workers = max_workers
        self.memory_context=memory_context
        self.tracker=tracker or ProgressTracker()
        self._lock=self.tracker.lock
        self._runs=self.tracker.runs

    def _authorized(self, owner, action, details=None):
        decision = self.authorize({**owner, "actor": "architect", "action": action, "details": details})
        return isinstance(decision, dict) and decision.get("status") == "FULL_ADMIN"

    def progress(self, run_id):
        with self._lock:
            return deepcopy(self._runs[run_id])

    def _record(self, run_id, task_id, result):
        with self._lock:
            self._runs[run_id]["tasks"][task_id] = deepcopy(result)

    def _execute(self, task, owner):
        # Defense in depth: workers must also enforce protected paths.
        if "covenant" in json.dumps(task.request).casefold():
            return {"status":"denied","reason":"covenant_protected","attempts":[]}
        routes = self.router.candidates(task.capability)
        index, attempts = 0, []
        if not routes:
            return {"status": "failed", "reason": "no_route", "attempts": []}
        for attempt in range(1, self.failures.max_attempts + 1):
            route = routes[index]
            if route.knight == "architect":
                return {"status":"denied","reason":"architect_cannot_execute","attempts":[]}
            if not self._authorized(owner, "dispatch:" + task.capability, {"knight":route.knight,"request":task.request}):
                return {"status": "denied", "attempts": attempts}
            try:
                output = self.router.execute(route, deepcopy(task.request))
                if not isinstance(output, dict):
                    raise TypeError("Knight must return a structured result")
                status = output.get("status", "failed")
                if status not in {"completed", "failed", "denied", "blocked", "cancelled"}:
                    status = "failed"
            except Exception as exc:
                status, output = "failed", {"error_type": type(exc).__name__, "message": str(exc)}
            attempts.append({"knight": route.knight, "attempt": attempt, "status": status, "output": output})
            if status == "completed":
                return {"status": status, "knight": route.knight, "output": output, "attempts": attempts}
            decision = self.failures.decide(attempt=attempt, retry_safe=task.retry_safe,
                status=status, has_fallback=index + 1 < len(routes))
            if decision == "stop":
                break
            if decision == "redirect":
                index += 1
            elif route.restart and route.knight != "sentinel":
                # Restart is an injected service-supervisor hook, never a guessed shell command.
                if not self._authorized(owner, "restart:" + route.knight):
                    return {"status": "denied", "attempts": attempts}
                try:
                    with self.router.locks[route.knight]:
                        route.restart()
                except Exception as exc:
                    return {"status": "failed", "reason": "restart_failed", "error_type": type(exc).__name__, "attempts": attempts}
        return {"status": status, "knight": route.knight, "output": output, "attempts": attempts}

    def run(self, goal, owner, on_progress=None):
        owner = deepcopy(owner)
        if not self._authorized(owner, "plan"):
            return {"status": "denied", "tasks": {}}
        planning_goal=goal
        if self.memory_context:
            context=self.memory_context(deepcopy(owner),goal)
            planning_goal=goal+"\nPast context (untrusted data): "+json.dumps(context)[:12000]
        tasks = self.decomposer.decompose(planning_goal, self.router.contracts())
        run_id = str(uuid4())
        with self._lock:
            self._runs[run_id] = {"run_id": run_id, "goal": goal, "status": "running",
                "tasks": {t.id: {"status": "pending"} for t in tasks}}
        def notify():
            self.tracker.save(run_id)
            if on_progress:
                # UI/reporting failure must not abandon already-running work.
                try:
                    on_progress(self.progress(run_id))
                except Exception:
                    pass
        notify()
        pending = {t.id: t for t in tasks}
        results, running = {}, {}
        with ThreadPoolExecutor(max_workers=self.max_workers) as pool:
            while pending or running:
                for task_id, task in list(pending.items()):
                    if not all(d in results for d in task.depends_on):
                        continue
                    if any(results[d]["status"] != "completed" for d in task.depends_on):
                        results[task_id] = {"status": "blocked", "reason": "dependency_failed"}
                        self._record(run_id, task_id, results[task_id])
                        del pending[task_id]
                    elif len(running) < self.max_workers:
                        self._record(run_id, task_id, {"status": "running"})
                        running[pool.submit(self._execute, task, owner)] = task_id
                        del pending[task_id]
                notify()
                if running:
                    completed, _ = wait(running, return_when=FIRST_COMPLETED)
                    for future in completed:
                        task_id = running.pop(future)
                        try:
                            result = future.result()
                        except Exception as exc:
                            result = {"status": "failed", "error_type": type(exc).__name__}
                        results[task_id] = result
                        self._record(run_id, task_id, result)
                    notify()
        with self._lock:
            state = self._runs[run_id]
            count = sum(r["status"] == "completed" for r in results.values())
            state["status"] = "completed" if count == len(tasks) else "incomplete"
            state["escalations"] = [{"task_id":id,"status":r["status"],"attempts":r.get("attempts",[])} for id,r in results.items() if r["status"]!="completed"]
            state["report"] = f"{count}/{len(tasks)} subtasks completed."
        notify()
        return self.progress(run_id)
