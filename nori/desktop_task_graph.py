"""Validated desktop worker assignments and prerequisite scheduling."""
import re
WORKERS = ('neo', 'smith', 'trinity', 'oracle', 'merovingian', 'keymaker', 'morpheus', 'apoc', 'tank')
MODEL_TIERS = ('coder_14b', 'rag_12b', 'general_8b')
TASK_FIELDS = frozenset({'id', 'worker', 'model_tier', 'task', 'depends_on', 'verify'})
WORKER_MODEL_TIER = {
    'neo': 'coder_14b', 'morpheus': 'coder_14b',
    'oracle': 'rag_12b', 'keymaker': 'rag_12b',
    'smith': 'general_8b', 'trinity': 'general_8b', 'merovingian': 'general_8b',
    'apoc': 'general_8b', 'tank': 'general_8b',
}


def _is_sensory_read_task(text):
    """Recognize current physical evidence requests, not sensor theory."""
    return bool(re.search(
        r"\b(?:query_senses|where am i|what(?:'s| is) (?:around me|moving)|"
        r"sensor readings|current (?:gps|location|temperature)|"
        r"(?:host )?network links?|network interfaces?|interface status|"
        r"tailscale|wi-?fi|ethernet|bluetooth(?: discovery| devices?)?|nearby devices|"
        r"live (?:vehicle|obd|camera)|can you (?:see|hear))\b", text, re.I))


def _home_operation(text):
    if re.search(r"\bhome_status\b|\b(?:is|status of|state of)\b.{0,80}\b(?:light|switch|thermostat|vacuum|robot vacuum|home assistant)\b", text, re.I):
        return 'home_get_state'
    if re.search(r"\bhome_vacuum_command\b|\b(?:start|stop|pause|dock|return to base|send to dock|clean with|vacuum the)\b.{0,100}\b(?:vacuum|robot vacuum)\b|\b(?:vacuum|robot vacuum)\b.{0,60}\b(?:start|stop|pause|dock|return to base)\b", text, re.I):
        return 'home_vacuum_command'
    if re.search(r"\bhome_set_light\b|\b(?:turn|switch|dim|brighten|set)\b.{0,100}\blight", text, re.I):
        return 'home_set_light'
    if re.search(r"\bhome_set_switch\b|\b(?:turn|switch)\b.{0,100}\b(?:switch|outlet|plug|kettle)\b", text, re.I):
        return 'home_set_switch'
    return None


def _tool_bridge_operation(text):
    exact = re.search(r"\btool_bridge_(status|list_tools|call)\b", text, re.I)
    if exact:
        return {
            "status": "tool_bridge_status",
            "list_tools": "tool_bridge_list_tools",
            "call": "tool_bridge_call",
        }[exact.group(1).lower()]
    if not re.search(r"\b(?:openclaw|mcp|tool bus|tool bridge|jarvis stack|home assistant bridge)\b", text, re.I):
        return None
    if re.search(r"\b(?:status|configured|connected|trusted|available|ready)\b", text, re.I):
        return "tool_bridge_status"
    if re.search(r"\b(?:list|tools|capabilities|what can)\b", text, re.I):
        return "tool_bridge_list_tools"
    if re.search(r"\b(?:call|run|use|invoke)\b", text, re.I):
        return "tool_bridge_call"
    return "tool_bridge_status"


TASK_SCHEMA = {'type': 'array', 'minItems': 1, 'maxItems': 8, 'items': {
    'type': 'object', 'properties': {
        'id': {'type': 'string'}, 'worker': {'type': 'string', 'enum': list(WORKERS)},
        'model_tier': {'type': 'string', 'enum': list(MODEL_TIERS)},
        'task': {'type': 'string'}, 'depends_on': {'type': 'array', 'items': {'type': 'string'}},
        'verify': {'type': 'string', 'enum': ['answer', 'tool', 'artifact', 'execution']}},
    'required': ['id', 'worker', 'model_tier', 'task', 'depends_on', 'verify'], 'additionalProperties': False}}


