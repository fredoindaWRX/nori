"""NORI-native Keymaker report builder over source-linked Oracle results."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from uuid import uuid4

from audit.nori_audit import record
from orchestration.oracle_worker import OracleWorker
from permissions.nori_policy import Policy


class KeymakerWorker:
    def __init__(self, oracle: OracleWorker, policy: Policy, audit_path: Path):
        self.oracle = oracle
        self.policy = policy
        self.audit_path = Path(audit_path)

    def run(self, request: dict[str, Any]) -> dict[str, Any]:
        if not isinstance(request, dict) or set(request) - {"operation", "question", "limit"}:
            raise ValueError("keymaker request is invalid")
        if request.get("operation") == "research_health":
            if set(request) != {"operation"}:
                raise ValueError("research health request is invalid")
            from research_health import check_ddgs
            result = check_ddgs()
            record(self.audit_path, "keymaker_research_health", str(uuid4()), result.status, result.as_dict())
            return {"status": "completed", "health": result.as_dict()}
        if request.get("operation") != "report":
            raise ValueError("keymaker operation is invalid")
        question = request.get("question")
        if not isinstance(question, str) or not question.strip() or len(question) > 512:
            raise ValueError("report question is invalid")
        limit = request.get("limit", 5)
        if type(limit) is not int or not 1 <= limit <= 20:
            raise ValueError('report limit is invalid')
        return self._report(question, limit, [])

    def run_with_web(self, request: dict[str, Any], web_sources: list[dict[str, Any]]) -> dict[str, Any]:
        """Build a report from local evidence plus Council-fetched Apoc results.

        This method is called only by CouncilGateway after Apoc completes each
        typed browser request. It deliberately does not accept URLs itself.
        """
        if (not isinstance(request, dict) or set(request) - {'operation', 'question', 'limit'}
                or request.get('operation') != 'report'):
            raise ValueError('keymaker request is invalid')
        question = request.get('question')
        if not isinstance(question, str) or not question.strip() or len(question) > 512:
            raise ValueError('report question is invalid')
        limit = request.get('limit', 5)
        if type(limit) is not int or not 1 <= limit <= 20:
            raise ValueError('report limit is invalid')
        if (not isinstance(web_sources, list) or len(web_sources) > 5
                or any(not isinstance(item, dict) or set(item) != {'url', 'content_type', 'text'}
                       or not isinstance(item['url'], str)
                       or item['content_type'] not in {'text/html', 'text/plain'}
                       or not isinstance(item['text'], str) or len(item['text']) > 30_000
                       for item in web_sources)):
            raise ValueError('web evidence is invalid')
        return self._report(question, limit, web_sources)

    def _report(self, question, limit, web_sources):
        task_id = str(uuid4())
        decision = self.policy.decide('research_report')
        if not decision.allowed:
            record(self.audit_path, 'keymaker_report', task_id, 'denied', {'reason': decision.reason})
            return {'status':'denied','task_id':task_id,'reason':decision.reason}
        findings = self.oracle.store.search(question, limit)
        if findings["status"] != "completed":
            record(self.audit_path, "keymaker_report", task_id, "denied", {"reason": "knowledge_read_not_granted"})
            return {"status": "denied", "task_id": task_id, "reason": "knowledge_read_not_granted"}
        citations = [{"id": index + 1, "source": item["source"], "excerpt": item["excerpt"],
                      'source_type':'local_corpus', 'evidence_type':item['evidence_type'],
                      'indexed_text_sha256':item['indexed_text_sha256']}
                     for index, item in enumerate(findings["results"])]
        for item in web_sources:
            citations.append({'id':len(citations)+1, 'source':item['url'],
                              'excerpt':item['text'][:2000], 'source_type':'public_web_apoc'})
        report = {
            "question": question,
            "finding_count": len(citations),
            "citations": citations,
            "statement": ("This report contains retrieved local and Apoc-fetched public-web evidence only; "
                          "it makes no unsupported conclusion." if web_sources else
                          "This report contains retrieved local evidence only; it makes no unsupported conclusion."),
        }
        record(self.audit_path, "keymaker_report", task_id, "completed", {"citations": len(citations)})
        return {"status": "completed", "task_id": task_id, "report": report}
