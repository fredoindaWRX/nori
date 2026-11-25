import json
from pathlib import Path
import tempfile
import unittest

from operator_profile import load, operational_label, validate


class OperatorProfileTests(unittest.TestCase):
    def setUp(self):
        self.profile = {
            "schema": "nori.operator-profile.v1",
            "principal_id": "owner.vanguard.001",
            "callsign": "Ghost",
            "display_name": "Ghost",
            "title": "Founding Operator",
            "owner_number": 1,
        }

    def test_ghost_label(self):
        self.assertEqual(
            operational_label(self.profile),
            "Ghost · Founding Operator · Owner 001",
        )

    def test_profile_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "operator.json"
            path.write_text(json.dumps(self.profile), encoding="utf-8")
            self.assertEqual(load(path), self.profile)

    def test_profile_metadata_cannot_smuggle_authority(self):
        invalid = dict(self.profile, permissions=["all"])
        with self.assertRaises(ValueError):
            validate(invalid)

    def test_rejects_ambiguous_owner_number(self):
        with self.assertRaises(ValueError):
            validate(dict(self.profile, owner_number=True))


if __name__ == "__main__":
    unittest.main()