def normalize_capability_node(node):
    """Bind capability stages to their specific evidence, not arbitrary tools."""
    text = node['task'].casefold()
    phase = None
    if 'find_skills' in text:
        phase = 'discover'
    elif 'create_skill' in text:
        phase = 'build'
    elif 'activate_skill' in text:
        phase = 'activate'
    elif 'run_capability' in text:
        phase = 'invoke'
    elif 'run_tests' in text and ('skill' in text or 'capability' in text):
        phase = 'test'
    elif re.search(r'\b(?:create|build|implement)\b.{0,100}\b(?:skill|capability)\b', text):
        phase = 'build'
    elif node['verify'] == 'answer':
        return node
    elif 'run_saved_skill' in text:
        return node
    elif re.search(r'\b(?:run|execute|test|verify)\b', text) and ('test' in text or 'test_skill' in text) and ('skill' in text or 'capability' in text):
        phase = 'test'
    elif re.search(r'\bactivate\b.{0,80}\b(?:skill|capability)\b', text):
        phase = 'activate'
    elif re.search(r'\b(?:invoke|use)\b.{0,80}\b(?:skill|capability)\b', text):
        phase = 'invoke'
    if phase:
        worker, verification, action = {
            'discover': ('merovingian', 'tool', 'find_skills'),
            'build': ('neo', 'artifact', 'create_skill'),
            'test': ('smith', 'execution', 'run_tests'),
            'activate': ('neo', 'tool', 'activate_skill'),
            'invoke': ('smith', 'execution', 'run_capability'),
        }[phase]
        node.update(worker=worker, model_tier=WORKER_MODEL_TIER[worker], verify=verification, capability_phase=phase)
        if action not in text:
            node['task'] = 'Use ' + action + '. ' + node['task']
    return node


