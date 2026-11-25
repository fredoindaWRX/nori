"""Verified capability acquisition for NORI work sessions.

Capabilities are executable only after their exact implementation, manifest,
and tests were included in a successful isolated-run receipt.  A current task
may activate and use its own tested capability so it can finish the owner's
original request instead of stopping after authoring a candidate.
"""
from copy import deepcopy
import hashlib
import json
import re

from orchestration.workspace_paths import workspace_path
from security.hard_floor import assert_output_safe

NAME = re.compile(r'[a-z0-9]+(?:-[a-z0-9]+)*')


def _receipt(state, store_root, index):
    if type(index) is not int or not 1 <= index <= len(state.get('executions', [])):
        raise ValueError('Capability execution evidence is missing')
    preview = state['executions'][index - 1]
    path = workspace_path(store_root, 'executions/' + state['task_id'] + f'/{index:03d}.json')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != preview.get('output_sha256'):
        raise ValueError('Capability execution evidence changed')
    evidence = json.loads(raw)
    if (not isinstance(evidence, dict) or evidence.get('path') != preview.get('path')
            or evidence.get('executed') is not True or evidence.get('status') != 'completed'
            or type(evidence.get('exit_code')) is not int or evidence['exit_code'] != 0):
        raise ValueError('Capability execution did not complete successfully')
    return evidence, preview['output_sha256']


def _result(evidence):
    lines = evidence.get('stdout', '').strip().splitlines()
    if not lines:
        raise ValueError('Capability runner did not return structured results')
    try:
        result = json.loads(lines[-1])
    except (TypeError, json.JSONDecodeError) as error:
        raise ValueError('Capability runner did not return structured results') from error
    counts = result.get('nori_skill_tests') if isinstance(result, dict) else None
    keys = ('tests_run', 'passed', 'failures', 'errors', 'skipped',
            'expected_failures', 'unexpected_successes')
    if (not isinstance(counts, dict)
            or any(type(counts.get(key)) is not int or counts[key] < 0 for key in keys)
            or counts['tests_run'] < 1 or counts['passed'] < 1
            or counts['failures'] or counts['errors'] or counts['unexpected_successes']
            or counts['tests_run'] != counts['passed'] + counts['skipped'] + counts['expected_failures']):
        raise ValueError('Capability verification requires a nonempty passing test suite')
    return result


def _snapshot_matches(evidence, hashes):
    items = evidence.get('snapshot_manifest', [])
    if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
        return False
    included = {item.get('path'): item.get('sha256') for item in items}
    return len(included) == len(items) and all(included.get(path) == digest for path, digest in hashes.items())


def begin(state, capability, description):
    if not isinstance(capability, str) or not capability.strip() or len(capability) > 100:
        raise ValueError('Capability must be 1 to 100 characters')
    if not isinstance(description, str) or not description.strip() or len(description) > 1000:
        raise ValueError('Capability description must be 1 to 1000 characters')
    for existing in state.get('capability_acquisitions', []):
        if existing['capability'].casefold() == capability.strip().casefold():
            return existing
    record = {
        'capability': capability.strip(),
        'description': description.strip(),
        'original_goal': state.get('goal', ''),
        'original_context': state.get('context', ''),
        'status': 'inventory_checked',
        'attempts': [],
    }
    state.setdefault('capability_acquisitions', []).append(record)
    return record


