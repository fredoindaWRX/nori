"""Server-supplied order requirements, not model-inferred permissions."""
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'nori'))
from task_plan import compile_contract, plan_messages, validate_proposal
from task_review import review_contract, validate_review

ALLOWED = {'read_file'}
CALLS = [{'action': 'read_file', 'path': 'first.txt'}, {'action': 'read_file', 'path': 'second.txt'}]
TASK = 'Read first.txt before reading second.txt.'


def proposal(dependencies):
    return json.dumps({'status': 'proposed', 'steps': [
        {'id': 's' + str(index), 'call': call, 'depends_on': dependencies[index]}
        for index, call in enumerate(CALLS)]})


class DependencyContractTests(unittest.TestCase):
    def test_server_required_order_accepts_matching_direct_dependency(self):
        answer = validate_proposal(proposal([[], ['s0']]), ALLOWED, CALLS, required_dependencies=[(0, 1)])
        self.assertEqual(answer['status'], 'proposal_validated')
        self.assertFalse(answer['execution_authorized'])

    def test_missing_and_reversed_order_fail_even_when_dag_valid(self):
        for dependencies in ([[], []], [['s1'], []]):
            raw = proposal(dependencies)
            self.assertEqual(validate_proposal(raw, ALLOWED, CALLS)['status'], 'proposal_validated')
            with self.assertRaisesRegex(ValueError, 'Server-required'):
                validate_proposal(raw, ALLOWED, CALLS, required_dependencies=[(0, 1)])

    def test_transitive_dependencies_satisfy_server_order(self):
        steps = json.loads(proposal([[], ['middle']]))['steps']
        steps.insert(1, {'id': 'middle', 'call': {'action': 'tool_status'}, 'depends_on': ['s0']})
        result = validate_proposal(json.dumps({'status': 'proposed', 'steps': steps}),
                                   {'read_file', 'tool_status'}, CALLS, required_dependencies=[(0, 1)])
        self.assertEqual(result['status'], 'proposal_validated')

    def test_invalid_requirement_indices_duplicates_cycles_and_types_refused(self):
        for edges in ('0,1', [[0]], [[0, 0]], [[0, 2]], [[-1, 1]], [[True, 1]],
                      [[0, 1], [0, 1]], [[0, 1], [1, 0]], [[0, '1']], [[0, 1]] * 57):
            with self.subTest(edges=edges), self.assertRaises(ValueError):
                compile_contract(ALLOWED, CALLS, required_dependencies=edges)

    def test_requirement_changes_fingerprint_and_prompt_but_default_compatible(self):
        base = compile_contract(ALLOWED, CALLS)
        bound = compile_contract(ALLOWED, CALLS, required_dependencies=[(0, 1)])
        self.assertEqual(base['version'], 1)
        self.assertEqual(bound['version'], 2)
        self.assertNotEqual(base['sha256'], bound['sha256'])
        messages = plan_messages(TASK, ALLOWED, CALLS, required_dependencies=[(0, 1)])
        self.assertIn('earlier binding index,later binding index', messages[0]['content'])
        self.assertEqual(messages[-1]['content'], TASK)

    def test_invalid_server_order_cannot_reach_model_review(self):
        with self.assertRaisesRegex(ValueError, 'Server-required'):
            review_contract(TASK, proposal([['s1'], []]), ALLOWED, CALLS, required_dependencies=[(0, 1)])

    def test_review_cannot_replay_across_changed_dependency_scope(self):
        raw = proposal([[], ['s0']])
        bound = review_contract(TASK, raw, ALLOWED, CALLS, required_dependencies=[(0, 1)])
        verdict = json.dumps({'binding_sha256': bound['binding_sha256'], 'decision': 'accept',
                              'issues': [], 'reason': 'Fixture only; no execution.'})
        self.assertEqual(validate_review(verdict, TASK, raw, ALLOWED, CALLS,
                                         required_dependencies=[(0, 1)])['status'], 'review_accepted')
        with self.assertRaises(ValueError): validate_review(verdict, TASK, raw, ALLOWED, CALLS)


if __name__ == '__main__': unittest.main()
