"""Owned, explicit local experiment. Binary vectors go only to a NEW result directory."""
import argparse
from pathlib import Path
import json
import subprocess
import statistics
from hashlib import sha256
import time
from latent_state import NoriLatentState
from evidence_gate import require, verify_build, verify_run, hash_file, load_bounded_json

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--binary-directory",type=Path,required=True)
    parser.add_argument("--experimental-neuralese",action="store_true",required=True)
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[2]
    model=root/"models/language/llama3.2-3b-instruct/llama3.2-3b-instruct.gguf"
    probe=args.binary_directory/"neuralese-probe.exe"
    baseline=args.binary_directory/"neuralese-baseline.exe"
    build_evidence=verify_build(root,args.binary_directory)
    provenance=load_bounded_json(model.with_name("MODEL_PROVENANCE.json"),maximum=16384)
    require(provenance.get("weights")==model.name and type(provenance.get("bytes")) is int
            and provenance["bytes"]==model.stat().st_size,"Model provenance byte/name mismatch")
    model_hash=hash_file(model)
    require(model_hash==provenance.get("sha256"),"Model weights differ from recorded provenance")
    measured_sources=[*sorted((root/"engine/norama/src").glob("*")),
                      *sorted(Path(__file__).parent.glob("*.py")),
                      *sorted(Path(__file__).parent.glob("*.cu")),Path(__file__).with_name("build.ps1")]
    source_hashes={str(p.relative_to(root)):sha256(p.read_bytes()).hexdigest()
                   for p in measured_sources if p.is_file()}
    original_worker=root/"engine/norama/norama-worker.exe"
    worker_hash=hash_file(original_worker)
    args.output.mkdir(parents=True,exist_ok=False)
    states={};runs=[]
    prompts={"A":"The sky is blue.","B":"The sky is blue.","C":"An engine misfires under load."}
    for label,mode in [("base1","baseline"),("A","capture"),("base2","baseline"),
                       ("B","capture"),("base3","baseline"),("C","capture"),
                       ("recur","recurrence"),("bounds","selftest")]:
        prompt=prompts.get(label,prompts["A"])
        vector_path=args.output/f"{label}.f32"
        process_start=time.perf_counter()
        result=subprocess.run([str(probe),str(model),mode,prompt,str(vector_path),"--experimental-neuralese"],
                              capture_output=True,text=True,timeout=120,check=True)
        process_seconds=time.perf_counter()-process_start
        metrics=json.loads(result.stdout);metrics["label"]=label;metrics["total_process_seconds"]=process_seconds
        verify_run(metrics)
        if mode!="baseline":
            require(vector_path.is_file() and vector_path.stat().st_size==metrics["hidden_size"]*4,"Vector file shape differs from metrics")
            with vector_path.open("rb") as vector_handle:
                raw=vector_handle.read(8192*4+1)
            state=NoriLatentState.from_bytes(raw,model_id="llama3.2-3b-instruct",
                    hidden_size=metrics["hidden_size"],cycle=metrics["cycle"],source_token_count=metrics["prompt_tokens"])
            states[label]=state
            require(metrics["snapshot"]["hidden_size"]==state.hidden_size,"Snapshot dimension mismatch")
            require(metrics["snapshot"]["dtype"]==state.dtype,"Snapshot dtype mismatch")
            require(metrics["snapshot"]["device"]=="cuda:0","Snapshot GPU provenance mismatch")
            require(metrics["snapshot"]["token_index"]==metrics["prompt_tokens"]-1+(mode=="recurrence"),"Snapshot token position mismatch")
            metrics["vector_hash"]=state.vector_hash;metrics["norm"]=state.norm
            metrics["first4"]=list(state.vector[:4]);metrics["last4"]=list(state.vector[-4:])
        runs.append(metrics)
    disabled=json.loads(subprocess.run([str(baseline),str(model),prompts["A"]],capture_output=True,
                                    text=True,timeout=120,check=True).stdout)
    require(disabled["experimental_compiled"] is False,"Disabled baseline has experimental feature")
    base=[r for r in runs if r["mode"]=="baseline"]
    caps=[r for r in runs if r["label"] in ("A","B")]
    require(all(r["final_token_ids"]==disabled["final_token_ids"] for r in base+caps),"Ordinary generation token regression")
    require(states["A"].vector_hash==states["B"].vector_hash,"Identical prompts were not stable")
    require(states["A"].vector_hash!=states["C"].vector_hash,"Unrelated prompt state did not change")
    require(runs[-1]["regression_exact_logits"] is True and runs[-1]["malformed_bounds_checked"] is True,"Native regression/bounds checks failed")
    require(states["recur"].cycle==2 and runs[-2]["intermediate_text_generated"] is False,"Two-cycle/no-intermediate-text contract failed")
    require(states["recur"].vector_hash!=states["A"].vector_hash,"Second latent state did not change")
    require(runs[-2]["final_decoded_bytes"]>0,"Second-pass final decode failed")
    # Compare to the pre-existing ordinary generation executable, not just our new builds.
    original=subprocess.run([str(root/"engine/norama/norama-generate.exe"),str(model),"4",prompts["A"],
                             "--plain","--resident"],capture_output=True,timeout=120,check=True)
    expected=subprocess.run([str(root/"engine/norama/norama-tokenizer.exe"),str(model),"--decode",
                             *map(str,disabled["final_token_ids"])],capture_output=True,timeout=30,check=True)
    require(original.stdout==expected.stdout,"Existing production generation output differs")
    require(hash_file(original_worker)==worker_hash,"Production worker changed during test")
    require(all(hash_file(root/p)==h for p,h in source_hashes.items()),"Experiment source changed during test")
    require(verify_build(root,args.binary_directory)==build_evidence,"Build evidence changed during test")
    require(hash_file(model)==model_hash,"Model weights changed during test")
    for flag in ("--wrong", ""):
        failed=subprocess.run([str(probe),str(model),"capture",prompts["A"],str(args.output/"invalid.f32"),flag],
                              capture_output=True,text=True,timeout=10)
        require(failed.returncode!=0 and not (args.output/"invalid.f32").exists(),"Malformed experiment flag did not fail safely")
    summary={"raw_vector_capture":"PASS","true_latent_recurrence":"PASS_TECHNICAL_TWO_PASS_ONLY",
             "recurrence_input_support":"B_SMALL_ENGINE_CHANGE_IMPLEMENTED",
             "model_id":"llama3.2-3b-instruct","hidden_size":states["A"].hidden_size,
             "cosine_A_B":states["A"].cosine(states["B"]),"cosine_A_C":states["A"].cosine(states["C"]),
             "deterministic_vector_bytes_equal":True,"disabled_baseline_token_ids_equal":True,
             "preexisting_normal_generation_bytes_equal":True,"production_worker_sha256":worker_hash,
             "source_hashes":source_hashes,
             "binary_hashes":build_evidence["binary_hashes"],"build_evidence":build_evidence,
             "model_sha256":model_hash,"model_bytes":model.stat().st_size,
             "baseline_median_latency_seconds":statistics.median(r["latency_seconds"] for r in base),
             "capture_median_latency_seconds":statistics.median(r["latency_seconds"] for r in caps),
             "disabled_build":disabled,"runs":runs,
             "limitations":["No intelligence or semantic proof","Identity hidden-to-input reinjection is untrained",
                            "CUDA high-water excludes driver/context/other apps","Only four generated tokens; noisy small benchmark",
                            "Raw input starts at next KV position, not a replacement for the whole context",
                            "No production HTTP/UI/Knights integration; experiment only"]}
    with (args.output/"results.json").open("x",encoding="utf-8") as handle:
        json.dump(summary,handle,indent=2)
    print(json.dumps({k:v for k,v in summary.items() if k not in ("runs","disabled_build","source_hashes","binary_hashes","build_evidence")}))

if __name__=="__main__": main()
