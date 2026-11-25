import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'nori'))
from structured_output import parse_output, contract_messages, contract_example
from work_contracts import action_schema, PLAN_SCHEMA


class StructuredOutputTests(unittest.TestCase):
    def test_synthetic_examples_match_existing_contract_shapes(self):
        for schema in [PLAN_SCHEMA, action_schema({'read_file'}), action_schema({'finish'})]:
            value = contract_example(schema)
            self.assertEqual(parse_output(json.dumps(value), schema), value)
        self.assertIn('NOT task evidence', contract_messages('Read notes.txt', PLAN_SCHEMA)[0]['content'])
    def test_protocol_keeps_task_as_data_and_contract_as_system_rule(self):
        task = 'Read notes.txt; do not claim it was read.'
        messages = contract_messages(task, action_schema({'read_file'}))
        self.assertEqual(messages[-1], {'role': 'user', 'content': task})
        self.assertIn('Actions are proposals', messages[0]['content'])
        self.assertIn('Never use backticks', messages[0]['content'])
        self.assertIn('operation AND the exact requested', messages[0]['content'])
        with self.assertRaises(ValueError): contract_messages('', {})
    def test_existing_action_contract_accepts_exact_action(self):
        self.assertEqual(parse_output('{"action":"finish","summary":"done"}', action_schema({'finish'}))['summary'], 'done')
    def test_existing_plan_contract_accepts_complete_plan(self):
        plan = {'plan': ['read'], 'knight': 'neo', 'requirements': {'r': 'read'},
                'tasks': [{'id': 'one', 'worker': 'neo', 'model_tier': 'coder_14b',
                           'task': 'read', 'depends_on': [], 'verify': 'tool'}]}
        self.assertEqual(parse_output(json.dumps(plan), PLAN_SCHEMA), plan)
    def test_rejects_ambiguous_or_uncontracted_actions(self):
        for text in ['{"action":"finish","action":"blocked","summary":"x"}',
                     '{"action":"finish","summary":"x","approved":true}',
                     '```json\n{"action":"finish","summary":"x"}\n```',
                     '{"action":"write_file","path":"x","content":"y"}']:
            with self.subTest(text=text), self.assertRaises(ValueError):
                parse_output(text, action_schema({'finish'}))
    def test_rejects_boolean_as_integer_and_nonfinite_numbers(self):
        for text in ['true', 'NaN', 'Infinity', '1e999', '0', '11']:
            with self.subTest(text=text), self.assertRaises(ValueError):
                parse_output(text, {'type': 'integer', 'minimum': 1, 'maximum': 10})
    def test_unknown_keywords_and_ambiguous_oneof_fail_closed(self):
        with self.assertRaises(ValueError): parse_output('"x"', {'type': 'string', 'pattern': 'x'})
        with self.assertRaises(ValueError): parse_output('1', {'oneOf': [{'type': 'integer'}, {'type': 'number'}]})
        with self.assertRaises(ValueError): parse_output('1', {'oneOf': [{'type': 'integer'}, {'pattern': 'ignored'}]})
    def test_bounds_and_recursive_duplicate_keys(self):
        for text, schema in [('[[[[1]]]]', {'type': 'array', 'maxItems': 0}),
                             ('{"x":{"a":1,"a":2}}', {'type': 'object'}),
                             ('[true,1]', {'type': 'array', 'items': {'type': 'integer'}})]:
            with self.assertRaises(ValueError): parse_output(text, schema)


if __name__ == '__main__': unittest.main()
