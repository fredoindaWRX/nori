"""Task classification, separate from Architect's registered execution routes.

A host may supply an async Machine classification adapter. It must await an
actual model result and enforce Sentinel authorization; bus.send only returns
delivery acceptance. This module selects a Knight and never executes a task.
"""
import asyncio
import math
import re
from typing import Awaitable, Callable


ROUTING_TABLE = {
    "code": "neo", "debug": "neo",
    "browser": "apoc", "scrape": "apoc",
    "research": "keymaker", "report": "keymaker",
    "knowledge": "oracle", "remember": "merovingian", "recall": "merovingian",
    "hardware": "tank", "device": "tank",
    "execute": "smith", "run": "smith",
    "ide": "morpheus", "general": "trinity",
}
ALLOWED_TARGETS = frozenset(ROUTING_TABLE.values())
_GENERIC = frozenset({"run", "execute", "general"})


async def route(task: str, *, classify: Callable[[str], Awaitable[str]] | None = None,
                timeout: float = 15.0) -> str:
    """Return a validated Knight name; unavailable classification uses Trinity.

    Whole words avoid accidental matches such as 'run' in 'brunch'. Specific
    matches take precedence over generic verbs. Multiple specialist matches
    require classification rather than relying on dictionary insertion order.
    The classifier is supplied by the trusted host, never by task content.
    """
    if not isinstance(task, str) or not task.strip():
        raise ValueError("task must be nonempty text")
    if not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("timeout must be positive and finite")
    words = set(re.findall(r"\b\w+\b", task.casefold()))
    # Explicit intent phrases take precedence over incidental language names.
    # Merely mentioning a script does not mean it should be written or run.
    if words & {"remember", "recall"}:
        return "merovingian"
    if words & {"linter", "ide"}:
        return "morpheus"
    if words & {"manual", "manuals", "indexed", "corpus"}:
        return "oracle"
    if words & {"ble", "obd", "gpio", "mavlink"} or {"can", "bus"} <= words:
        return "tank"
    if words & {"website", "webpage"} and words & {"open", "click", "navigate", "visit"}:
        return "apoc"
    if words & {"write", "create", "implement", "debug"} and words & {"script", "function", "code", "python"}:
        return "neo"
    specific = {agent for key, agent in ROUTING_TABLE.items()
                if key not in _GENERIC and key in words}
    generic = {agent for key, agent in ROUTING_TABLE.items()
               if key in _GENERIC and key in words}
    matches = specific or generic
    if len(matches) == 1:
        return matches.pop()
    if classify is None:
        return "trinity"
    try:
        result = await asyncio.wait_for(classify(task), timeout=timeout)
    except (asyncio.TimeoutError, ConnectionError):
        return "trinity"
    # No parsing of model prose or execution of model-generated commands.
    if isinstance(result, str):
        result = result.strip().lower()
        if result in ALLOWED_TARGETS:
            return result
    return "trinity"
