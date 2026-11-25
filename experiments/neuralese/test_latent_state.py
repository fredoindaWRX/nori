import math
import struct
import unittest
from latent_state import NoriLatentState

class LatentStateTests(unittest.TestCase):
    def state(self, raw=None, **changes):
        args=dict(model_id="test-model",hidden_size=3,cycle=1,source_token_count=4)
        args.update(changes)
        return NoriLatentState.from_bytes(struct.pack("<3f",1,2,3) if raw is None else raw, **args)

    def test_hash_deterministic(self): self.assertEqual(self.state().vector_hash,self.state().vector_hash)
    def test_cosine_identical(self): self.assertAlmostEqual(self.state().cosine(self.state()),1)
    def test_norm(self): self.assertAlmostEqual(self.state().norm,math.sqrt(14))
    def test_allocation(self):
        state=self.state();self.assertEqual(state.allocation.bytes,12)
        self.assertEqual(state.allocation.owner,"Nori.Neuralese")
    def test_nonfinite(self):
        for value in (math.nan,math.inf,-math.inf):
            with self.assertRaises(ValueError): self.state(struct.pack("<3f",value,2,3))
    def test_shape(self):
        for size in (0,-1,8193,True):
            with self.assertRaises(ValueError): self.state(hidden_size=size)
    def test_bad_bytes(self):
        for raw in (b"",b"1234",bytearray(12)):
            with self.assertRaises(ValueError): self.state(raw)
    def test_cycle(self):
        self.assertEqual(self.state(cycle=2).cycle,2)
        for cycle in (0,3,True):
            with self.assertRaises(ValueError): self.state(cycle=cycle)
    def test_token_bound(self):
        for value in (0,129,True):
            with self.assertRaises(ValueError): self.state(source_token_count=value)
    def test_model_id(self):
        for value in ("", "x"*129,"model\nother"):
            with self.assertRaises(ValueError): self.state(model_id=value)
    def test_compatibility(self):
        with self.assertRaises(ValueError): self.state().cosine(self.state(model_id="other"))
    def test_zero(self):
        with self.assertRaises(ValueError): self.state().cosine(self.state(struct.pack("<3f",0,0,0)))

if __name__ == "__main__": unittest.main()