def validate(tasks):
    if not isinstance(tasks, list) or not 1 <= len(tasks) <= 8:
        raise ValueError('Desktop graph requires 1 to 8 tasks')
    nodes = []
    for t in tasks:
        if not isinstance(t, dict) or set(t) != TASK_FIELDS:
            raise ValueError('Invalid desktop task fields')
        if any(not isinstance(t[k], str) or not t[k].strip() for k in ('id', 'worker', 'model_tier', 'task', 'verify')):
            raise ValueError('Missing desktop task identity or instruction')
        if len(t['id']) > 64 or len(t['task']) > 2000 or t['worker'] not in WORKERS or t['model_tier'] not in MODEL_TIERS:
            raise ValueError('Unsupported desktop worker or task size')
        # Readback is executed by Neo even if a planner initially labels it as a knowledge step;
        # normalize that routing before enforcing the final worker/tier pairing.
        is_readback = (
            t['verify'] in {'artifact', 'tool'}
            and re.match(r'^(?:use\s+)?read_file\b', t['task'], re.I)
            and not re.search(r'\b(?:write|edit|modify|replace|create|write_file|edit_file)\b', t['task'], re.I)
        )
        # Analysis reads an existing verified artifact; requiring changed bytes
        # makes a successful analyze loop forever, exactly like a readback.
        # Keep mixed write-then-analyze steps intact so their real writes still
        # verify as artifacts.
        is_csv_analysis = (
            t['verify'] in {'artifact', 'execution', 'tool'}
            and re.search(r'\banalyze_csv\b', t['task'], re.I)
            and not re.search(r'\b(?:write|edit|modify|replace|create|write_file|edit_file)\b', t['task'], re.I)
        )
        # Older planners sometimes labeled a read-then-edit code task as Oracle.
        # It is an implementation task, so normalize its final executor to Neo.
        is_legacy_code_read = (
            t['worker'] == 'oracle'
            and re.match(r'^(?:use\s+)?read_file\b', t['task'], re.I)
            and re.search(r'\b(?:write|edit|modify|replace|create|write_file|edit_file)\b', t['task'], re.I)
        )
        project_lookup = re.search(r'\b(project_read|project_search)\b', t['task'], re.I)
        is_project_lookup = bool(
            project_lookup
            and not re.search(r'\b(?:write|edit|modify|replace|create|project_stage|project_apply)\b',
                              t['task'], re.I)
        )
        is_sensory_read = _is_sensory_read_task(t['task'])
        home_operation = _home_operation(t['task'])
        tool_bridge_operation = _tool_bridge_operation(t['task'])
        effective_worker = ('tank' if (is_sensory_read or home_operation or tool_bridge_operation) else
                            'neo' if (is_readback or is_legacy_code_read or is_project_lookup) else t['worker'])
        if not is_sensory_read and t['model_tier'] != WORKER_MODEL_TIER[effective_worker]:
            raise ValueError('Task model tier does not match the assigned worker')
        if t['verify'] not in {'answer', 'tool', 'artifact', 'execution'}:
            raise ValueError('Unsupported verification requirement')
        if not isinstance(t['depends_on'], list) or any(not isinstance(d, str) for d in t['depends_on']):
            raise ValueError('Invalid desktop task dependencies')
        nodes.append({**t, 'depends_on': list(t['depends_on']), 'status': 'pending'})
        # A readback checks an existing artifact; requiring changed bytes makes
        # a successful read loop forever. Keep mixed read-and-edit steps intact.
        if is_readback:
            nodes[-1].update(worker='neo', model_tier=WORKER_MODEL_TIER['neo'], verify='tool', required_operation='read')
        elif is_project_lookup:
            nodes[-1].update(worker='neo', model_tier=WORKER_MODEL_TIER['neo'],
                             verify='tool', required_operation=project_lookup.group(1).lower())
        elif is_csv_analysis:
            nodes[-1].update(verify='tool', required_operation='analyze_csv')
        elif is_legacy_code_read:
            nodes[-1].update(worker='neo', model_tier=WORKER_MODEL_TIER['neo'])
        elif is_sensory_read:
            nodes[-1].update(worker='tank', model_tier=WORKER_MODEL_TIER['tank'],
                             verify='tool', required_operation='query_senses')
            if 'query_senses' not in nodes[-1]['task'].casefold():
                nodes[-1]['task'] = 'Use query_senses for cached read-only sensor evidence. ' + nodes[-1]['task']
        elif home_operation:
            nodes[-1].update(worker='tank', model_tier=WORKER_MODEL_TIER['tank'],
                             verify='tool', required_operation=home_operation)
            if home_operation not in nodes[-1]['task'].casefold():
                nodes[-1]['task'] = 'Use ' + home_operation + ' through Tank. ' + nodes[-1]['task']
        elif tool_bridge_operation:
            nodes[-1].update(worker='tank', model_tier=WORKER_MODEL_TIER['tank'],
                             verify='tool', required_operation=tool_bridge_operation)
            if tool_bridge_operation not in nodes[-1]['task'].casefold():
                nodes[-1]['task'] = 'Use ' + tool_bridge_operation + ' through Tank. ' + nodes[-1]['task']
        # Data/execution specialists cannot downgrade their own evidence to a
        # prose-only answer. Synthesis belongs to Trinity.
        if nodes[-1]['verify'] == 'answer' and t['worker'] in {'oracle', 'merovingian', 'tank', 'apoc', 'keymaker', 'smith'}:
            nodes[-1]['verify'] = 'execution' if t['worker'] == 'smith' else 'tool'
    ids = {n['id'] for n in nodes}
    if len(ids) != len(nodes) or any(d not in ids for n in nodes for d in n['depends_on']):
        raise ValueError('Duplicate task IDs or unknown dependency')
    # Small planners sometimes copy the entire owner goal into a second
    # generic write node.  That graph is not executable: it has no distinct
    # artifact scope and can strand the real test node behind a duplicate.
    # Require each generic write step to have a distinct dependency context;
    # normal writes to different named files remain valid.
    generic_writes = [n for n in nodes
                      if n.get('worker') == 'neo'
                      and re.match(r'^\s*(?:use\s+)?write_file\s*$', n.get('task', ''), re.I)]
    for left_index, left in enumerate(generic_writes):
        for right in generic_writes[left_index + 1:]:
            if set(left.get('depends_on', [])) == set(right.get('depends_on', [])):
                raise ValueError('Duplicate unscoped write_file steps')
    done = set()
    while len(done) < len(nodes):
        ready = {n['id'] for n in nodes if n['id'] not in done and set(n['depends_on']) <= done}
        if not ready:
            raise ValueError('Cyclic desktop task dependencies')
        done.update(ready)
    return nodes


