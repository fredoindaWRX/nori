"""Fail-closed experiment evidence checks; never disabled by python -O.

Build hashes bind an owned recipe to sources and outputs. They are evidence of
the local build, not signatures or a sandbox against a malicious same-account
writer. No fixtures from this module qualify real model cognition.
"""
from hashlib import sha256
import json
import math
from pathlib import Path
import re

class EvidenceError(ValueError):
    pass

def require(condition, message):
    if not condition:
        raise EvidenceError(message)

def hash_file(path):
    digest=sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(1024*1024), b""):
            digest.update(block)
    return digest.hexdigest()

def load_bounded_json(path, maximum=65536):
    path=Path(path)
    require(path.is_file() and path.stat().st_size<=maximum, "Missing/oversized evidence JSON")
    def duplicate_checked(pairs):
        result={}
        for name, value in pairs:
            require(name not in result,"Duplicate evidence JSON key")
            result[name]=value
        return result
    def invalid_number(_):
        raise EvidenceError("Nonfinite evidence JSON number")
    with path.open("rb") as handle:
        raw=handle.read(maximum+1)
    require(len(raw)<=maximum,"Evidence JSON grew beyond limit")
    return json.loads(raw.decode("utf-8-sig"),object_pairs_hook=duplicate_checked,parse_constant=invalid_number)

def source_files(root):
    root=Path(root).resolve();engine=root/"engine/norama/src";experiment=root/"experiments/neuralese"
    # Conservative closed inventory of local engine headers and these compilation
    # units. Unrelated worker/training source is not a build input for this probe.
    return sorted(set([*engine.glob("*.hpp"),*engine.glob("*.cuh"),
                       engine/"gpu_engine.cu",engine/"resident_matrix.cu",
                       experiment/"probe.cu",experiment/"baseline.cu",experiment/"build.ps1"]))

def source_hashes(root):
    root=Path(root).resolve()
    return {str(path.relative_to(root)):hash_file(path) for path in source_files(root)}

def verify_build(root, binary_directory):
    root=Path(root).resolve();experiment=root/"experiments/neuralese"
    directory=Path(binary_directory).resolve()
    require(directory.is_relative_to(experiment.resolve()) and directory!=experiment.resolve(),
            "Build evidence must be in a separate directory inside the experiment")
    manifest=load_bounded_json(directory/"build-evidence.json")
    fields={"schema_version","kind","project_root","build_directory","created_at",
            "source_hashes","binary_hashes","compiler","recipes"}
    require(type(manifest) is dict and set(manifest)==fields,"Invalid build evidence fields")
    require(type(manifest["schema_version"]) is int and manifest["schema_version"]==1
            and manifest["kind"]=="nori-neuralese-build","Unsupported build evidence")
    require(Path(manifest["project_root"]).resolve()==root and Path(manifest["build_directory"]).resolve()==directory,
            "Build belongs to a different project or output directory")
    require(manifest["source_hashes"]==source_hashes(root),"Executable is stale: build source hashes differ")
    binaries=manifest["binary_hashes"]
    require(type(binaries) is dict and set(binaries)=={"neuralese-baseline.exe","neuralese-probe.exe"},
            "Invalid measured binary inventory")
    for name, expected in binaries.items():
        require(type(expected) is str and re.fullmatch("[0-9a-f]{64}",expected),"Invalid build binary hash")
        binary=directory/name
        require(binary.is_file() and binary.resolve()==binary.absolute(),"Missing or redirected experiment binary")
        require(hash_file(binary)==expected,"Measured executable differs from build output")
    compiler=manifest["compiler"]
    require(type(compiler) is dict and set(compiler)=={"cuda_path","cuda_sha256","setup_path","setup_sha256"},
            "Invalid compiler evidence")
    for kind in ("cuda","setup"):
        require(hash_file(compiler[kind+"_path"])==compiler[kind+"_sha256"],"Build tool changed since compilation")
    require(type(manifest["recipes"]) is dict and set(manifest["recipes"])=={"baseline","probe"},
            "Missing build recipes")
    require("-DNORI_EXPERIMENTAL_NEURALESE" in manifest["recipes"]["probe"]
            and "-DNORI_EXPERIMENTAL_NEURALESE" not in manifest["recipes"]["baseline"],
            "Feature-enabled/disabled recipes do not match experiment contract")
    return manifest

def verify_run(metrics):
    require(type(metrics) is dict,"Metrics must be an object")
    for name in ("load_seconds","ttft_seconds","latency_seconds","decode_seconds","first_pass_seconds",
                 "cycle_2_seconds","tokens_per_second","total_process_seconds"):
        value=metrics.get(name)
        require(type(value) in (int,float) and math.isfinite(value) and value>=0,"Invalid timing metric: "+name)
    for name in ("hidden_size","layers","vocabulary","prompt_tokens","cycle","output_tokens",
                 "peak_owned_cuda_bytes","live_owned_cuda_bytes_after","cuda_free_before","cuda_free_after",
                 "peak_ram_working_set_bytes","final_decoded_bytes"):
        value=metrics.get(name)
        require(type(value) is int and value>=0,"Invalid integer metric: "+name)
    require(1<=metrics["hidden_size"]<=8192 and 1<=metrics["prompt_tokens"]<=128,"Metric dimensions out of bounds")
    require(metrics["live_owned_cuda_bytes_after"]==0,"Owned CUDA allocations did not drain")
    require(metrics["cuda_free_after"]>=metrics["cuda_free_before"],"CUDA free-memory regression after teardown")
    ids=metrics.get("final_token_ids")
    require(type(ids) is list and 1<=len(ids)<=4 and len(ids)==metrics["output_tokens"]
            and all(type(value) is int and 0<=value<metrics["vocabulary"] for value in ids),"Invalid final token evidence")
