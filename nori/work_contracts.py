"""Server-owned contracts for planning and tool selection.

These constrain generation, never grant authority. Tool handlers still validate
arguments, credentials, paths and observed results before an action executes.
"""
from copy import deepcopy
import json
import re

ACTION_FIELDS = {
    'write_file': ('path', 'content'), 'read_file': ('path',),
    'downloads_search': ('query',), 'aircrack_status': (), 'tool_status': (),
    'query_senses': ('type',), 'home_status': (), 'home_get_state': ('entity_id',),
    'home_set_light': ('entity_id', 'on', 'brightness_percent', 'rgb_color'),
    'home_set_switch': ('entity_id', 'on'),
    'home_vacuum_command': ('entity_id', 'command'),
    'tool_bridge_status': (), 'tool_bridge_list_tools': (),
    'tool_bridge_call': ('tool', 'parameters', 'approved'),
    'google_status': (),
    'draft_email': ('path', 'recipient', 'subject', 'body'),
    'draft_calendar': ('path', 'summary', 'start', 'end'),
    'gmail_list': ('query',), 'gmail_read': ('message_id',),
    'gmail_draft': ('path', 'recipient', 'subject', 'body'),
    'calendar_list': ('time_min', 'time_max'),
    'google_read': ('operation', 'parameters'), 'inspect_web': ('url',), 'research_health': (),
    'research_report': ('question', 'urls', 'limit'),
    'knowledge_search': ('query',), 'read_document': ('filename',),
    'query_database': ('filename', 'query', 'parameters'), 'analyze_csv': ('path',),
    'create_skill': ('name', 'description', 'capability', 'implementation', 'test'),
    'acquire_capability': ('capability', 'description'),
    'activate_skill': ('name',), 'run_capability': ('capability', 'parameters'),
    'find_skills': ('query',), 'run_saved_skill': ('task_id', 'name', 'parameters'),
    'project_read': ('path',), 'project_search': ('query', 'directory'),
    'project_stage': ('path', 'destination'), 'edit_file': ('path', 'old', 'new'),
    'project_apply': ('path', 'test_path'), 'project_rollback': ('delivery_id',),
    'run_python': ('path', 'arguments', 'timeout_seconds'),
    'run_tests': ('directory',),
    'run_pytest': ('directory',),
    'save_generated_output': ('execution_index', 'path'),
    'read_previous': ('path',), 'recall': ('query',),
    'finish': ('summary',), 'blocked': ('reason',),
}


def action_schema(allowed=None):
    choices = []
    for name, fields in ACTION_FIELDS.items():
        if allowed is not None and name not in allowed:
            continue
        properties = {'action': {'type': 'string', 'const': name}}
        for field in fields:
            spec = {'type': 'string'}
            if field == 'arguments':
                spec = {'type': 'array', 'items': {'type': 'string'}, 'maxItems': 32}
            elif field == 'parameters':
                spec = ({'type': 'object'} if name in {'google_read', 'run_saved_skill', 'run_capability', 'tool_bridge_call'} else
                        {'type': 'array', 'items': {'type': ['string', 'number', 'boolean', 'null']}})
            elif field == 'on':
                spec = {'type': 'boolean'}
            elif field == 'approved':
                spec = {'type': 'boolean'}
            elif field == 'brightness_percent':
                spec = {'type': ['integer', 'null'], 'minimum': 0, 'maximum': 100}
            elif field == 'rgb_color':
                spec = {'type': ['array', 'null'], 'items': {'type': 'integer', 'minimum': 0, 'maximum': 255},
                        'minItems': 3, 'maxItems': 3}
            elif field == 'urls':
                spec = {'type':'array','items':{'type':'string','minLength':1,'maxLength':2048},
                        'minItems':1,'maxItems':5,'uniqueItems':True}
            elif field == 'limit':
                spec = {'type':'integer','minimum':1,'maximum':20}
            elif field in {'execution_index', 'timeout_seconds'}:
                spec = {'type': 'integer', 'minimum': 1}
            properties[field] = spec
        choices.append({'type': 'object', 'properties': properties,
                        'required': list(properties), 'additionalProperties': False})
    return {'oneOf': choices}


PLAN_SCHEMA = {
    'type': 'object',
    'properties': {
        'plan': {'type': 'array', 'minItems': 1, 'maxItems': 8, 'items': {'type': 'string'}},
        'knight': {'type': 'string', 'const': 'neo'},
        'requirements': {'type': 'object', 'additionalProperties': {'type': 'string'}, 'maxProperties': 6},
    },
    'required': ['plan', 'knight', 'requirements'], 'additionalProperties': False,
}

from desktop_task_graph import TASK_SCHEMA
PLAN_SCHEMA['properties']['tasks'] = TASK_SCHEMA
PLAN_SCHEMA['required'].append('tasks')


