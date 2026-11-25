"""Own bounded byte grammar compiler for closed native JSON contracts.

This is an explicit subset, not a general JSON Schema implementation. Decode
guards structure/constants/enums and array counts. Strict post-validation still
checks all lengths again, unique items, exclusive unions and task semantics. No
permission or observed result can be derived from a grammar-shaped proposal.
"""
import json
import struct

EPSILON, STRING_BODY, SIMPLE_ESCAPE, HEX, SPACE = 256, 257, 258, 259, 260
MAX_STATES, MAX_EDGES, MAX_PROGRAM = 4096, 16384, 196608


def compile_grammar(schema):
    edges = []
    string_limits = []
    states = 0

    def state():
        nonlocal states
        if states >= MAX_STATES: raise ValueError('Contract grammar state budget exceeded')
        states += 1
        return states - 1

    def edge(source, target, symbol=EPSILON):
        if len(edges) >= MAX_EDGES: raise ValueError('Contract grammar edge budget exceeded')
        edges.append((source, target, symbol))

    def literal(text, source, target):
        raw = text.encode('ascii')
        for index, byte in enumerate(raw):
            following = target if index + 1 == len(raw) else state()
            edge(source, following, byte)
            source = following
        if not raw: edge(source, target)

    def punctuation(text, source, target):
        edge(source, source, SPACE)
        literal(text, source, target)
        edge(target, target, SPACE)

    def string(node, source, target):
        body = state()
        literal('"', source, body)
        # One JSON character atom. Unicode syntax/scalar validity is enforced by
        # the independent JsonObjectPrefix intersection in the native worker.
        def atom(left, right):
            edge(left, right, STRING_BODY)
            slash, escaped, h1, h2, h3 = (state() for _ in range(5))
            edge(left, slash, ord('\\'))
            edge(slash, right, SIMPLE_ESCAPE)
            edge(slash, escaped, ord('u'))
            edge(escaped, h1, HEX); edge(h1, h2, HEX)
            edge(h2, h3, HEX); edge(h3, right, HEX)
        atom(body, body)
        limits = (node.get('minLength', 0), node.get('maxLength', 262144))
        if limits not in string_limits: string_limits.append(limits)
        edge(body, target, 261 + string_limits.index(limits))

    def integer_bound(node, key, default, cap):
        value = node.get(key, default)
        if type(value) is not int or not 0 <= value <= cap:
            raise ValueError('Unsupported contract grammar bound')
        return value

    def node(value, source, target, depth=0):
        if type(value) is not dict or depth > 24:
            raise ValueError('Invalid contract grammar schema')
        supported = {'type', 'const', 'enum', 'oneOf', 'properties', 'required',
                     'additionalProperties', 'items', 'minItems', 'maxItems',
                     'uniqueItems', 'minLength', 'maxLength'}
        if set(value) - supported: raise ValueError('Unsupported contract grammar keyword')
        if 'const' in value:
            literal(json.dumps(value['const'], ensure_ascii=True, allow_nan=False,
                               separators=(',', ':')), source, target)
            return
        variants = value.get('oneOf')
        if variants is None and 'enum' in value:
            variants = [{'const': item} for item in value['enum']]
        if variants is not None:
            if type(variants) is not list or not 1 <= len(variants) <= 64:
                raise ValueError('Unsupported grammar alternatives')
            if 'oneOf' in value and set(value) != {'oneOf'}:
                raise ValueError('Grammar unions cannot ignore sibling constraints')
            for variant in variants:
                first, last = state(), state()
                edge(source, first); node(variant, first, last, depth + 1); edge(last, target)
            return
        kind = value.get('type')
        if kind == 'object':
            properties, required = value.get('properties'), value.get('required')
            if (type(properties) is not dict or type(required) is not list
                    or len(properties) > 64 or len(set(required)) != len(required)
                    or set(required) != set(properties) or value.get('additionalProperties') is not False):
                raise ValueError('Grammar requires a closed object with all properties required')
            current = state(); punctuation('{', source, current)
            # Match the canonical schema/example serialization in plan_messages;
            # conflicting property orders steer a constrained model off track.
            for index, key in enumerate(sorted(properties)):
                child = properties[key]
                if type(key) is not str: raise ValueError('Grammar property name must be text')
                if index:
                    following = state(); punctuation(',', current, following); current = following
                following = state(); literal(json.dumps(key, ensure_ascii=True), current, following)
                current = state(); punctuation(':', following, current)
                following = state(); node(child, current, following, depth + 1); current = following
            punctuation('}', current, target)
        elif kind == 'array':
            minimum = integer_bound(value, 'minItems', 0, 8)
            maximum = integer_bound(value, 'maxItems', 8, 8)
            if minimum > maximum or type(value.get('items')) is not dict:
                raise ValueError('Invalid bounded grammar array')
            current = state(); punctuation('[', source, current)
            if minimum == 0: punctuation(']', current, target)
            for index in range(maximum):
                if index:
                    following = state(); punctuation(',', current, following); current = following
                following = state(); node(value['items'], current, following, depth + 1); current = following
                if index + 1 >= minimum: punctuation(']', current, target)
        elif kind == 'string':
            minimum = integer_bound(value, 'minLength', 0, 262144)
            maximum = integer_bound(value, 'maxLength', 262144, 262144)
            if minimum > maximum: raise ValueError('Invalid grammar string length bounds')
            string(value, source, target)
        elif kind == 'boolean':
            literal('true', source, target); literal('false', source, target)
        elif kind == 'null': literal('null', source, target)
        else: raise ValueError('Unsupported contract grammar value type')

    start, end = state(), state()
    node(schema, start, end)
    program = struct.pack('<4sIIIII', b'NGM2', states, len(edges), start, end, len(string_limits))
    program += b''.join(struct.pack('<II', *limits) for limits in string_limits)
    program += b''.join(struct.pack('<IIH', *item) for item in edges)
    if len(program) > MAX_PROGRAM: raise ValueError('Contract grammar byte budget exceeded')
    return program
