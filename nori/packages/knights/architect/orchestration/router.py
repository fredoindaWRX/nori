"""Explicit capability routes; fallbacks must share the same request contract."""
from dataclasses import dataclass
from threading import Lock

@dataclass
class Route:
    knight: str
    handler: object
    contract: dict
    restart: object = None

class Router:
    def __init__(self):
        self.routes = {}
        self.locks = {}

    def register(self, capability, knight, handler, contract, restart=None):
        if not callable(handler) or not isinstance(contract, dict):
            raise ValueError("A callable handler and documented request contract are required")
        routes = self.routes.setdefault(capability, [])
        if routes and routes[0].contract != contract:
            raise ValueError("Fallbacks must implement the same contract")
        if any(r.knight == knight for r in routes):
            raise ValueError("Duplicate route")
        routes.append(Route(knight, handler, contract, restart))
        self.locks.setdefault(knight, Lock())

    def contracts(self):
        return {cap: routes[0].contract for cap, routes in self.routes.items()}

    def candidates(self, capability):
        return tuple(self.routes.get(capability, ()))

    def execute(self, route, request):
        # A Knight instance is not assumed thread-safe. Different Knights run concurrently.
        with self.locks[route.knight]:
            return route.handler(request)
