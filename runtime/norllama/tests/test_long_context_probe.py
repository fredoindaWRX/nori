import copy
import math
import unittest
import actual_long_context_probe as probe
import json


def evidence():
    rows = [{'phase': phase, 'tokens': count, 'logits': 128256, 'max_absolute': 1e-5,
             'reference_top': 1, 'actual_top': 1} for phase, count in zip(
        ['stateless_vs_chunked', 'different_chunk_boundaries', 'rollback_then_reuse', 'reset_then_prefill'],
        [128, 350, 351, 350])]
    rows.append({'status': 'PASS', 'tokens': 350, 'layers': 28, 'cpu_full_context_reference': False,
                 'external_reference': False, 'tools_executed': 0, 'execution_authorized': False})
    return rows


class LongContextEvidenceTests(unittest.TestCase):
    def check(self, rows):
        return probe.checked_rows('\n'.join(map(json.dumps, rows)), 350)

    def test_complete_evidence(self):
        self.assertEqual(self.check(evidence()), evidence())

    def test_missing_extra_reordered_or_wrong_prefix_is_refused(self):
        rows = evidence()
        for bad in (rows[1:], rows + [rows[-1]], [rows[1], rows[0], *rows[2:]]):
            with self.assertRaises(ValueError): self.check(bad)
        for key, value in [('tokens', 256), ('logits', 1), ('actual_top', 2)]:
            bad = copy.deepcopy(rows); bad[1][key] = value
            with self.assertRaises(ValueError): self.check(bad)

    def test_outlier_and_nonfinite_error_refused(self):
        for value in (math.nan, math.inf, -1e-5, 1e-3, 'small'):
            bad = evidence(); bad[2]['max_absolute'] = value
            with self.assertRaises(ValueError): self.check(bad)

    def test_false_completion_reference_and_authority_refused(self):
        for key, value in [('status', 'FAIL'), ('tokens', 349), ('layers', 27),
                           ('cpu_full_context_reference', True), ('external_reference', True),
                           ('tools_executed', 1), ('execution_authorized', True)]:
            bad = evidence(); bad[-1][key] = value
            with self.assertRaises(ValueError): self.check(bad)


if __name__ == '__main__': unittest.main()
