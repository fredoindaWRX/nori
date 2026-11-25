"""In-process Knight messaging. This is not a cross-process transport.

The host attaches a trusted async Sentinel adapter before sending messages.
Agent names are routing labels, not authenticated identity credentials.
"""
import asyncio
from copy import deepcopy
from dataclasses import dataclass, field
from enum import Enum
from itertools import count
from typing import Any, Protocol


class AgentName(str, Enum):
    SENTINEL = "sentinel"
    ARCHITECT = "architect"
    MACHINE = "machine"
    MEROVINGIAN = "merovingian"
    ORACLE = "oracle"
    TANK = "tank"
    SMITH = "smith"
    NEO = "neo"
    TRINITY = "trinity"
    MORPHEUS = "morpheus"
    APOC = "apoc"
    KEYMAKER = "keymaker"


@dataclass
class Message:
    from_agent: AgentName
    to_agent: AgentName
    task: str
    payload: dict[str, Any] = field(default_factory=dict)
    priority: int = 1


class SentinelAdapter(Protocol):
    async def check(self, msg: Message) -> bool: ...
    async def log_denial(self, msg: Message) -> None: ...


class MessageBus:
    """One queue per Knight; urgent messages first, FIFO within each priority.

    Use only within one event loop. Receive consumes a message (not broadcast).
    Authorization failure, missing Sentinel, and check errors never enqueue.
    """
    def __init__(self, sentinel: SentinelAdapter | None = None, watchdog=None):
        self.sentinel = sentinel
        self.watchdog = watchdog
        self._channels = {a: asyncio.PriorityQueue() for a in AgentName}
        self._sequence = count()

    async def send(self, msg: Message) -> bool:
        if not isinstance(msg, Message):
            raise TypeError("Expected Message")
        if not isinstance(msg.from_agent, AgentName) or not isinstance(msg.to_agent, AgentName):
            raise ValueError("Unknown agent")
        if not isinstance(msg.task, str) or not msg.task.strip():
            raise ValueError("task must be nonempty text")
        if not isinstance(msg.payload, dict):
            raise ValueError("payload must be a dictionary")
        if type(msg.priority) is not int or not 1 <= msg.priority <= 5:
            raise ValueError("priority must be an integer from 1 to 5")
        sentinel = self.sentinel
        if sentinel is None:
            raise RuntimeError("Sentinel must be attached before sending")
        # Snapshot before awaiting so caller changes cannot alter checked content.
        delivery = deepcopy(msg)
        try:
            authorized = await sentinel.check(deepcopy(delivery))
        except Exception:
            await sentinel.log_denial(deepcopy(delivery))
            raise
        if authorized is not True:
            await sentinel.log_denial(deepcopy(delivery))
            return False
        from security.policy import check_policy, Verdict
        verdict = check_policy(delivery)
        if verdict == Verdict.ACTUATOR:
            approve = getattr(sentinel, 'approve_actuator', None)
            try:
                approved = approve is not None and await approve(deepcopy(delivery)) is True
            except Exception:
                approved = False
            if not approved:
                await sentinel.log_denial(deepcopy(delivery))
                return False
        elif verdict == Verdict.DENY:
            await sentinel.log_denial(deepcopy(delivery))
            return False
        self._channels[delivery.to_agent].put_nowait(
            (-delivery.priority, next(self._sequence), delivery))
        observer = self.watchdog
        try:
            if observer is not None:
                observer.note_delivery(deepcopy(delivery))
        except Exception:
            # Diagnostics cannot interfere with an already-authorized delivery.
            pass
        return True

    async def receive(self, agent: AgentName) -> Message:
        if not isinstance(agent, AgentName):
            raise ValueError("Unknown agent")
        _, _, message = await self._channels[agent].get()
        return message
