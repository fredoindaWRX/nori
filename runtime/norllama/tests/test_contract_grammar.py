"""Compiler + actual own compiled C++ guard checks, no GPU/model/tools."""
import json
from pathlib import Path
import struct
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'runtime/norllama'))
sys.path.insert(0, str(ROOT / 'nori'))
from contract_grammar import compile_grammar
from task_plan import compile_contract, validate_proposal


class ContractGrammarTests(unittest.TestCase):
    def classify(self, schema, texts):
        program = compile_grammar(schema)
        raw = program.hex() + '\n' + ''.join((item if isinstance(item, bytes) else item.encode('utf-8')).hex() + '\n' for item in texts)
        result = subprocess.run([str(ROOT / 'engine/norama/norama-contract-prefix-test.exe'),
                                 '--classify-contract-lines'], input=raw, text=True,
                                capture_output=True, timeout=15, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        states = result.stdout.splitlines()
        self.assertEqual(len(states), len(texts))
        return states

    def test_typed_root_constants_and_exact_arguments_are_enforced(self):
        schema = compile_contract({'read_file'}, [{'action': 'read_file', 'path': 'notes.txt'}])['schema']
        proposal = {'status': 'proposed', 'steps': [{'id': 'read', 'call':
                    {'action': 'read_file', 'path': 'notes.txt'}, 'depends_on': []}]}
        good = json.dumps(proposal, sort_keys=True, separators=(',', ':'))
        # Grammar uses canonical sorted property order. Other orders
        # are valid JSON but outside this explicit decode serialization profile.
        bad = [good.replace('proposed', 'succeeded'), good.replace('notes.txt', 'other.txt'),
               good.replace('read_file', 'write_file'), json.dumps(proposal['steps'][0]),
               good.replace('"steps":[', '"steps":[').replace('"id":"read"', '"worker":"neo","id":"read"'),
               good.replace('"depends_on":[]', '"depends_on":[],"verified":true'), good + ' prose']
        self.assertEqual(self.classify(schema, [good, *bad]), ['C'] + ['I'] * len(bad))

    def test_every_prefix_and_unicode_escape_are_native_guarded(self):
        schema = {'type': 'object', 'properties': {'text': {'type': 'string', 'minLength': 1}},
                  'required': ['text'], 'additionalProperties': False}
        for text in ('{"text":"中文🙂 café"}', '{"text":"\\uD83D\\uDE42\\n"}'):
            raw = text.encode('utf-8')
            samples = [raw[:index] for index in range(len(raw) + 1)]
            self.assertEqual(self.classify(schema, samples), ['P'] * len(raw) + ['C'])
        invalid = [b'{"text":"\xed\xa0\x80"}', b'{"text":"\x80"}',
                   '{"text":"\\ud800x"}', '{"text":"\\q"}', '{"text":""}']
        self.assertEqual(self.classify(schema, invalid), ['I'] * len(invalid))

    def test_array_count_closed_properties_and_whitespace(self):
        schema = {'type': 'object', 'properties': {'items': {'type': 'array', 'minItems': 1,
                  'maxItems': 2, 'items': {'type': 'boolean'}}},
                  'required': ['items'], 'additionalProperties': False}
        texts = ['{ "items" : [ true, false ] }', '{"items":[true]}',
                 '{"items":[]}', '{"items":[true,false,true]}', '{"items":[1]}',
                 '{"items":[true],"items":[false]}']
        self.assertEqual(self.classify(schema, texts), ['C', 'C', 'I', 'I', 'I', 'I'])

    def test_string_scalar_bounds_count_raw_and_escaped_unicode_correctly(self):
        schema = {'type': 'object', 'properties': {'text': {'type': 'string', 'minLength': 2, 'maxLength': 2}},
                  'required': ['text'], 'additionalProperties': False}
        good = ['{"text":"ab"}', '{"text":"中🙂"}', '{"text":"\\u4e2d\\uD83D\\uDE42"}',
                '{"text":"\\n\\\""}']
        bad = ['{"text":""}', '{"text":"a"}', '{"text":"abc"}', '{"text":"中🙂a"}',
               '{"text":"\\uD83D\\uDE42"}']
        self.assertEqual(self.classify(schema, [*good, *bad]), ['C'] * len(good) + ['I'] * len(bad))

    def test_external_whitespace_bound_does_not_limit_spaces_inside_text(self):
        schema = {'type': 'object', 'properties': {'text': {'type': 'string', 'maxLength': 100}},
                  'required': ['text'], 'additionalProperties': False}
        self.assertEqual(self.classify(schema, ['{' + ' ' * 16 + '"text":"' + ' ' * 40 + '"}',
                                                '{' + ' ' * 17 + '"text":"x"}']), ['C', 'I'])

    def test_semantic_and_length_limits_remain_post_validation_not_authority(self):
        schema = compile_contract({'read_file'}, [{'action': 'read_file', 'path': 'notes.txt'}])['schema']
        proposal = {'status': 'proposed', 'steps': [{'id': 'self', 'call':
                    {'action': 'read_file', 'path': 'notes.txt'}, 'depends_on': ['self']}]}
        raw = json.dumps(proposal, sort_keys=True, separators=(',', ':'))
        self.assertEqual(self.classify(schema, [raw]), ['C'])
        with self.assertRaises(ValueError): validate_proposal(raw, {'read_file'}, [{'action': 'read_file', 'path': 'notes.txt'}])

    def test_compiler_refuses_unsupported_keywords_and_shapes(self):
        invalid = [{'type': 'number'}, {'type': 'integer', 'minimum': 1}, {'$ref': 'other'},
                   {'oneOf': [{'const': True}], 'type': 'boolean'},
                   {'type': 'object', 'properties': {}, 'required': []},
                   {'type': 'object', 'properties': {'x': {'type': 'string'}}, 'required': [], 'additionalProperties': False},
                   {'type': 'array', 'minItems': 3, 'maxItems': 2, 'items': {'type': 'string'}},
                   {'type': 'array', 'maxItems': 100, 'items': {'type': 'string'}},
                   {'type': 'string', 'minLength': 2, 'maxLength': 1}]
        for schema in invalid:
            with self.subTest(schema=schema), self.assertRaises(ValueError): compile_grammar(schema)

    def test_program_format_is_deterministic_and_resource_bounded(self):
        schema = compile_contract({'read_file'}, [{'action': 'read_file', 'path': 'notes.txt'}])['schema']
        first = compile_grammar(schema)
        self.assertEqual(first, compile_grammar(schema))
        magic, states, edges, start, end, limits = struct.unpack_from('<4sIIIII', first)
        self.assertEqual(magic, b'NGM2')
        self.assertEqual(len(first), 24 + limits * 8 + edges * 10)
        self.assertLessEqual(states, 4096); self.assertLessEqual(edges, 16384)
        self.assertLess(start, states); self.assertLess(end, states)
        with self.assertRaises(ValueError): compile_grammar({'const': 'x' * 5000})

    def test_closed_object_property_order_matches_canonical_prompt_examples(self):
        properties = {'z': {'const': True}, 'a': {'const': False}}
        schema = {'type': 'object', 'properties': properties, 'required': ['z', 'a'], 'additionalProperties': False}
        other = dict(schema, properties=dict(reversed(list(properties.items()))), required=['a', 'z'])
        self.assertEqual(compile_grammar(schema), compile_grammar(other))
        self.assertEqual(self.classify(schema, ['{"a":false,"z":true}', '{"z":true,"a":false}']), ['C', 'I'])


if __name__ == '__main__': unittest.main()