def verify_skill(state, workspace_root, store_root, name, *, require_completed=False):
    from test_suite import skill_verification_source
    if not isinstance(name, str) or len(name) > 64 or not NAME.fullmatch(name):
        raise ValueError('Use the exact lowercase hyphenated skill name')
    if require_completed and state.get('status') != 'completed':
        raise ValueError('Saved skills must come from a completed task')
    prefix = 'skills/' + name + '/'
    files, hashes = {}, {}
    for filename in ('skill.json', 'skill.py', 'test_skill.py'):
        relative = prefix + filename
        artifact = next((a for a in state.get('artifacts', [])
                         if a.get('name') == relative and a.get('verified')), None)
        if artifact is None:
            raise ValueError('Capability artifact is missing: ' + relative)
        path = workspace_path(workspace_root, 'tasks/' + state['task_id'] + '/' + relative)
        if path.stat().st_size > 48 * 1024:
            raise ValueError('Capability artifact is too large')
        raw = path.read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        if digest != artifact.get('sha256'):
            raise ValueError('Capability changed after verification')
        content = raw.decode('utf-8')
        assert_output_safe(content)
        files[filename], hashes[relative] = content, digest
    manifest = json.loads(files['skill.json'])
    if (manifest.get('schema') != 'nori.skill-candidate.v1' or manifest.get('name') != name
            or manifest.get('entrypoint') != 'skill.py:run' or manifest.get('test') != 'test_skill.py'):
        raise ValueError('Unsupported capability manifest')
    verifier_path = prefix + '_verify.py'
    verified_hashes = {**hashes, verifier_path: hashlib.sha256(skill_verification_source().encode('utf-8')).hexdigest()}
    for index, preview in reversed(list(enumerate(state.get('executions', []), 1))):
        if preview.get('path') != verifier_path:
            continue
        try:
            evidence, output_sha256 = _receipt(state, store_root, index)
            summary = _result(evidence)
        except ValueError as error:
            if 'evidence changed' in str(error):
                raise
            continue
        if (evidence.get('path') == verifier_path and evidence.get('arguments', []) == []
                and _snapshot_matches(evidence, verified_hashes)):
            return {
                'name': name,
                'capability': manifest.get('capability', ''),
                'description': manifest.get('description', ''),
                'task_id': state['task_id'],
                'files': files,
                'hashes': hashes,
                'test_execution': index,
                'test_output_sha256': output_sha256,
                'test_counts': summary['nori_skill_tests'],
                'isolation_required': True,
                'scope': 'Isolated Python capability; authority and host permissions are unchanged.',
            }
    raise ValueError('No successful execution covers the exact current capability files')


def activate(state, workspace_root, store_root, name):
    skill = verify_skill(state, workspace_root, store_root, name)
    activation = {
        'name': skill['name'], 'capability': skill['capability'],
        'task_id': skill['task_id'], 'test_execution': skill['test_execution'],
        'hashes': deepcopy(skill['hashes']), 'status': 'active_for_task',
        'test_output_sha256': skill['test_output_sha256'],
    }
    active = state.setdefault('activated_capabilities', [])
    active[:] = [item for item in active if item.get('name') != name]
    active.append(activation)
    for record in reversed(state.get('capability_acquisitions', [])):
        if record.get('capability') in {skill['capability'], name}:
            record.update(status='registered', implementation=name,
                          test_execution=skill['test_execution'])
            break
    return skill, activation


def resolve(sessions, current_state, workspace_root, store_root, capability):
    if not isinstance(capability, str) or not capability.strip() or len(capability) > 100:
        raise ValueError('Use an exact capability or skill name')
    wanted = capability.strip().casefold()
    activations = [item for item in current_state.get('activated_capabilities', [])
                    if item.get('status') == 'active_for_task'
                    and wanted in {item.get('name', '').casefold(), item.get('capability', '').casefold()}]
    for activation in activations:
        skill = verify_skill(current_state, workspace_root, store_root, activation['name'])
        _assert_activation(current_state, store_root, skill, activation)
        return skill, current_state
    ordered = sorted(sessions.values(), key=lambda item: item.get('created_at', ''), reverse=True)
    for state in ordered:
        if state.get('status') != 'completed':
            continue
        names = [a.get('name', '').split('/')[1] for a in state.get('artifacts', [])
                 if re.fullmatch(r'skills/[^/]+/skill\.json', a.get('name', ''))]
        for name in names:
            try:
                skill = verify_skill(state, workspace_root, store_root, name, require_completed=True)
            except (ValueError, OSError, KeyError):
                continue
            if wanted in {name.casefold(), skill.get('capability', '').casefold()}:
                return skill, state
    raise ValueError('No tested and activated capability matches ' + capability)


def _assert_activation(state, store_root, skill, activation):
    from test_suite import skill_verification_source
    if (activation.get('task_id') != state['task_id'] or activation.get('name') != skill['name']
            or activation.get('capability', '') != skill['capability']
            or activation.get('hashes') != skill['hashes']
            or activation.get('status') != 'active_for_task'):
        raise ValueError('Capability activation does not match the tested implementation')
    evidence, digest = _receipt(state, store_root, activation.get('test_execution'))
    verifier = 'skills/' + skill['name'] + '/_verify.py'
    hashes = {**skill['hashes'], verifier: hashlib.sha256(skill_verification_source().encode('utf-8')).hexdigest()}
    if (digest != activation.get('test_output_sha256') or evidence.get('path') != verifier
            or not _snapshot_matches(evidence, hashes)):
        raise ValueError('Capability activation does not match the exact test evidence')
    _result(evidence)


