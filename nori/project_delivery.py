"""Transactional publication of tested edits to owner project files.

Only the projects/ subtree is writable. NORI's runtime, identity and safety
implementation are deliberately not deployment targets of generated code.
"""
import hashlib
import json
import os
import tempfile
from pathlib import Path
from uuid import uuid4

from shared.orchestration.workspace_paths import workspace_path


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def atomic(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.nori-delivery-')
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class ProjectDelivery:
    def __init__(self, project_root, workspace_root, store_root):
        self.project_root = Path(project_root)
        self.workspace_root = Path(workspace_root)
        self.store_root = Path(store_root)
        self.journals = self.store_root / 'deliveries'

    def target(self, relative):
        if not isinstance(relative, str) or not relative.replace('\\', '/').startswith('projects/'):
            raise ValueError('Publishable projects live under projects/; platform source remains protected')
        path = workspace_path(self.project_root, relative, operation='write')
        if path.suffix.lower() not in {'.py', '.json', '.md', '.txt', '.yaml', '.yml', '.html', '.css', '.js', '.ts'}:
            raise ValueError('Unsupported project file type')
        return path

    def journal(self, record):
        atomic(self.journals / (record['id'] + '.json'), json.dumps(record, indent=2).encode())

    def prepare(self, state, name, test_path):
        artifact = next((a for a in state['artifacts'] if a.get('name') == name and a.get('verified')), None)
        if artifact is None or not artifact.get('source_path'):
            raise ValueError('Apply requires a verified project_stage artifact')
        target = self.target(artifact['source_path'])
        candidate = workspace_path(self.workspace_root, artifact['relative_path']).read_bytes()
        if sha(candidate) != artifact['sha256']:
            raise ValueError('Candidate changed after verification')
        # All task files must match the successful snapshot, not just the edited
        # module: otherwise altered tests or dependencies could authorize it.
        files = {}
        for item in state['artifacts']:
            raw = workspace_path(self.workspace_root, item['relative_path']).read_bytes()
            if sha(raw) != item['sha256']:
                raise ValueError('Task artifact changed after verification')
            files[item['name']] = sha(raw)
        matched = None
        for index, preview in reversed(list(enumerate(state.get('executions', []), 1))):
            if preview.get('path') != test_path:
                continue
            path = workspace_path(self.store_root, f"executions/{state['task_id']}/{index:03d}.json")
            raw = path.read_bytes()
            if sha(raw) != preview.get('output_sha256'):
                raise ValueError('Execution evidence was modified')
            evidence = json.loads(raw)
            included = {f['path']: f['sha256'] for f in evidence.get('snapshot_manifest', [])}
            if (evidence.get('executed') is True and evidence.get('status') == 'completed'
                    and type(evidence.get('exit_code')) is int and evidence['exit_code'] == 0
                    and evidence.get('path') == test_path and test_path in files
                    and all(included.get(p) == h for p, h in files.items())):
                matched = index
                break
        if matched is None:
            raise ValueError('Run the verification script successfully against all current task files before applying')
        before = target.read_bytes()
        normalized = before.decode('utf-8').replace('\r\n', '\n').replace('\r', '\n')
        if sha(normalized.encode()) != artifact['source_text_sha256']:
            raise ValueError('Installed source changed since staging; refusing to overwrite newer work')
        record = dict(id=uuid4().hex, task_id=state['task_id'], target=artifact['source_path'],
                      artifact=name, before_sha256=sha(before), after_sha256=sha(candidate),
                      test_path=test_path, test_execution=matched, status='prepared')
        atomic(self.journals / (record['id'] + '.backup'), before)
        self.journal(record)
        return record, before, candidate

    async def apply(self, state, name, test_path, verify):
        record, before, candidate = self.prepare(state, name, test_path)
        target = self.target(record['target'])
        if sha(target.read_bytes()) != record['before_sha256']:
            raise ValueError('Installed source changed during preparation')
        try:
            record['status'] = 'installing'
            self.journal(record)
            atomic(target, candidate)
            installed = target.read_bytes()
            if sha(installed) != record['after_sha256']:
                raise ValueError('Installed readback failed')
            # Verification receives bytes read from the installed destination.
            result = await verify(installed)
            if not (result.get('executed') is True and result.get('status') == 'completed'
                    and type(result.get('exit_code')) is int and result['exit_code'] == 0):
                raise ValueError('Post-install verification failed')
            if sha(target.read_bytes()) != record['after_sha256']:
                raise ValueError('Installed source changed during verification')
            record['status'] = 'applied'
            self.journal(record)
            return record
        except BaseException:
            self.rollback(record['id'])
            raise

    def rollback(self, identifier):
        if not isinstance(identifier, str) or len(identifier) != 32 or any(c not in '0123456789abcdef' for c in identifier):
            raise ValueError('Invalid delivery ID')
        record = json.loads((self.journals / (identifier + '.json')).read_text())
        if not isinstance(record, dict) or record.get('id') != identifier:
            raise ValueError('Delivery record identity does not match its filename')
        target = self.target(record['target'])
        before = (self.journals / (identifier + '.backup')).read_bytes()
        if sha(before) != record['before_sha256']:
            raise ValueError('Backup integrity failed')
        current = sha(target.read_bytes())
        if current not in {record['before_sha256'], record['after_sha256']}:
            record['status'] = 'recovery_conflict'
            self.journal(record)
            raise ValueError('Rollback refused: installed file has newer external changes')
        atomic(target, before)
        if sha(target.read_bytes()) != record['before_sha256']:
            raise ValueError('Rollback readback failed')
        record['status'] = 'rolled_back'
        self.journal(record)
        return record

    def recover(self):
        results = []
        for path in self.journals.glob('*.json'):
            try:
                record = json.loads(path.read_text())
                if not isinstance(record, dict) or record.get('id') != path.stem:
                    raise ValueError('Invalid delivery record identity')
                if record['status'] in {'prepared', 'installing'}:
                    results.append(self.rollback(path.stem))
                elif record['status'] == 'recovery_conflict':
                    results.append({'id': path.stem, 'status': 'recovery_required',
                                    'reason': 'Installed file contains newer changes; manual reconciliation required'})
            except (OSError, ValueError, KeyError, TypeError) as error:
                # A broken transaction must remain visible without preventing
                # unrelated tasks or independent recovery attempts from starting.
                results.append({'id': path.stem, 'status': 'recovery_required',
                                'reason': type(error).__name__})
        return results