def next_node(nodes):
    done = {n['id'] for n in nodes if n['status'] == 'completed'}
    return next((n for n in nodes if n['status'] in {'pending', 'running'}
                 and set(n['depends_on']) <= done), None)


def assert_step_write_scope(node, action):
    """A named artifact belongs to the graph step that named it.

    This prevents an early coding node from silently completing a later
    prerequisite, which would make the later node's evidence meaningless.
    Tasks without a file name remain unconstrained because their scope cannot
    be inferred safely from prose.
    """
    if node.get('worker') != 'neo' or action.get('action') not in {'write_file', 'edit_file'}:
        return
    names = set(re.findall(r'(?<![\w.-])(?:[\w.-]+/)*[\w.-]+\.(?:py|json|md|txt|yaml|yml)(?![\w.-])',
                           node.get('task', ''), re.I))
    if names and action.get('path') not in names:
        raise ValueError('This graph step is assigned to ' + ', '.join(sorted(names)) +
                         '. Do not write a file reserved for a later step.')


def schedule_repair(nodes, node, action, result):
    """Return failed task-local execution to Neo, then retry Smith, at most 3 times."""
    if (node['worker'] != 'smith' or node['verify'] != 'execution'
            or action.get('action') not in {'run_python', 'run_tests', 'run_pytest', 'run_capability'}
            or result.get('executed') is not True
            or type(result.get('exit_code')) is not int or result['exit_code'] == 0):
        return None
    attempt = node.get('repair_attempts', 0) + 1
    if attempt > 3:
        raise ValueError('Three repair attempts failed; execution errors remain in task history')
    repair_id = node['id'] + '-repair-' + str(attempt)
    while any(n['id'] == repair_id for n in nodes):
        repair_id += '-r'
    repair = {'id': repair_id, 'worker': 'neo', 'model_tier': WORKER_MODEL_TIER['neo'], 'verify': 'artifact', 'status': 'pending',
              'depends_on': list(node['depends_on']),
              'task': 'Repair the task-local implementation using the recorded execution failure. '
                      'Preserve the owner requirements and test assertions. Read the relevant files, '
                      'fix the defect, then finish this repair step so Smith can rerun verification.',
              'failure_evidence': {'action': action, 'exit_code': result['exit_code'],
                                   'stdout': result.get('stdout', ''), 'stderr': result.get('stderr', '')}}
    nodes.insert(nodes.index(node), repair)
    if action.get('action') == 'run_capability':
        capability = action.get('capability', '')
        test_id, activate_id = repair_id + '-test', repair_id + '-activate'
        test = {'id': test_id, 'worker': 'smith', 'model_tier': WORKER_MODEL_TIER['smith'], 'verify': 'execution', 'status': 'pending',
                'depends_on': [repair_id],
                'task': 'Run the repaired capability test file with run_tests before activation.'}
        activate = {'id': activate_id, 'worker': 'neo', 'model_tier': WORKER_MODEL_TIER['neo'], 'verify': 'tool', 'status': 'pending',
                    'depends_on': [test_id],
                    'task': 'Use activate_skill to reactivate the repaired ' + capability + ' capability.'}
        at = nodes.index(node)
        nodes[at:at] = [normalize_capability_node(test), normalize_capability_node(activate)]
        node.update(status='pending', depends_on=[activate_id], repair_attempts=attempt)
    else:
        node.update(status='pending', depends_on=[repair_id], repair_attempts=attempt)
    node.pop('evidence_start', None)
    return repair


