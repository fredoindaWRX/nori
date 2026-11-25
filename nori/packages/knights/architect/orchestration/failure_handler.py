"""Bounded recovery without repeating unapproved side effects."""
from dataclasses import dataclass

@dataclass(frozen=True)
class FailureHandler:
    max_attempts: int = 3

    def __post_init__(self):
        if type(self.max_attempts) is not int or not 1 <= self.max_attempts <= 10:
            raise ValueError("max_attempts must be 1 to 10")

    def decide(self, *, attempt, retry_safe, status, has_fallback):
        if status in {"denied", "blocked", "cancelled"} or not retry_safe or attempt >= self.max_attempts:
            return "stop"
        return "redirect" if has_fallback else "retry"
