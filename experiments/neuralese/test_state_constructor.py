from dataclasses import replace
import unittest
import struct
from latent_state import NoriLatentState

class ConstructorTests(unittest.TestCase):
    def setUp(self):
        self.state=NoriLatentState.from_bytes(struct.pack("<2f",1,2),model_id="test",hidden_size=2,cycle=1,source_token_count=3)
    def test_direct_dimension_rejected(self):
        with self.assertRaises(ValueError): replace(self.state,hidden_size=3)
    def test_direct_mutable_vector_rejected(self):
        with self.assertRaises(ValueError): replace(self.state,vector=[1.0,2.0])
    def test_direct_hash_rejected(self):
        with self.assertRaises(ValueError): replace(self.state,vector_hash="0"*64)
    def test_timestamp_rejected(self):
        for value in ("bad", "2026-10-01T00:00:00"):
            with self.assertRaises(ValueError): replace(self.state,created_at=value)
    def test_cycle_two(self):
        self.assertEqual(replace(self.state,cycle=2).cycle,2)

if __name__=="__main__": unittest.main()
