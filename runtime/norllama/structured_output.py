"""Strict post-generation validation. This grants no tool authority.

Supports only the schema vocabulary used by Nori's task contracts; unknown
keywords fail closed. It is not token-level constrained decoding.
"""
import json
import math


def contract_example(schema, depth=0):
    """Synthetic shape guide only: never evidence, never an executable action."""
    if depth > 32: raise ValueError('Contract example depth exceeded')
    if 'const' in schema: return schema['const']
    if 'enum' in schema: return schema['enum'][0]
    if 'oneOf' in schema: return contract_example(schema['oneOf'][0], depth + 1)
    kind = schema.get('type', 'object')
    if isinstance(kind, list): kind = kind[0]
    if kind == 'object':
        value = {key: contract_example(schema['properties'][key], depth + 1)
                 for key in schema.get('required', [])}
        if not value and isinstance(schema.get('additionalProperties'), dict):
            value['REQUIREMENT_NAME'] = contract_example(schema['additionalProperties'], depth + 1)
        return value
    if kind == 'array':
        count = schema.get('minItems', 0)
        if count > 8: raise ValueError('Contract example array budget exceeded')
        return [contract_example(schema.get('items', {}), depth + 1) for _ in range(count)]
    if kind == 'string': return 'REPLACE_WITH_TASK_VALUE'
    if kind in {'integer', 'number'}: return schema.get('minimum', 0)
    if kind == 'boolean': return False
    if kind == 'null': return None
    raise ValueError('Unsupported example type')


def contract_messages(task, schema):
    """Raw JSON transport protocol, not a permission or decoding constraint."""
    if not isinstance(task, str) or not task.strip(): raise ValueError('Task text required')
    return [
        {'role': 'system', 'content':
         'You are a JSON protocol endpoint, not a markdown chat assistant. '
         'Your entire reply must be a single JSON object. The first character is { '
         'and the last character is }. Never use backticks, code fences or prose. '
         'Follow the schema exactly. Actions are proposals, not executed results. '
         'Copy requested filenames exactly; never add prefixes or invent paths. '
         'Each task description must include its operation AND the exact requested '
         'arguments, including filenames; an operation name alone is not a task. '
         'Enum values must be exact strings from the schema, not invented synonyms. '
         'Return an INSTANCE, not the schema definition. '
         'Schema: ' + json.dumps(schema, separators=(',', ':'), allow_nan=False) +
         '\nSynthetic format example, NOT task evidence. Replace all placeholders '
         'and choose values appropriate to the actual task: ' +
         json.dumps(contract_example(schema), separators=(',', ':'), allow_nan=False)},
        {'role': 'user', 'content': task},
    ]


def parse_output(text, schema):
    def check_schema(node, depth=0):
        if depth > 32 or not isinstance(node, dict): raise ValueError('Invalid native output schema')
        supported = {'type', 'const', 'enum', 'oneOf', 'properties', 'required',
                     'additionalProperties', 'maxProperties', 'items', 'minItems',
                     'maxItems', 'uniqueItems', 'minLength', 'maxLength', 'minimum', 'maximum'}
        if set(node) - supported: raise ValueError('Unsupported native output schema')
        children = list(node.get('properties', {}).values()) + node.get('oneOf', [])
        for key in ('items', 'additionalProperties'):
            if isinstance(node.get(key), dict): children.append(node[key])
        for child in children: check_schema(child, depth + 1)
    check_schema(schema)
    if not isinstance(text, str) or len(text.encode('utf-8')) > 262144:
        raise ValueError('Structured output exceeds its byte budget')
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value: raise ValueError('Duplicate JSON property')
            value[key] = item
        return value
    def constant(_): raise ValueError('Non-finite JSON number')
    try:
        value = json.loads(text, object_pairs_hook=pairs, parse_constant=constant)
    except (RecursionError, OverflowError) as exc:
        raise ValueError('Structured output nesting is excessive') from exc
    validate(value, schema)
    return value


def validate(value, schema, depth=0):
    if depth > 32: raise ValueError('Structured output nesting is excessive')
    allowed = {'type', 'const', 'enum', 'oneOf', 'properties', 'required',
               'additionalProperties', 'maxProperties', 'items', 'minItems',
               'maxItems', 'uniqueItems', 'minLength', 'maxLength', 'minimum', 'maximum'}
    if not isinstance(schema, dict) or set(schema) - allowed:
        raise ValueError('Unsupported native output schema')
    if 'oneOf' in schema:
        matches = 0
        for candidate in schema['oneOf']:
            try: validate(value, candidate, depth + 1)
            except ValueError: continue
            matches += 1
        if matches != 1: raise ValueError('Output must match exactly one contract')
    kinds = {'object': type(value) is dict, 'array': type(value) is list,
             'string': type(value) is str, 'integer': type(value) is int,
             'number': type(value) in (int, float), 'boolean': type(value) is bool,
             'null': value is None}
    expected = schema.get('type')
    if expected is not None:
        expected = expected if isinstance(expected, list) else [expected]
        if any(kind not in kinds for kind in expected) or not any(kinds[kind] for kind in expected):
            raise ValueError('Output type does not match contract')
    # JSON canonical comparison keeps true distinct from 1, including nested consts.
    canonical = lambda item: json.dumps(item, sort_keys=True, allow_nan=False, separators=(',', ':'))
    if 'const' in schema and canonical(value) != canonical(schema['const']):
        raise ValueError('Output constant does not match contract')
    if 'enum' in schema and canonical(value) not in [canonical(item) for item in schema['enum']]:
        raise ValueError('Output value is not permitted')
    if type(value) in (int, float):
        if type(value) is float and not math.isfinite(value): raise ValueError('Non-finite number')
        if value < schema.get('minimum', -math.inf) or value > schema.get('maximum', math.inf):
            raise ValueError('Output number exceeds contract bounds')
    if type(value) is str:
        if len(value) < schema.get('minLength', 0) or len(value) > schema.get('maxLength', 262144):
            raise ValueError('Output string exceeds contract bounds')
    if type(value) is list:
        if len(value) < schema.get('minItems', 0) or len(value) > schema.get('maxItems', 4096):
            raise ValueError('Output array exceeds contract bounds')
        if schema.get('uniqueItems') and len({canonical(item) for item in value}) != len(value):
            raise ValueError('Output array contains duplicates')
        for item in value: validate(item, schema.get('items', {}), depth + 1)
    if type(value) is dict:
        if len(value) > schema.get('maxProperties', 4096) or any(key not in value for key in schema.get('required', [])):
            raise ValueError('Output properties do not match contract')
        properties = schema.get('properties', {})
        additional = schema.get('additionalProperties', True)
        for key, item in value.items():
            if key in properties: validate(item, properties[key], depth + 1)
            elif additional is False: raise ValueError('Unexpected output property')
            else: validate(item, additional if isinstance(additional, dict) else {}, depth + 1)
