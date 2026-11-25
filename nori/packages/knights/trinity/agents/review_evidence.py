"""Validate review citations; matching text is evidence, not proof of a bug."""
import hashlib


def validate_review(source, result):
    if not isinstance(source, str) or not isinstance(result, dict):
        raise ValueError('Source text and structured review required')
    findings = result.get('findings')
    if not isinstance(findings, list) or len(findings) > 20:
        raise ValueError('Expected at most twenty findings')
    lines = source.splitlines()
    accepted, rejected = [], []
    for finding in findings:
        reason = None
        if not isinstance(finding, dict):
            reason = 'Finding must be an object'
        elif any(not isinstance(finding.get(k), str) or not finding[k].strip()
                 for k in ('quote', 'trigger', 'failure', 'fix')):
            reason = 'Quote, trigger, failure and fix are required'
        else:
            start, end = finding.get('start_line'), finding.get('end_line')
            if type(start) is not int or type(end) is not int or not 1 <= start <= end <= len(lines):
                reason = 'Invalid source line range'
            elif finding['quote'] not in '\n'.join(lines[start-1:end]):
                reason = 'Quoted code does not occur in the cited lines'
        if reason:
            rejected.append({'finding': finding, 'reason': reason})
        else:
            accepted.append(finding)
    return {'status': 'evidence_rejected' if rejected else 'review_candidate',
            'source_sha256': hashlib.sha256(source.encode()).hexdigest(),
            'findings': accepted, 'rejected': rejected,
            'verified_correct': False}
