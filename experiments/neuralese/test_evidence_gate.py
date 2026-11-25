"""Synthetic file/metric fixtures ONLY. No model or GPU claims."""
from pathlib import Path
import json
import math
import subprocess
import sys
import tempfile
import unittest
from evidence_gate import EvidenceError, hash_file, load_bounded_json, require, source_hashes, verify_build, verify_run

class EvidenceGateTests(unittest.TestCase):
    def setUp(self):
        self.owned=tempfile.TemporaryDirectory(prefix=".evidence-fixture-",dir=Path(__file__).parent)
        self.addCleanup(self.owned.cleanup)
        self.root=Path(self.owned.name).resolve()
        self.engine=self.root/"engine/norama/src";self.engine.mkdir(parents=True)
        self.experiment=self.root/"experiments/neuralese";self.experiment.mkdir(parents=True)
        for name in ("gpu_engine.cu","resident_matrix.cu","header.hpp","kernel.cuh"):
            (self.engine/name).write_bytes(b"SYNTHETIC SOURCE FIXTURE")
        for name in ("probe.cu","baseline.cu","build.ps1"):
            (self.experiment/name).write_bytes(b"SYNTHETIC BUILD INPUT")
        self.build=self.experiment/"builds/test";self.build.mkdir(parents=True)
        for name in ("neuralese-baseline.exe","neuralese-probe.exe"):
            (self.build/name).write_bytes(b"NONEXECUTABLE TEST BYTES")
        compiler=self.root/"compiler-fixture";compiler.write_bytes(b"NOT A REAL COMPILER")
        self.manifest=dict(schema_version=1,kind="nori-neuralese-build",project_root=str(self.root),
            build_directory=str(self.build),created_at="2026-10-01T00:00:00Z",source_hashes=source_hashes(self.root),
            binary_hashes={name:hash_file(self.build/name) for name in ("neuralese-baseline.exe","neuralese-probe.exe")},
            compiler=dict(cuda_path=str(compiler),cuda_sha256=hash_file(compiler),setup_path=str(compiler),setup_sha256=hash_file(compiler)),
            recipes=dict(baseline="NO FEATURE",probe="-DNORI_EXPERIMENTAL_NEURALESE"))
        self.save()
    def save(self):
        (self.build/"build-evidence.json").write_text(json.dumps(self.manifest),encoding="utf-8")
    def test_matching_fixture(self): self.assertEqual(verify_build(self.root,self.build),self.manifest)
    def test_stale_source(self):
        (self.engine/"gpu_engine.cu").write_bytes(b"CHANGED")
        with self.assertRaisesRegex(EvidenceError,"stale"): verify_build(self.root,self.build)
    def test_added_header(self):
        (self.engine/"new.hpp").write_bytes(b"ADDED")
        with self.assertRaises(EvidenceError): verify_build(self.root,self.build)
    def test_binary_tamper(self):
        (self.build/"neuralese-probe.exe").write_bytes(b"CHANGED")
        with self.assertRaisesRegex(EvidenceError,"executable"): verify_build(self.root,self.build)
    def test_compiler_tamper(self):
        Path(self.manifest["compiler"]["cuda_path"]).write_bytes(b"CHANGED")
        with self.assertRaisesRegex(EvidenceError,"tool changed"): verify_build(self.root,self.build)
    def test_missing_manifest(self):
        (self.build/"build-evidence.json").unlink()
        with self.assertRaises(EvidenceError): verify_build(self.root,self.build)
    def test_wrong_root(self):
        self.manifest["project_root"]=str(self.root/"wrong");self.save()
        with self.assertRaises(EvidenceError): verify_build(self.root,self.build)
    def test_extra_binary(self):
        self.manifest["binary_hashes"]["unowned.exe"]="0"*64;self.save()
        with self.assertRaises(EvidenceError): verify_build(self.root,self.build)
    def test_feature_in_baseline(self):
        self.manifest["recipes"]["baseline"]="-DNORI_EXPERIMENTAL_NEURALESE";self.save()
        with self.assertRaises(EvidenceError): verify_build(self.root,self.build)
    def test_oversized_json(self):
        (self.build/"build-evidence.json").write_bytes(b" "*65537)
        with self.assertRaises(EvidenceError): verify_build(self.root,self.build)
    def test_duplicate_json(self):
        (self.build/"build-evidence.json").write_text('{"x":1,"x":2}',encoding="utf-8")
        with self.assertRaisesRegex(EvidenceError,"Duplicate"): load_bounded_json(self.build/"build-evidence.json")
    def test_nonfinite_json(self):
        for value in ("NaN","Infinity","-Infinity"):
            (self.build/"build-evidence.json").write_text('{"x":'+value+'}',encoding="utf-8")
            with self.assertRaises(EvidenceError): load_bounded_json(self.build/"build-evidence.json")
    def test_optimized_require_still_runs(self):
        result=subprocess.run([sys.executable,"-B","-O","-c",
            "from evidence_gate import require; require(False,'must reject')"],cwd=Path(__file__).parent,
            capture_output=True,text=True,timeout=10)
        self.assertNotEqual(result.returncode,0);self.assertIn("must reject",result.stderr)

class MetricGateTests(unittest.TestCase):
    def metrics(self):
        return dict(load_seconds=1,ttft_seconds=.1,latency_seconds=.2,decode_seconds=.1,first_pass_seconds=0,
            cycle_2_seconds=0,tokens_per_second=30,total_process_seconds=2,hidden_size=3072,layers=28,
            vocabulary=128256,prompt_tokens=6,cycle=0,output_tokens=4,peak_owned_cuda_bytes=1000,
            live_owned_cuda_bytes_after=0,cuda_free_before=1000,cuda_free_after=1000,
            peak_ram_working_set_bytes=1000,final_decoded_bytes=4,final_token_ids=[1,2,3,4])
    def test_valid_fixture_metrics(self): verify_run(self.metrics())
    def test_nonfinite_timing(self):
        for bad in (math.nan,math.inf,-1,True):
            metrics=self.metrics();metrics["ttft_seconds"]=bad
            with self.assertRaises(EvidenceError): verify_run(metrics)
    def test_live_gpu_allocation(self):
        metrics=self.metrics();metrics["live_owned_cuda_bytes_after"]=4
        with self.assertRaises(EvidenceError): verify_run(metrics)
    def test_free_memory_regression(self):
        metrics=self.metrics();metrics["cuda_free_after"]=999
        with self.assertRaises(EvidenceError): verify_run(metrics)
    def test_bad_width(self):
        for value in (0,8193,True):
            metrics=self.metrics();metrics["hidden_size"]=value
            with self.assertRaises(EvidenceError): verify_run(metrics)
    def test_invalid_tokens(self):
        for ids in ([],[1,2],[1,2,3,128256],[1,2,3,True]):
            metrics=self.metrics();metrics["final_token_ids"]=ids
            with self.assertRaises(EvidenceError): verify_run(metrics)

if __name__=="__main__": unittest.main()