def verify_invocation(state, workspace_root, store_root, skill, parameters, *, execution=None):
    """Return a completion receipt only for exact tested bytes actually invoked."""
    from saved_skills import invocation_source
    invocation = invocation_source(parameters)
    prefix = 'active_capabilities/' + skill['name'] + '/'
    hashes = {prefix + filename: hashlib.sha256(content.encode('utf-8')).hexdigest()
              for filename, content in {**skill['files'], '_invoke.py': invocation}.items()}
    index = len(state.get('executions', [])) if execution is None else execution
    evidence, digest = _receipt(state, store_root, index)
    if (evidence.get('path') != prefix + '_invoke.py' or evidence.get('arguments', []) != []
            or not _snapshot_matches(evidence, hashes)):
        raise ValueError('Capability invocation evidence does not cover the exact implementation and parameters')
    for relative, expected in hashes.items():
        path = workspace_path(workspace_root, 'tasks/' + state['task_id'] + '/' + relative)
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('Capability invocation files changed after execution')
    result = _result(evidence)
    if 'result' not in result:
        raise ValueError('Capability invocation did not return its result')
    encoded = json.dumps(parameters, allow_nan=False)
    return {'result': result['result'], 'execution_index': index, 'output_sha256': digest,
            'name': skill['name'], 'capability': skill['capability'],
            'source_task_id': skill['task_id'], 'parameters': deepcopy(parameters),
            'parameters_sha256': hashlib.sha256(encoded.encode('utf-8')).hexdigest(),
            'hashes': deepcopy(skill['hashes']), 'invocation_hashes': hashes,
            'test_counts': result['nori_skill_tests']}


def assert_acquisition_complete(state, workspace_root, store_root):
    """Reject completion until every acquisition has a bound successful retry."""
    for acquisition in state.get('capability_acquisitions', []):
        if (acquisition.get('status') != 'original_goal_retried'
                or acquisition.get('original_goal') != state.get('goal', '')):
            raise ValueError('Capability acquisition is unfinished; retry the preserved original goal')
        records = [item for item in state.get('executed_tools', [])
                   if item.get('operation') == 'run_capability'
                   and item.get('status') == 'completed' and item.get('executed') is True
                   and type(item.get('exit_code')) is int and item['exit_code'] == 0
                   and item.get('execution_index') == acquisition.get('result_execution')
                   and item.get('name') == acquisition.get('implementation')
                   and str(acquisition.get('capability', '')).casefold() in {
                       str(item.get('capability', '')).casefold(), str(item.get('name', '')).casefold()}]
        if len(records) != 1:
            raise ValueError('Capability acquisition requires a matching verified invocation')
        record = records[0]
        name = record.get('name', '')
        if not isinstance(name, str) or not NAME.fullmatch(name) or not record.get('source_task_id'):
            raise ValueError('Capability invocation source is missing')
        prefix = 'active_capabilities/' + name + '/'
        files = {filename: workspace_path(workspace_root,
                 'tasks/' + state['task_id'] + '/' + prefix + filename).read_text(encoding='utf-8')
                 for filename in ('skill.json', 'skill.py', 'test_skill.py')}
        hashes = {'skills/' + name + '/' + filename: hashlib.sha256(content.encode('utf-8')).hexdigest()
                  for filename, content in files.items()}
        skill = {'name': name, 'capability': record.get('capability', ''),
                 'task_id': record['source_task_id'], 'hashes': hashes, 'files': files}
        verified = verify_invocation(state, workspace_root, store_root, skill,
                                     record.get('parameters'), execution=record['execution_index'])
        if any(record.get(key) != value for key, value in verified.items()):
            raise ValueError('Capability invocation metadata does not match recorded execution')
        if skill['task_id'] == state['task_id']:
            current = verify_skill(state, workspace_root, store_root, name)
            if current['hashes'] != hashes:
                raise ValueError('Capability changed since the successful invocation')
            activation = next((item for item in state.get('activated_capabilities', [])
                               if item.get('name') == name), None)
            if activation is None:
                raise ValueError('Capability completion requires its verified activation')
            _assert_activation(state, store_root, current, activation)
