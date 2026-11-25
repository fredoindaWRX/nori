"""Pure helper functions shared by NORI work sessions (part 1: constants)."""
from __future__ import annotations
import re
TERMINAL = frozenset({"completed", "blocked", "failed", "cancelled", "interrupted"})
IDENTIFIER = re.compile(r"[A-Za-z0-9_-]{1,128}")
MAX_FILE_BYTES = 48 * 1024
MAX_ARTIFACT_DOWNLOAD_BYTES = 32 * 1024 * 1024
GREETING = re.compile(r"(?:hi|hello|hey)(?:[ ,]+n\.?o\.?r\.?i\.?)?[.!?]*", re.I)
QUESTION = re.compile(r"^\s*(?:how\s+(?:do|can|would)|what\b|why\b|when\b|where\b|who\b|does\b|do\b|is\b|are\b|explain\b|tell\s+me\s+about\b|help\s+me\s+understand\b)", re.I)
WORK_REQUEST = re.compile(r"^\s*(?:can|could|will|would)\s+you\b|^\s*(?:please\s+)?(?:make|create|build|fix|install|write|run|test|finish|change|edit|delete|move)\b", re.I)
OWNER_EVENT_TEXT = {"queued": "NORI queued your request.", "planning": "NORI is preparing the work.", "answering": "NORI is preparing an answer.", "plan": "NORI prepared the next steps.", "thinking": "NORI is working on your request.", "tool_started": "NORI started a work step.", "tool_completed": "NORI completed a work step.", "observation_reused": "NORI reused a verified result from this task.", "execution_result": "NORI recorded an isolated execution result.", "memory": "NORI saved this result in local memory.", "memory_unavailable": "NORI saved this result in desktop history; local memory was unavailable."}
from datetime import datetime, timezone
def _now():
    return datetime.now(timezone.utc).isoformat()
