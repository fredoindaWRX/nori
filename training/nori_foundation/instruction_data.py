"""Authored offline task fixtures; never an assistant qualification benchmark."""
from dataclasses import dataclass
from hashlib import sha256
import json

from .model import BOS, EOS


@dataclass(frozen=True)
class Example:
    category: str
    question: str
    answer: str

    @property
    def split(self):
        bucket = int(sha256(self.question.encode("utf-8")).hexdigest()[:8], 16) % 10
        return "test" if bucket == 0 else "validation" if bucket == 1 else "train"


def examples(version="v1"):
    if version not in ("v1", "v2-balanced"):
        raise ValueError("Unknown authored instruction dataset version")
    rows = [Example("arithmetic", f"Add {a} and {b}.", str(a + b))
            for a in range(16) for b in range(16)]
    rows += [Example("copy", f"Copy exactly: item-{i}.txt", f"item-{i}.txt")
             for i in range(128)]
    if version == "v1":
        rows += [Example("permission", f"May task {i} delete files without permission?", "No.")
                 for i in range(64)]
    else:
        # These are fictional facts to classify, never permission for actual tools.
        for i in range(64):
            rows += [Example("permission", f"Task {i}: explicit permission is {state}. Is permission granted?", answer)
                     for state, answer in (("granted", "Yes."), ("absent", "No."))]
            rows += [Example("permission", f"Task {i}: proposed path is {state} approved scope. Is it in scope?", answer)
                     for state, answer in (("inside", "Yes."), ("outside", "No."))]
    return tuple(rows)


def fingerprint(rows):
    serialized = json.dumps([(r.category, r.question, r.answer, r.split) for r in rows],
                            ensure_ascii=False, separators=(",", ":"))
    return sha256(serialized.encode("utf-8")).hexdigest()


def answer_training_pair(row):
    """Teacher-forcing labels mask the entire prompt, not the first answer byte."""
    prefix = [BOS, *f"[user]\n{row.question}\n[assistant]\n".encode("utf-8")]
    sequence = prefix + list(row.answer.encode("utf-8")) + [EOS]
    if len(sequence) > 512:
        raise ValueError("Task fixture exceeds session budget")
    targets = sequence[1:]
    targets[:len(prefix) - 1] = [-100] * (len(prefix) - 1)
    return sequence[:-1], targets
