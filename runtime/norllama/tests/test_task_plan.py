from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'nori'))
from task_plan import compile_contract, plan_messages, validate_proposal

ALLOWED = {'read_file'}
REQUIRED = [{'action': 'read_file', 'path': 'notes.txt'}]


def proposal(path='notes.txt'):
    return {'status': 'proposed', 'steps': [{'id': 'read_notes',
            'call': {'action': 'read_file', 'path': path}, 'depends_on': []}]}


class TaskPlanTests(unittest.TestCase):
    def check(self, value, allowed=ALLOWED, required=REQUIRED):
        return validate_proposal(json.dumps(value), allowed, required)

    def test_exact_typed_call_preserves_arguments_and_is_not_authority(self):
        value = proposal()
        answer = self.check(value)
        self.assertEqual(answer['plan'], value)
        self.assertEqual(answer['status'], 'proposal_validated')
        self.assertFalse(answer['execution_authorized'])
        self.assertEqual(answer['executed_tools'], [])

    def test_missing_or_changed_path_and_prose_task_are_rejected(self):
        samples = [proposal('task-local-notes.txt'), proposal('other.txt'), proposal()]
        samples[-1]['steps'][0]['call'].pop('path')
        other = proposal()
        other['steps'][0]['task'] = 'read_file notes.txt'
        samples.append(other)
        for value in samples:
            with self.subTest(value=value), self.assertRaises(ValueError): self.check(value)

    def test_model_cannot_choose_worker_tier_permission_or_evidence(self):
        for key, value in [('worker', 'neo'), ('model_tier', 'coder_14b'), ('approved', True), ('verify', 'answer')]:
            sample = proposal();sample['steps'][0][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): self.check(sample)

    def test_disallowed_action_never_becomes_a_valid_call(self):
        sample = proposal();sample['steps'][0]['call'] = {'action': 'write_file', 'path': 'notes.txt', 'content': 'bad'}
        with self.assertRaises(ValueError): self.check(sample)

    def test_two_distinct_calls_and_dependencies_are_preserved(self):
        required = REQUIRED + [{'action': 'read_file', 'path': 'second.txt'}]
        sample = proposal()
        sample['steps'].append({'id': 'second', 'call': required[1], 'depends_on': ['read_notes']})
        self.assertEqual(self.check(sample, required=required)['plan'], sample)

    def test_missing_required_call_and_repeated_call_are_rejected(self):
        required = REQUIRED + [{'action': 'read_file', 'path': 'second.txt'}]
        with self.assertRaises(ValueError): self.check(proposal(), required=required)
        sample = proposal();sample['steps'].append({**deepcopy(sample['steps'][0]), 'id': 'again'})
        with self.assertRaises(ValueError): self.check(sample)

    def test_unknown_self_cyclic_duplicate_dependencies_rejected(self):
        for deps in [['missing'], ['read_notes'], ['read_notes', 'read_notes']]:
            sample = proposal();sample['steps'][0]['depends_on'] = deps
            with self.subTest(deps=deps), self.assertRaises(ValueError): self.check(sample)
        sample = proposal();sample['steps'][0]['depends_on'] = ['second']
        sample['steps'].append({'id': 'second', 'call': {'action': 'tool_status'}, 'depends_on': ['read_notes']})
        with self.assertRaises(ValueError): self.check(sample, allowed={'read_file', 'tool_status'})

    def test_duplicate_or_invalid_step_ids_rejected_without_renaming(self):
        for name in [' ', '../x', 'a' * 65, 'line\nend']:
            sample = proposal();sample['steps'][0]['id'] = name
            with self.subTest(name=name), self.assertRaises(ValueError): self.check(sample)
        sample = proposal();sample['steps'].append(deepcopy(sample['steps'][0]))
        with self.assertRaises(ValueError): self.check(sample)

    def test_blocked_proposal_is_not_completion_or_execution(self):
        answer = self.check({'status': 'blocked', 'reason': 'Unavailable operation'})
        self.assertEqual(answer['status'], 'proposal_blocked')
        self.assertFalse(answer['execution_authorized'])
        self.assertEqual(answer['executed_tools'], [])

    def test_contracts_require_known_nonterminal_actions_and_valid_bindings(self):
        for allowed in [[], 'read_file', ['read_file', 'read_file'], ['made_up'], ['finish'], ['blocked']]:
            with self.subTest(allowed=allowed), self.assertRaises(ValueError): compile_contract(allowed)
        for required in [[{'action': 'write_file', 'path': 'notes.txt'}],
                         [{'action': 'read_file', 'path': True}], [{'action': 'read_file', 'approved': True}]]:
            with self.subTest(required=required), self.assertRaises(ValueError): compile_contract(ALLOWED, required)

    def test_ambiguous_partial_bindings_are_rejected(self):
        for required in [REQUIRED * 2, [{'action': 'read_file'}, *REQUIRED]]:
            with self.subTest(required=required), self.assertRaises(ValueError): compile_contract(ALLOWED, required)

    def test_partial_binding_leaves_content_to_proposal_but_not_path(self):
        required = [{'action': 'write_file', 'path': 'out.txt'}]
        sample = {'status': 'proposed', 'steps': [{'id': 'write', 'call':
                  {'action': 'write_file', 'path': 'out.txt', 'content': 'candidate text'}, 'depends_on': []}]}
        answer = self.check(sample, allowed={'write_file'}, required=required)
        self.assertEqual(answer['plan'], sample)
        self.assertFalse(answer['execution_authorized'])

    def test_hashes_bind_call_values_and_contract_independently(self):
        first = self.check(proposal())
        second = self.check(proposal('second.txt'), required=[{'action': 'read_file', 'path': 'second.txt'}])
        self.assertNotEqual(first['contract_sha256'], second['contract_sha256'])
        self.assertNotEqual(first['proposal_sha256'], second['proposal_sha256'])
        self.assertEqual(compile_contract({'read_file', 'tool_status'})['sha256'],
                         compile_contract(['tool_status', 'read_file'])['sha256'])

    def test_prompt_uses_typed_shape_and_keeps_task_separate(self):
        task = 'Propose reading notes.txt; do not claim execution.'
        messages = plan_messages(task, ALLOWED, REQUIRED)
        self.assertEqual(messages[-1], {'role': 'user', 'content': task})
        self.assertIn('Nothing has been executed', messages[0]['content'])
        self.assertIn('notes.txt', messages[0]['content'])
        self.assertIn('Synthetic blocked shape', messages[0]['content'])
        for invalid in ['', 'x' * 32001]:
            with self.assertRaises(ValueError): plan_messages(invalid, ALLOWED, REQUIRED)

    def test_json_fences_duplicate_keys_and_extra_claims_fail_closed(self):
        for text in ['```json\n' + json.dumps(proposal()) + '\n```',
                     '{"status":"blocked","status":"proposed","reason":"x"}']:
            with self.subTest(text=text), self.assertRaises(ValueError): validate_proposal(text, ALLOWED, REQUIRED)
        sample = proposal();sample['executed'] = True
        with self.assertRaises(ValueError): self.check(sample)


if __name__ == '__main__': unittest.main()
