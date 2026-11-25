NORLLAMA — OWN NATIVE SERVING PROTOTYPE
2026-09-30

Active root: C:\Nori\runtime\norllama.
NorLlama owns serving/session/resource policy. Its own Norama.cpp worker is under
C:\Nori\engine\norama. No Ollama API, llama.cpp binary, ggml inference library,
external tokenizer or cloud inference is used in this path. Windows/MSVC/CUDA/ICU
and Python are platform dependencies. Published transformer mathematics and the
imported model's architecture/format/tokenizer conventions are not our invention.

What works in the tested candidate
- One resident GPU worker reused across text requests; isolated per-request KV.
- Authenticated 127.0.0.1 HTTP, strict Host checks and no browser Origin/CORS.
- GET /health and /v1/models; POST /v1/chat (typed SSE or nonstream JSON).
- POST /v1/cancel with active request_id; POST /v1/shutdown with empty object.
- Strict UTF8/framing/terminal checks; bounded admission/deadlines/cancellation.
- Real desktop native client and Nori turn adapter receive generated replies.

Launch prerequisites
Existing Python3.11+,Windows built-in ICU,NVIDIA driver,rebuilt own worker,
and the configured licensed imported GGUF. config.json resolves worker/model
relative to the module-derived Nori root and refuses paths outside that root.
No runtime dependency installation or model downloading happens during launch.
One tested model: llama3.2-3b-instruct. Imported,NOT a trained Nori model.

Direct launch (same Windows account,private console)
Set NORI_RUNTIME_API_KEY to a cryptographically random private32..128-character
ASCII base64url-style key. Never paste the key into chats or commit it. Then run:
  python.exe -B C:\Nori\runtime\norllama\norllama.py
Default port11435;the startup message contains no key or conversation text.
There is no persistent key creation/rotation/ACL installer in this candidate.
Do not replace the phone/location or Council credentials with this runtime key.

Desktop chat client configuration (same private process environment)
  NORI_INFERENCE_RUNTIME=norllama
  NORI_RUNTIME_URL=http://127.0.0.1:11435
  NORI_RUNTIME_API_KEY=<the same private runtime key>
  NORI_RUNTIME_MODEL_ID=llama3.2-3b-instruct
  NORI_LOCAL_CHAT=1
The source desktop launcher now defaults to this route and creates its own
private key and ephemeral loopback service. Ollama requires explicit
NORI_INFERENCE_RUNTIME=ollama-rollback selection; there is no implicit fallback.
The installed executable has not been rebuilt or qualified. Do not claim
uninstalling rollback is safe. Native Core/Knights action dispatch is still
unavailable and fails explicitly instead of borrowing the legacy Council.
Native model choices show this actual model;Qwen/GPT-OSS selections are refused,
not mapped silently to Llama. Fast/Balanced/Deep are output style/budget controls,
not a certification of private reasoning effort or stronger-model escalation.

Current bounds
Prompt2048 tokens,output1..2048 tokens,up to64 text-only messages. Individual
message64KiB,total text240KiB,binary frame/output262144 bytes. Worker prefill
chunk128 tokens;cache admission maximum1GiB with512MiB free-GPU reserve.
One executing request,two waiting,queue wait5seconds,inference deadline120seconds;
at most8 HTTP handlers with3-second socket I/O timeout. GPU output events bounded
to64 backlog entries;slow/nonconforming consumers fail closed rather than grow.
These are prototype limits,not total process-memory or sustained-load guarantees.
Oversized context errors visibly;it is not silently summarized or truncated here.
The conversation layer in the desktop bridge keeps the system prompt and the
newest turn and drops whole oldest turns before a request reaches this runtime.
Cancellation drains terminal state before reuse;worker protocol/crash/nonquiescence
failure terminates only the owned worker and requires an explicit restart.
Per-request memory isolation is not a forensic secure-erasure guarantee.

Verification
From this directory:
  python.exe -B -m unittest discover -s tests -p test_norllama.py -v
Those16 tests use a clearly named fake protocol worker,not real model evidence.
Separate real-model/GPU probes:
  python.exe -B tests\actual_runtime_probe.py
  python.exe -B tests\actual_cli_probe.py
Probes use ephemeral unpublished keys,start only their owned processes and stop
them afterward. The normal CLI probe refuses to replace an occupied port11435.
See C:\Nori\verification\native-persistent-runtime-2026-09-30.txt for hashes,
commands,actual GPU results and remaining requirements.

Still required
Managed desktop startup and protected persistent configuration,native Knights,
model catalog/load/unload/selection for other architectures,vision/tools,speech,
stress/recovery/resource qualification,offline installer and cold-PC acceptance.
The original own-model-future-work statement is superseded by the experimental
development path below, not by assistant capability or production qualification.
The full39-group Nori roadmap and release remain NOT_VERIFIED.
F:\ recovery master,existing credentials/services and rollback remain preserved.

Own-model experimental service -- 2026-09-30
The scratch-trained DualTrace v0 weights now execute through our resident CUDA
worker and this same owned serving layer. They are NOT renamed imported weights.
GPU math is independent of PyTorch/Ollama/llama.cpp; training still uses named
PyTorch/NumPy dependencies. CUDA/MSVC/Windows remain platform dependencies.
This tiny25346-parameter development model is repetitive and NOT a useful assistant.
Default config.json,desktop routing,imported model provenance and tool gates stay
unchanged. Never claim this is a production replacement or expose it publicly.

Explicit private launch (after setting your own ephemeral runtime key above):
  python.exe -B C:\Nori\runtime\norllama\norllama.py --config C:\Nori\runtime\norllama\dualtrace.experimental.json --experimental-own-model
Use --port0 for an automatically assigned loopback port. Use --supervised only
when a launcher owns the runtime's stdin pipe;an interactive console isn't one.
The config names the verified local .ndt development checkpoint and separate
norama-dualtrace-worker.exe. Both stay under C:\Nori;no downloads on startup.
Own architecture must pass its NDT0 handshake512prompt/256output contract.
Model ID:nori-dualtrace-v0-development. GET /health and /v1/models identify
nori_trained_model=true,imported_weights=false,experimental=true and
assistant_qualified=false. Provenance linkage/checksums aren't signed authorship.
POST /v1/chat returns409 in this profile,preventing accidental normal-client use.
POST /v1/experimental/chat accepts the existing text-only model_id/messages/
max_tokens/stream fields. It has the same auth,Host/Origin,bounded admission,
deadlines,SSE/cancellation and owned-worker lifetime rules as the normal service.
No JSON/contract/tool/vision support in this model;unsupported requests fail.
Byte prompt:BOS+[role]\ncontent\n for each message+[assistant]\n. This is explicit
development framing,NOT an instruction-trained template or a security boundary.
Combined prompt/generation512token cap;UTF8 byte count,not character count.
Graph allocation report excludes CUDA context/driver overhead and host memory.

Supervised runtime now uses cancellable Windows pipe polling with stop/join,
not a daemon blocked inside Python's buffered stdin read. Authenticated HTTP
shutdown and owner EOF both stop the GPU worker;full tests include this path.
Actual acceptance:
  python.exe -B C:\Nori\runtime\norllama\tests\actual_dualtrace_service_probe.py
Separate native-score parity:
  C:\Nori\nori\.venv-architect\Scripts\python.exe -B -m training.nori_foundation.test_native
See verification/own-nori-service-2026-09-30.txt for exact source/binary/receipt
identities,observed shutdown failure/fix and remaining larger-training gates.
