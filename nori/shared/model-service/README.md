# NORI Seth — model runtime

Seth is the owner-selected runtime name, superseding Matrix and Forge. Genesis names the model family;
Nexus names the connected-device platform. Existing nori-model-service commands
and API identifiers remain stable while the implementation develops.

NORI owns the local request API, model selection, request limits, and audit events. The optional llama.cpp engine supplies inference through structured HTTP responses. Ollama is not required.

The current API is a loopback service boundary. It accepts requests only when
the HTTP Host identifies its exact loopback address and port. Browser requests
must also be same-origin, and every POST must use `application/json` with one
valid decimal Content-Length. Cross-origin, cross-site, DNS-rebinding-style,
ambiguous-length, and non-JSON requests are rejected before model or lifecycle
work begins. Responses disable caching, MIME sniffing, and framing. These local
checks do not replace the certificate-based identity and authorization required
before Nexus exposes Seth across devices.

Set NORI_LLAMA_SERVER to a llama-server executable and NORI_MODEL_DIR to an existing directory of GGUF models. Set NORI_DEFAULT_MODEL to a discovered filename, or send the model field on each request. Start with python nori_model_service.py. The public service binds to 127.0.0.1 on NORI_MODEL_PORT (default 9391).

POST /v1/chat accepts model, prompt, and max_tokens (1..4096). It returns model and response. One authenticated loopback engine process is retained for the loaded model. Subsequent requests health-check and reuse it; model changes or a failed health check replace it. Failed generation clears the engine for the next request. Console output is excluded from responses. The current engine uses CPU execution and a 2048-token context. Oversized contexts or model load failures can still cause engine errors. Resource limits per machine and OS-level supervision remain future work. Normal service exit and explicit adapter close stop the engine; force-killing the parent process still requires OS-level process-group containment to guarantee child cleanup.

GET endpoints: /health, /v1/models, /v1/runtime, /v1/capabilities, /policy, /hardware, /audit. Model discovery is a file inventory, not a guarantee that the engine can load a model. Capability chat=true means the executable and model inventory are configured; actual loading is exercised by a generation or explicit load request. No placeholder model is advertised when the directory is missing.

POST /v1/models/load accepts exactly {"model":"filename.gguf"}. POST
/v1/models/unload accepts an empty JSON object. Both share the generation slot:
an overlapping lifecycle or generation request returns 429 instead of interrupting
the current operation. Successful calls return runtime state and record audit
events. GET /v1/runtime reports loaded/unloaded, or busy while an operation holds
the engine lock. Loaded state reflects the last successful load and a live process;
it is not a fresh engine health probe. The NORI API itself is loopback-only and
does not yet implement authenticated cross-device access.

Use shared/tests/test_live_lifecycle.py with --model-dir, --model, --engine and
--output to verify explicit load, repeat-load reuse, generation, unload process
exit, reload and audit ordering against existing local weights. This checks
integration, not reasoning quality.

POST /v1/models/preflight accepts exactly {"model":"filename.gguf"} and starts
no engine. It reports file size, total/available physical RAM, current runtime
state, engine configuration and unaccounted memory costs. It returns a conservative `plan` with a decision. NORI counts the model
file, runtime overhead, context reserve, and operating-system reserve. A load
or generation starts only when the decision is `admitted`; unavailable or
insufficient available-memory measurements refuse the request. The calculation
is deliberately cautious but does not replace model-specific profiling, GPU
memory checks, container limits, or review of other active workloads.

Load/unload and generation exceptions now append a failed audit event with a
stable reason code, excluding raw engine errors and prompts. If the audit write
also fails, the API reports audit_unavailable. Failure to write the initial event
prevents engine work; a failure writing the completion event can occur after the
operation has already run, so clients must inspect runtime state before retrying.
The generation slot is released in either case. The audit file is not yet a
durable transactional journal or crash-consistent operation ledger.

Failure-injection coverage is in shared/tests/test_model_failure_recovery.py.
The live lifecycle test also supplies an invalid GGUF in a temporary model folder,
verifies engine cleanup and a failed audit record, then loads the valid model.
Windows evidence: ../../Logs/live-model-failure-recovery.json. Rebuilt Linux
BIOS guest evidence: ../../Logs/server-bios-failure-recovery.json and its serial
log. The guest verifies invalid-model rejection, failed audit metadata, engine
cleanup and valid-model inference afterward. It uses a disposable image and does
not test the installer or physical hardware.

Use shared/tests/test_live_model.py with --model-dir, --model and --engine for an opt-in real inference test. It requires pre-existing weights and does not download anything. It checks three real requests: initial load, reuse of the same engine PID, and recovery after terminating that owned engine. It then closes the engine. Distribution licenses and supported hardware must still be checked before packaging these models into an OS release.
Desktop conversation history: `/v1/chat` accepts optional `history`, an array of
complete alternating user/assistant message pairs (`role`, `content`). It allows
up to 32 messages within the existing 64 KiB request limit. The current `prompt`
is appended as the final user turn. History is request-scoped, not persisted or
shared between clients. The desktop keeps up to eight successful exchanges in
memory and removes oldest pairs from requests that exceed its payload budget.
This does not yet implement token-aware context management or long-term memory.

### Memory admission policy

Before starting a CPU-backed local model, Seth now derives a conservative,
inspectable memory plan. It counts the GGUF file, runtime overhead, a context
reserve, and 1.5 GiB reserved for the operating system. `POST
/v1/models/preflight` returns the plan and its decision. Load and generation
are refused unless the decision is `admitted`; an unavailable RAM measurement
is not treated as permission to risk an unstable system.

The budget is a guardrail, not a performance promise. GPU memory, model-specific
KV-cache dimensions, container limits, and other workloads can still require a
stricter production profile.
