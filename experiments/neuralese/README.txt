NORI NEURALESE PHASE 1 — ISOLATED RESEARCH, DISABLED BY DEFAULT

Production Norama workers are NOT rebuilt or replaced by this experiment.
Compile-time NORI_EXPERIMENTAL_NEURALESE enables the raw-vector API only in a
separate experimental binary. The probe ALSO requires --experimental-neuralese.
The normal runtime has no new HTTP endpoint, UI toggle, Council/Knights wiring,
training, context-budget change, installed application change, or cloud call.

Build from this directory using existing MSVC/CUDA only:
  powershell.exe -NoProfile -File .\build.ps1 -BuildDirectory builds\my-fresh-build
The directory must not exist. This creates neuralese-baseline.exe WITHOUT the
compile-time feature and neuralese-probe.exe WITH it. Neither replaces an old
binary. No dependencies or model weights are installed or downloaded.

Validate with a NEW result directory, explicitly opting into the experiment:
  python.exe -B validate.py --experimental-neuralese --binary-directory builds\my-fresh-build --output C:\Users\Studio\Documents\NORI_validation\my-new-neuralese-run
Unit tests:
  python.exe -B -m unittest discover -s . -p "test_*.py" -v

Tensor capture:
Input IDs -> embedding gather -> 28 transformer blocks -> final-token residual
-> final RMS normalization -> GPU float32 snapshot (3072 values for the tested
model). This is the hidden representation INPUT to the vocabulary projection,
not logits, a RAG embedding, a text scratchpad, or another English prompt.
One GPU source allocation is checked, copied synchronously into bounded RAM,
and released with the existing CUDA operation. Maximum 8192 floats/32 KiB per
tap; one capture per tap. This model's saved vector is 12288 bytes. Binary .f32
files and bounded metadata are written ONLY in the explicit experiment results.
Full vectors are never printed into runtime or production logs.

Technical recurrence:
First pass captures H0 without vocabulary projection or text/token generation.
Identity reinjection sends those 3072 floats directly to the next transformer
pass as one activation position, using the original session's retained KV cache.
Second pass computes a new hidden state and projects logits. Only then does the
experiment greedily generate/decode up to four final output tokens.
There is no hidden-to-token conversion between passes and no invented adapter.
Output-normalized residuals are not trained input embeddings: this establishes
an executable raw-vector recurrence primitive, NOT useful cognition, improved
reasoning, semantic equivalence, or a trained Neuralese controller.

NoriLatentState owns the independent public representation, finite float32
values, cycle, token-count provenance, timestamp, SHA256, and immutable metadata.
Its allocation metadata describes GPU preference, RAM fallback, high priority,
evictability, bytes, lifetime and Nori ownership. It is NOT Unified Fabric.
The future controller Protocol and ControllerResult are interfaces only.

Measurements:
TTFT/latency exclude model load; load time is reported separately. Decoding is
greedy/deterministic (no stochastic sampler or seed). Tokens/sec counts the
three post-first-token decoding intervals of a four-token run. CUDA high-water
counts instrumented Norama cudaMalloc bytes, excluding driver/context and other
applications. Windows peak working set measures process RAM. Free CUDA bytes
are checked before/after model+session teardown. Short runs are noisy, not a
performance claim; one A/B/C comparison is a sanity check, not semantic proof.

Next work requires designed/trained recurrence adapters/controllers, positional
and cache semantics validation, task-level evaluation and longer benchmarks.
Do not wire this into production or label imported model weights as Nori-trained.
