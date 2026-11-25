"""Typed NORI task surface for the Merovingian memory capability."""

from nori_memory import MemoryStore


class MerovingianWorker:
    def __init__(self, store: MemoryStore):
        self.store = store

    def run(self, request: dict) -> dict:
        if not isinstance(request, dict) or set(request) - {"operation", "scope", "content", "tags", "query", "limit", "entry_id"}:
            raise ValueError("memory request is invalid")
        operation = request.get("operation")
        scope = request.get("scope")
        if operation == "remember":
            if hasattr(self.store, "remember_with_status"):
                entry, storage = self.store.remember_with_status(scope, request.get("content"), request.get("tags", ()))
                return {"status": "completed", "entry": entry, "storage": storage}
            return {"status": "completed", "entry": self.store.remember(scope, request.get("content"), request.get("tags", ())) }
        if operation == "recall":
            if hasattr(self.store, "recall_with_status"):
                entries, storage = self.store.recall_with_status(scope, request.get("query", ""), request.get("limit", 20))
                return {"status": "completed", "entries": entries, "storage": storage}
            return {"status": "completed", "entries": self.store.recall(scope, request.get("query", ""), request.get("limit", 20))}
        if operation == "reconcile":
            if hasattr(self.store, "reconcile"):
                result = self.store.reconcile(scope)
                return {"status": "completed", "result": result}
            raise RuntimeError("Store does not support reconciliation")
        if operation == "export":

            return {"status": "completed", "export": self.store.export(scope)}
        if operation == "forget":
            storage = self.store.forget(scope, request.get("entry_id"))
            if isinstance(storage, dict):
                return {"status": "completed", "storage": storage}
            return {"status": "completed"}
        raise ValueError("memory operation is invalid")
