"""Typed NORI Oracle worker over the private local knowledge store."""

from pathlib import Path
from uuid import uuid4

from audit.nori_audit import record
from nori_knowledge import KnowledgeStore
from permissions.nori_policy import Policy


class OracleWorker:
    def __init__(self, root: Path, policy: Policy, audit_path: Path):
        self.policy = policy
        self.audit_path = Path(audit_path)
        self.store = KnowledgeStore(root, policy, audit_path)

    def run(self, request: dict) -> dict:
        if not isinstance(request, dict) or not isinstance(request.get("operation"), str):
            raise ValueError("oracle request is invalid")
        if request.get("operation") == "index" and set(request) == {"operation", "path"}:
            return self.store.index(request["path"])
        if request.get("operation") == "search" and set(request) <= {"operation", "query", "limit"}:
            return self.store.search(request.get("query"), request.get("limit", 5))
        if request.get("operation") == "manifest" and set(request) == {"operation"}:
            return {"status": "completed", "manifest": self.store.export_manifest()}
        if request.get("operation") == "report" and set(request) <= {"operation", "question", "limit"}:
            question = request.get("question")
            limit = request.get("limit", 5)
            if not isinstance(question, str) or not question.strip() or len(question) > 512:
                raise ValueError("report question is invalid")
            task_id = str(uuid4())
            decision = self.policy.decide("research_report")
            if not decision.allowed:
                record(self.audit_path, "oracle_report", task_id, "denied", {"reason": decision.reason})
                return {"status": "denied", "task_id": task_id, "reason": decision.reason}
            findings = self.store.search(question, limit)
            if findings.get('status') != 'completed':
                record(self.audit_path, 'oracle_report', task_id, 'denied',
                       {'reason': 'knowledge_read_not_granted'})
                return {'status': 'denied', 'task_id': task_id,
                        'reason': 'knowledge_read_not_granted'}
            citations = [{"id": index + 1, "source": item["source"], "excerpt": item["excerpt"],
                          'evidence_type': item['evidence_type'], 'indexed_text_sha256': item['indexed_text_sha256']}
                         for index, item in enumerate(findings.get("results", []))]
            report = {"question": question, "finding_count": len(citations),
                      "citations": citations,
                      "statement": "This report contains retrieved local evidence only; it makes no unsupported conclusion."}
            record(self.audit_path, "oracle_report", task_id, "completed", {"citations": len(citations)})
            return {"status": "completed", "task_id": task_id, "report": report}
        raise ValueError("oracle request is invalid")
