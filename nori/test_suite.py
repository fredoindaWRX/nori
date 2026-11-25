"""Build a unittest discovery entrypoint for the isolated worker."""
from pathlib import PurePosixPath


def skill_verification_source():
    """Server-owned runner: importing a test file alone never counts as testing."""
    return (
        'import json, sys, unittest\nimport test_skill\n'
        'suite = unittest.defaultTestLoader.loadTestsFromModule(test_skill)\n'
        'result = unittest.TextTestRunner(stream=sys.stderr, verbosity=2).run(suite)\n'
        'counts = {"tests_run": result.testsRun, "failures": len(result.failures), '
        '"errors": len(result.errors), "skipped": len(result.skipped), '
        '"expected_failures": len(result.expectedFailures), '
        '"unexpected_successes": len(result.unexpectedSuccesses)}\n'
        'counts["passed"] = counts["tests_run"] - sum(counts[k] for k in '
        '("failures", "errors", "skipped", "expected_failures", "unexpected_successes"))\n'
        'print(json.dumps({"nori_skill_tests": counts}, allow_nan=False))\n'
        'raise SystemExit(0 if result.wasSuccessful() and counts["passed"] > 0 else 1)\n'
    )


def discovery_source(directory='', framework='unittest'):
    if not isinstance(directory, str) or len(directory) > 240:
        raise ValueError('Test directory must be a relative workspace folder')
    normalized = directory.replace('\\', '/')
    path = PurePosixPath(normalized)
    if path.is_absolute() or '..' in path.parts or ':' in normalized or '\x00' in normalized:
        raise ValueError('Test directory must stay inside the task workspace')
    if framework == 'pytest':
        return (
            'import json, os\n'
            'os.environ["PYTEST_DISABLE_PLUGIN_AUTOLOAD"] = "1"\n'
            'os.environ.pop("PYTEST_ADDOPTS", None)\n'
            'import pytest\n'
            'class Results:\n'
            '    def __init__(self): self.passed = 0; self.failed = 0; self.skipped = 0\n'
            '    def pytest_runtest_logreport(self, report):\n'
            '        if report.when == "call" and report.passed: self.passed += 1\n'
            '        if report.failed: self.failed += 1\n'
            '        if report.skipped: self.skipped += 1\n'
            'results = Results()\n'
            f'code = pytest.main(["-q", "-c", "/dev/null", "--override-ini=addopts=", {str(path)!r}], plugins=[results])\n'
            'print(json.dumps({"framework": "pytest", "passed": results.passed, '
            '"failures": results.failed, "skipped": results.skipped, "pytest_exit_code": int(code)}))\n'
            'raise SystemExit(int(code) if code else (0 if results.passed > 0 else 1))\n'
        )
    if framework != 'unittest':
        raise ValueError('Unsupported test framework')
    return (
        'import json, sys, unittest\n'
        f'suite = unittest.defaultTestLoader.discover({str(path)!r}, pattern="test*.py")\n'
        'count = suite.countTestCases()\n'
        'if count == 0:\n'
        '    print(json.dumps({"tests_run": 0, "error": "no_tests_discovered"}))\n'
        '    raise SystemExit(2)\n'
        'result = unittest.TextTestRunner(stream=sys.stderr, verbosity=2).run(suite)\n'
        'print(json.dumps({"tests_run": result.testsRun, "failures": len(result.failures), '
        '"errors": len(result.errors), "skipped": len(result.skipped)}))\n'
        'raise SystemExit(0 if result.wasSuccessful() and result.testsRun > len(result.skipped) else 1)\n'
    )
