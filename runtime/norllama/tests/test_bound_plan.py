from copy import deepcopy
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'nori'))
from task_plan import compile_bound_proposal, validate_proposal, canonical


class BoundPlanTests(unittest.TestCase):
    def test_exact_arguments_and_dependencies_survive_without_authority(self):
        calls = [{'action': 'read_file', 'path': 'notes.txt'},
                 {'action': 'write_file', 'path': 'output.txt', 'content': 'literal'}]
        original = deepcopy(calls)
        result = compile_bound_proposal({'read_file', 'write_file'}, calls,
                                        required_dependencies=[(0, 1)])
        self.assertEqual(calls, original)
        self.assertEqual([step['call'] for step in result['plan']['steps']], calls)
        self.assertEqual(result['plan']['steps'][1]['depends_on'], ['bound_1'])
        self.assertFalse(result['execution_authorized'])
        self.assertFalse(result['model_used'])
        self.assertEqual(result['executed_tools'], [])
        validated = validate_proposal(canonical(result['plan']), {'read_file', 'write_file'},
                                      calls, required_dependencies=[(0, 1)])
        self.assertEqual(result['proposal_sha256'], validated['proposal_sha256'])
        result['plan']['steps'][1]['call']['content'] = 'changed'
        self.assertEqual(calls, original)

    def test_no_fabricated_defaults_for_partial_write(self):
        with self.assertRaisesRegex(ValueError, 'missing call arguments'):
            compile_bound_proposal({'write_file'}, [{'action': 'write_file', 'path': 'output.txt'}])

    def test_empty_disallowed_repeated_and_cyclic_contracts_fail(self):
        calls = [{'action': 'read_file', 'path': 'notes.txt'}]
        for allowed, bindings, dependencies in [
            ({'read_file'}, [], []), ({'write_file'}, calls, []),
            ({'read_file'}, calls * 2, []),
            ({'read_file'}, calls + [{'action': 'read_file', 'path': 'second.txt'}], [(0, 1), (1, 0)]),
        ]:
            with self.subTest(bindings=bindings), self.assertRaises(ValueError):
                compile_bound_proposal(allowed, bindings, required_dependencies=dependencies)


if __name__ == '__main__':
    unittest.main()
