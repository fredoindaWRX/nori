"""Bounded health probe for the public-web research adapter.

The probe is deliberately separate from report generation: a failed or empty
search marks the adapter degraded and never becomes research evidence.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass
from urllib.parse import quote_plus
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class ResearchHealth:
    status: str
    checked_at: float
    query: str
    result_count: int
    error: str | None = None

    def as_dict(self) -> dict:
        return {
            "status": self.status,
            "checked_at": self.checked_at,
            "query": self.query,
            "result_count": self.result_count,
            **({"error": self.error} if self.error else {}),
        }


def check_ddgs(query: str = "NORI local AI", timeout: float = 5.0, opener=None) -> ResearchHealth:
    """Run one bounded DuckDuckGo health query (liteduck + html fallback).

    Only the existence of result links is recorded. Returned page text is not
    trusted, stored, or passed to a model.
    """
    if not isinstance(query, str) or not query.strip() or len(query) > 120:
        raise ValueError("research health query is invalid")
    if not isinstance(timeout, (int, float)) or timeout <= 0 or timeout > 15:
        raise ValueError("research health timeout is invalid")
    now = time.time()
    try:
        from security.hard_floor import assert_network_allowed
        urls = (
            "https://lite.duckduckgo.com/lite/?q=" + quote_plus(query.strip()),
            "https://html.duckduckgo.com/html/?q=" + quote_plus(query.strip()),
        )
        for target in urls:
            assert_network_allowed(target)
        client = opener or urlopen
        last_error: str | None = None
        for target in urls:
            request = Request(target, headers={"User-Agent": "NORI-research-health/1.0"})
            try:
                with client(request, timeout=float(timeout)) as response:
                    body = response.read(512 * 1024).decode("utf-8", "replace")
            except Exception as exc:
                last_error = type(exc).__name__
                continue
            # DDGS HTML result anchors have result__a; don't count navigation links.
            count = len(re.findall(r'class=["\'][^"\']*result__a', body, re.I))
            if count:
                return ResearchHealth("healthy", now, query.strip(), count)
            # Lite endpoint renders plain result links without result__a classes.
            links = len(re.findall(r'<a[^>]+href="https?://[^"]+"', body, re.I))
            if links:
                return ResearchHealth("healthy", now, query.strip(), links)
        return ResearchHealth("degraded", now, query.strip(), 0, last_error)
    except Exception as exc:
        return ResearchHealth("degraded", now, query.strip(), 0, type(exc).__name__)
