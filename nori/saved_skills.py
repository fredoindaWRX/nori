"""Discover tested task-local skills. Never import their code on the host."""
import json
from security.hard_floor import assert_output_safe


def load_tested_skill(state, workspace_root, store_root, name):
    # Keep the public API while sharing the exact evidence verifier with the
    # same-task capability activation path.
    from capability_acquisition import verify_skill
    return verify_skill(state, workspace_root, store_root, name, require_completed=True)


def find_tested_skills(sessions, workspace_root, store_root, query):
    if not isinstance(query, str) or len(query) > 120:
        raise ValueError('Use a skill search query of at most 120 characters')
    found, skipped, examined = [], 0, 0
    ordered = sorted(sessions.values(), key=lambda s: s.get('created_at', ''), reverse=True)
    for state in ordered[:500]:
        if state.get('status') != 'completed':
            continue
        for artifact in state.get('artifacts', []):
            name = artifact.get('name', '').split('/')
            if len(name) != 3 or name[0] != 'skills' or name[2] != 'skill.json':
                continue
            examined += 1
            try:
                skill = load_tested_skill(state, workspace_root, store_root, name[1])
                if query.casefold() in (skill['name'] + ' ' + skill['description']).casefold():
                    found.append({k: v for k, v in skill.items() if k != 'files'})
            except (ValueError, OSError, KeyError):
                skipped += 1
            if len(found) >= 20 or examined >= 100:
                return {'status': 'completed', 'skills': found, 'skipped': skipped, 'truncated': True}
    return {'status': 'completed', 'skills': found, 'skipped': skipped, 'truncated': len(ordered) > 500}


def invocation_source(parameters):
    if not isinstance(parameters, dict):
        raise ValueError('Skill parameters must be a JSON object')
    encoded = json.dumps(parameters, allow_nan=False)
    if len(encoded) > 8000:
        raise ValueError('Skill parameters are too large')
    assert_output_safe(encoded)
    # JSON is data, never interpolated as Python expressions.
    return ('import json, sys, unittest\nimport test_skill\nfrom skill import run\n'
            'suite = unittest.defaultTestLoader.loadTestsFromModule(test_skill)\n'
            'if suite.countTestCases() == 0: raise RuntimeError("Skill has no tests")\n'
            'result = unittest.TextTestRunner(stream=sys.stderr).run(suite)\n'
            'if not result.wasSuccessful(): raise SystemExit(1)\n'
            'passed = result.testsRun - len(result.skipped) - len(result.expectedFailures) - len(result.failures) - len(result.errors) - len(result.unexpectedSuccesses)\n'
            'if passed <= 0:\n'
            '    raise RuntimeError("Skill has no passing tests; invocation refused")\n'
            'counts = {"tests_run": result.testsRun, "passed": passed, "failures": len(result.failures), "errors": len(result.errors), "skipped": len(result.skipped), "expected_failures": len(result.expectedFailures), "unexpected_successes": len(result.unexpectedSuccesses)}\n'
            f'parameters = json.loads({encoded!r})\n'
            'print(json.dumps({"result": run(parameters), "nori_skill_tests": counts}, allow_nan=False))\n')