def explicit_parameters(text):
    """Return one unambiguous JSON input supplied in the owner request."""
    objects = []
    decoder = json.JSONDecoder()
    offset = 0
    while offset < len(text):
        at = text.find('{', offset)
        if at < 0:
            break
        try:
            value, length = decoder.raw_decode(text[at:])
            offset = at + length
            prefix = text[max(0, at - 80):at]
            is_input = re.search(r'\b(?:input|parameters|request|for|with)\s*(?::|=)?\s*$', prefix, re.I)
            if is_input and isinstance(value, dict) and value not in objects:
                objects.append(value)
        except ValueError:
            offset = at + 1
    return objects[0] if len(objects) == 1 else None


def contract_for_prompt(goal, worker=None):
    """Recognize internal loop modes; ordinary conversation remains free text."""
    if goal.startswith('Plan this NORI desktop task.'):
        return deepcopy(PLAN_SCHEMA)
    if goal.startswith(('You are Neo doing real NORI desktop work.', 'You are a NORI worker doing real desktop work.')):
        if '\nFINAL GROUNDED SYNTHESIS\n' in goal:
            return action_schema({'finish', 'blocked'})
        allowed = None
        if 'CURRENT ASSIGNED STEP' in goal:
            assigned_step = goal.split('CURRENT ASSIGNED STEP', 1)[1]
            assigned_step = assigned_step.split('\nPrior step results', 1)[0]
            phase = None
            try:
                node = json.loads(assigned_step.split('\n', 1)[1])
                assigned_step = node['task']
                phase = node.get('capability_phase')
            except (ValueError, KeyError, IndexError, TypeError):
                pass
            specialties = {
                'neo': set(ACTION_FIELDS) - {'run_python', 'run_tests', 'run_pytest', 'run_saved_skill', 'run_capability'},
                'merovingian': {'recall', 'find_skills', 'finish', 'blocked'},
                'oracle': {'knowledge_search', 'read_document', 'finish', 'blocked'},
            'keymaker': {'research_report', 'research_health', 'knowledge_search', 'finish', 'blocked'},
                'apoc': {'inspect_web', 'finish', 'blocked'},
                'smith': {'run_python', 'run_tests', 'run_pytest', 'run_saved_skill', 'run_capability', 'read_file', 'finish', 'blocked'},
                'tank': {'query_senses', 'home_status', 'home_get_state', 'home_set_light', 'home_set_switch', 'home_vacuum_command',
                         'tool_bridge_status', 'tool_bridge_list_tools', 'tool_bridge_call', 'finish', 'blocked'},
            }
            allowed = specialties.get(worker)
            # An exact installed-project source request is handled through Neo's
            # project reader even when the planner assigned the analysis to a
            # different knight.  Restrict the proposal to that reader so an
            # Oracle worker cannot substitute the Downloads-only document
            # parser for a project path.
            if phase:
                allowed = {
                    'discover': {'find_skills', 'finish', 'blocked'},
                    'build': {'acquire_capability', 'create_skill', 'finish', 'blocked'},
                    'test': {'run_tests', 'read_file', 'finish', 'blocked'},
                    'activate': {'activate_skill', 'finish', 'blocked'},
                    'invoke': {'run_capability', 'save_generated_output', 'finish', 'blocked'},
                }.get(phase, allowed)
            elif 'project_read' in assigned_step:
                allowed = {'project_read', 'finish', 'blocked'}
            elif 'project_search' in assigned_step:
                allowed = {'project_search', 'finish', 'blocked'}
            elif 'create_skill' in assigned_step:
                allowed = {'acquire_capability', 'create_skill', 'finish', 'blocked'}
            elif 'activate_skill' in assigned_step:
                allowed = {'activate_skill', 'finish', 'blocked'}
            elif 'run_capability' in assigned_step:
                allowed = {'run_capability', 'save_generated_output', 'finish', 'blocked'}
            elif '"capability_phase": "test"' in assigned_step:
                allowed = {'run_tests', 'read_file', 'finish', 'blocked'}
            if '\nSTEP REQUIRES NEW TOOL EVIDENCE BEFORE FINISH\n' in goal:
                allowed = set(allowed if allowed is not None else ACTION_FIELDS) - {'finish'}
        schema = action_schema(allowed)
        if 'CURRENT ASSIGNED STEP' in goal and phase == 'invoke':
            original = goal.split('\nORIGINAL OWNER REQUEST ', 1)
            if len(original) == 2:
                owner_text = original[1].split('\n', 1)[-1].split('\nCURRENT ASSIGNED STEP', 1)[0]
                supplied = explicit_parameters(owner_text)
                if supplied is not None:
                    for choice in schema['oneOf']:
                        if choice['properties']['action']['const'] == 'run_capability':
                            choice['properties']['parameters'] = {'type': 'object', 'const': supplied}
        return schema
    return None
