"""Typed native plan proposals, NOT execution authority or legacy graph fallback.

Core supplies the allowed operations and any exact argument bindings. Models
cannot select permissions, workers, model tiers or evidence standards. Actual
tool handlers must still enforce paths, credentials and independent review.
"""
from copy import deepcopy
import hashlib
import json
import re
from structured_output import contract_example, parse_output, validate
from work_contracts import ACTION_FIELDS, action_schema


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


def fingerprint(value):
    return hashlib.sha256(canonical(value).encode('utf-8')).hexdigest()


def compile_contract(allowed_actions, required_calls=(), *, required_dependencies=()):
    """Bind known arguments without deriving authority from a model proposal.

Required calls may specify only known arguments (e.g. write path with generated
content not yet known). Compatible/overlapping bindings are refused rather than
creating ambiguous oneOf branches. Every required binding needs a distinct step.
"""
    if not isinstance(allowed_actions, (set, frozenset, list, tuple)) or not allowed_actions:
        raise ValueError('Explicit allowed native actions required')
    if any(type(name) is not str or name not in ACTION_FIELDS or name in {'finish', 'blocked'}
           for name in allowed_actions) or len(set(allowed_actions)) != len(allowed_actions):
        raise ValueError('Unknown, duplicate or terminal native plan action')
    allowed = sorted(allowed_actions)
    if not isinstance(required_calls, (list, tuple)) or len(required_calls) > 8:
        raise ValueError('Required native calls must contain at most eight bindings')
    templates = {branch['properties']['action']['const']: branch
                 for branch in action_schema(set(allowed))['oneOf']}
    bindings = deepcopy(list(required_calls))
    if len(canonical(bindings).encode('utf-8')) > 65536:
        raise ValueError('Native argument bindings exceed budget')
    for binding in bindings:
        if (type(binding) is not dict or type(binding.get('action')) is not str
                or binding['action'] not in templates):
            raise ValueError('Binding must name an allowed action')
        properties = templates[binding['action']]['properties']
        if set(binding) - set(properties):
            raise ValueError('Binding contains an unknown argument')
        for key, value in binding.items():
            validate(value, properties[key])
    for index, left in enumerate(bindings):
        for right in bindings[index + 1:]:
            shared = set(left) & set(right)
            if all(canonical(left[key]) == canonical(right[key]) for key in shared):
                raise ValueError('Overlapping native argument bindings are ambiguous')
    if not isinstance(required_dependencies, (list, tuple)) or len(required_dependencies) > 56:
        raise ValueError('Bounded native dependency requirements required')
    dependencies = []
    for pair in required_dependencies:
        if (not isinstance(pair, (list, tuple)) or len(pair) != 2
                or any(type(index) is not int or not 0 <= index < len(bindings) for index in pair)
                or pair[0] == pair[1] or list(pair) in dependencies):
            raise ValueError('Native dependency must name distinct known binding indices')
        dependencies.append(list(pair))
    dependencies.sort()
    done = set()
    while len(done) < len(bindings):
        ready = {index for index in range(len(bindings)) if index not in done
                 and all(source in done for source, target in dependencies if target == index)}
        if not ready: raise ValueError('Cyclic native dependency requirements')
        done.update(ready)
    choices = []
    for name in allowed:
        bound = [item for item in bindings if item['action'] == name]
        for binding in bound or [{'action': name}]:
            branch = deepcopy(templates[name])
            for key, value in binding.items():
                branch['properties'][key]['const'] = deepcopy(value)
            choices.append(branch)
    # No worker/model/evidence field comes from generation. Dispatch policy is
    # separate from this typed representation and remains unqualified/gated.
    proposed = {'type': 'object', 'properties': {
        'status': {'type': 'string', 'const': 'proposed'},
        'steps': {'type': 'array', 'minItems': 1, 'maxItems': 8, 'items': {
            'type': 'object', 'properties': {
                'id': {'type': 'string', 'minLength': 1, 'maxLength': 64},
                'call': {'oneOf': choices},
                'depends_on': {'type': 'array', 'maxItems': 8, 'uniqueItems': True,
                               'items': {'type': 'string', 'minLength': 1, 'maxLength': 64}}},
            'required': ['id', 'call', 'depends_on'], 'additionalProperties': False}}},
        'required': ['status', 'steps'], 'additionalProperties': False}
    blocked = {'type': 'object', 'properties': {
        'status': {'type': 'string', 'const': 'blocked'},
        'reason': {'type': 'string', 'minLength': 1, 'maxLength': 1000}},
        'required': ['status', 'reason'], 'additionalProperties': False}
    descriptor = {'version': 1, 'allowed_actions': allowed, 'required_calls': bindings,
                  'schema': {'oneOf': [proposed, blocked]}}
    if dependencies:
        descriptor.update(version=2, required_dependencies=dependencies)
    descriptor['sha256'] = fingerprint(descriptor)
    return descriptor


