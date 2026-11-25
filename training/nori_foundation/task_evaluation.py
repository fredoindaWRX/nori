"""Held-out exact-answer measurement; synthetic success is not qualification."""
from collections import defaultdict

from .instruction_data import examples, fingerprint


def evaluate(answer_function, split="test", *, dataset_version="v1"):
    if split not in ("test", "validation"):
        raise ValueError("Evaluation must use a held-out split")
    rows = tuple(row for row in examples(dataset_version) if row.split == split)
    categories = defaultdict(lambda: {"correct": 0, "total": 0, "errors": 0})
    outcomes = []
    for row in rows:
        score = categories[row.category]
        score["total"] += 1
        error = None
        answer = None
        try:
            answer = answer_function(f"[user]\n{row.question}\n[assistant]\n", 32)
            if not isinstance(answer, str):
                raise TypeError("Generator must return text")
        except Exception as exc:
            # No private exception messages in the evaluation receipt.
            error = type(exc).__name__
            score["errors"] += 1
        correct = error is None and answer == row.answer
        score["correct"] += int(correct)
        outcomes.append({"category": row.category, "question": row.question,
                         "expected": row.answer, "actual": answer,
                         "correct": correct, "error_type": error})
    return {"split": split, "dataset_version": dataset_version, "data_sha256": fingerprint(rows),
            "total": len(rows), "correct": sum(v["correct"] for v in categories.values()),
            "categories": dict(categories), "outcomes": outcomes,
            "assistant_qualified": False,
            "scope": "authored synthetic arithmetic/copy/permission tasks only"}