def stale_mutation_already_verified(node, action, result, state):
    """Recognize a queued edit whose intended bytes were already tested.

    A planner can leave an older edit node behind after Neo repairs a file and
    Smith successfully reruns it.  Retrying that edit is unsafe and can create
    an endless loop when its old snippet is gone.  We only skip it when the
    exact artifact is the script used by a successful execution in this task.
    """
    if (node.get('worker') != 'neo' or action.get('action') != 'edit_file'
            or result.get('reason') != 'edit_snippet_mismatch'):
        return False
    path = str(action.get('path', '')).replace('\\', '/')
    artifact = next((a for a in state.get('artifacts', [])
                     if a.get('name', '').casefold() == path.casefold()
                     and a.get('verified')), None)
    if artifact is None:
        return False
    return any(e.get('path', '').replace('\\', '/').casefold() == path.casefold()
               and e.get('executed') is True and e.get('exit_code') == 0
               and e.get('script_sha256') == artifact.get('sha256')
               for e in state.get('executions', []))


def verify_node(node, state):
    start = node['evidence_start']
    phase = node.get('capability_phase')
    if phase:
        required = {'discover': 'find_skills', 'build': 'create_skill_candidate', 'test': 'verify_skill_tests',
                    'activate': 'activate_skill', 'invoke': 'run_capability'}[phase]
        effects = state['executed_tools'][start['tools']:]
        matching = [e for e in effects if e.get('operation') == required
                    and e.get('status', 'completed') == 'completed']
        if phase in {'test', 'invoke'}:
            matching = [e for e in matching if e.get('executed') is True
                        and type(e.get('exit_code')) is int and e['exit_code'] == 0]
        if phase == 'discover':
            matching = [e for e in matching if e.get('matches', 0) > 0]
        if not matching:
            raise ValueError('This capability step requires successful ' + required + ' evidence')
    if node['verify'] == 'artifact':
        current = {a['name']: a.get('sha256') for a in state['artifacts'] if a.get('verified')}
        # Idempotent writes verify the bytes again and record their hash. An
        # earlier node may already have produced the requested file. Repair
        # nodes still require a change rather than revalidating failed code.
        confirmed = any(e.get('operation') == 'verify_existing_artifact'
                        and e.get('status') == 'completed'
                        and any(a.get('verified') and a.get('relative_path') == e.get('path')
                                and a.get('sha256') == e.get('sha256') for a in state['artifacts'])
                        for e in state['executed_tools'][start['tools']:])
        if not any(start['artifacts'].get(k) != v for k, v in current.items()) and not (confirmed and not node.get('failure_evidence')):
            raise ValueError('Assigned step requires a new or changed verified artifact')
    elif node['verify'] == 'execution':
        runs = state.get('executions', [])[start['executions']:]
        if not runs or not runs[-1].get('executed') or runs[-1].get('exit_code') != 0:
            raise ValueError('Assigned step requires a new successful execution')
    elif node['verify'] == 'tool':
        effects = state['executed_tools'][start['tools']:]
        if node.get('required_operation'):
            required = node['required_operation']
            # ``read`` is the semantic requirement; project_read is the
            # guarded implementation used for enrolled source files, while
            # read_file is reserved for task artifacts.
            accepted = {'read', 'project_read', 'read_file'} if required == 'read' else {required}
            effects = [e for e in effects if e.get('operation') in accepted]
        if not effects or not any(e.get('status', 'completed') == 'completed' for e in effects):
            raise ValueError('Assigned step requires successful tool evidence')