def plan_messages(task, allowed_actions, required_calls=(), *, required_dependencies=()):
    contract = compile_contract(allowed_actions, required_calls, required_dependencies=required_dependencies)
    if type(task) is not str or not task.strip() or len(task.encode('utf-8')) > 32000:
        raise ValueError('Bounded native planning task required')
    schema = contract['schema']
    return [
        {'role': 'system', 'content':
         'You propose native NORI tool calls. Return one raw JSON object only. '
         'Never use markdown. Nothing has been executed. Each step contains a '
         'complete call object with action and arguments, not a prose task. '
         'Use a distinct step for each required call. Preserve all exact bound '
         'arguments. No workers, model tiers, permissions or completion claims. '
         'If the request conflicts with the allowed calls, return status blocked '
         'with a reason. Dependencies reference step IDs and must be acyclic. '
         'Schema: ' + canonical(schema) +
         '\nRequired call bindings: ' + canonical(contract['required_calls']) +
         ('\nRequired dependency pairs [earlier binding index,later binding index]: ' +
          canonical(contract['required_dependencies']) if contract.get('required_dependencies') else '') +
         '\nSynthetic proposed shape, NOT executed evidence: ' + canonical(contract_example(schema)) +
         '\nSynthetic blocked shape, NOT a verdict on this task: ' +
         canonical({'status': 'blocked', 'reason': 'The requested operation is not available under this contract.'})},
        {'role': 'user', 'content': task},
    ]


def validate_proposal(text, allowed_actions, required_calls=(), *, required_dependencies=()):
    contract = compile_contract(allowed_actions, required_calls, required_dependencies=required_dependencies)
    plan = parse_output(text, contract['schema'])
    metadata = {'contract_sha256': contract['sha256'], 'proposal_sha256': fingerprint(plan),
                'executed_tools': [], 'execution_authorized': False}
    if plan['status'] == 'blocked':
        return {'status': 'proposal_blocked', 'plan': plan, **metadata}
    steps = plan['steps']
    ids = [step['id'] for step in steps]
    if len(set(ids)) != len(ids) or any(not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,63}', name) for name in ids):
        raise ValueError('Native step IDs must be distinct bounded identifiers')
    known = set(ids)
    if any(set(step['depends_on']) - known or step['id'] in step['depends_on'] for step in steps):
        raise ValueError('Unknown or self-referential native dependency')
    done = set()
    while len(done) < len(steps):
        ready = {step['id'] for step in steps if step['id'] not in done and set(step['depends_on']) <= done}
        if not ready:
            raise ValueError('Cyclic native plan dependencies')
        done.update(ready)
    # Nonoverlapping call variants ensure each concrete call can satisfy at
    # most one binding. No filename injection, matching by prose or repair.
    matched_ids = []
    for binding in contract['required_calls']:
        matching = [step for step in steps
                    if all(canonical(step['call'].get(key)) == canonical(value) for key, value in binding.items())]
        if len(matching) != 1:
            raise ValueError('Every required native call must appear exactly once')
        matched_ids.append(matching[0]['id'])
    parent_map = {step['id']: set(step['depends_on']) for step in steps}
    for source, target in contract.get('required_dependencies', []):
        ancestors, pending = set(), list(parent_map[matched_ids[target]])
        while pending:
            parent = pending.pop()
            if parent not in ancestors:
                ancestors.add(parent); pending.extend(parent_map[parent])
        if matched_ids[source] not in ancestors:
            raise ValueError('Server-required native dependency was not preserved')
    if len({canonical(step['call']) for step in steps}) != len(steps):
        raise ValueError('Repeated identical native calls require a separately qualified workflow')
    return {'status': 'proposal_validated', 'plan': plan, **metadata}


def compile_bound_proposal(allowed_actions, required_calls, *, required_dependencies=()):
    """Compile only Core's complete fixed calls; never infer missing arguments.

    This is an explicit planning mode, not repair of a failed model response.
    Validation/fingerprints match model proposals and confer no authority.
    """
    contract = compile_contract(allowed_actions, required_calls,
                                required_dependencies=required_dependencies)
    bindings = contract['required_calls']
    if not bindings:
        raise ValueError('Bound planning requires explicit complete calls')
    for binding in bindings:
        expected = {'action', *ACTION_FIELDS[binding['action']]}
        if set(binding) != expected:
            raise ValueError('Bound planning cannot infer missing call arguments')
    ids = [f'bound_{index + 1}' for index in range(len(bindings))]
    steps = [{'id': ids[index], 'call': deepcopy(binding), 'depends_on': []}
             for index, binding in enumerate(bindings)]
    for source, target in contract.get('required_dependencies', []):
        steps[target]['depends_on'].append(ids[source])
    result = validate_proposal(canonical({'status': 'proposed', 'steps': steps}),
                               allowed_actions, bindings,
                               required_dependencies=required_dependencies)
    return {**result, 'planner': 'nori-bound-contract-v1', 'model_used': False}
