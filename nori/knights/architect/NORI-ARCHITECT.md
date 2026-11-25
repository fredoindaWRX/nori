# NORI Architect development fork

The new NORI-owned package lives in `lib/nori-architect`. It implements explicit
roles, capability validation, dependency-ordered proposals, permission checks,
failure propagation and metadata-only audit events. It calls NORI's `/v1/chat`
API locally and has no Ollama, CrewAI runtime, cloud SDK or telemetry dependency.

This is an early implementation, not a completed conversion of the upstream
repository. The original CrewAI source and MIT license remain present and
attributed. The shared NORI runtime has not yet migrated to this package.
Generation completion is not factual verification or tool execution.

Install this package with `python -m pip install ./lib/nori-architect`. Then run:

```powershell
nori-architect lib/nori-architect/examples/review.json --endpoint http://127.0.0.1:8766 --model qwen2.5-coder-14b.gguf --audit architect-events.jsonl --allow-role planner --allow-role reviewer
```

Use the actual port of a running NORI model service. No model downloads occur.
Without explicit role grants, tasks are denied and dependents are blocked.
Audit storage must be writable; failures stop execution. Each run should use its
own audit file: cross-process audit locking, resumable graphs, streaming, tool
execution and full upstream rebranding remain unfinished.

## OS deployment admission

The CLI accepts `--edition home|server|robotics` (default `home`). Each role
may specify a `knight` identity; omitted identities use `architect`, so planner
and reviewer subroles remain Architect tasks. Task `workload` is `interactive`
by default or `batch`. The edition comes from the launcher/CLI, not the graph.

- Home permits proposal scheduling for all 12 identities.
- Server excludes Morpheus because its IDE integration needs a desktop.
- Robotics excludes Morpheus and Apoc; Keymaker requires batch scheduling.
- Robotics Trinity requests have a maximum 128 output-token budget. Requested
  and effective budgets are audited. This is an initial lightweight inference
  constraint, not a full memory/CPU/plugin footprint limit.

Edition eligibility never grants role permission, installs a Knight, or marks
an upstream implementation available. The current executor still generates
local proposals. Upstream Knight endpoints and automatic hardware sizing remain
to be implemented. Unknown editions, identities and workload classes fail
validation; unsupported deployments are denied without a model call or remote
fallback. Dependencies on denied tasks are blocked.

Robotics Watchman remains a separate, unfinished actuator boundary. These
proposal profiles neither grant motor access nor offer real-time guarantees.

## Explicit worker dispatch

`Architect(..., workers={knight_id: WorkerBinding(...)})` binds a Knight to a
trusted proposal implementation. Each binding declares supported capabilities
and receives a `WorkerRequest` containing graph/task IDs, role instructions,
task instructions, predecessor proposals, and the effective token limit.
The callable returns a nonempty proposal string. This interface currently
supports proposal generation only; bindings must not execute side effects.

Only Architect receives the built-in local-model binding. Other Knights without
a binding return `unavailable` with `worker_not_registered`; their dependents
are blocked. A graph's role declaration cannot add a capability missing from
the implementation. Explicit role permission and OS admission are checked
before any worker call. Worker exceptions produce failed nodes without falling
back to another Knight. Independent graph branches can still run.

Bindings are supplied by application code, not imported from graph/model text.
The dispatch tests use separate test
implementations; they do not establish that Neo, Oracle, or the other upstream
forks are operational. In-process bindings are trusted code, not a sandbox;
in-process timeouts and OS sandboxing remain unfinished.

## MCP stdio transport (0.1.0.dev4)

Install `nori-architect[mcp]` for the optional official MCP Python SDK
dependency, pinned to tested version 1.30.0. The base package remains free of
runtime dependencies. SDK reference: https://github.com/modelcontextprotocol/python-sdk/tree/v1.x

`MCPProposalWorker` accepts a known Knight ID, existing absolute executable,
argument list, declared capabilities, exact tool name, and per-request timeout.
Its `binding()` plugs into Architect. Configuration comes from trusted host
code. Each dispatch launches a stdio process, initializes MCP, discovers the
configured tool (at most 16 pages), calls it, validates its structured response,
and closes the session/process. No shell command string or arbitrary tool name
comes from a graph. The SDK controls process lifecycle and limited default
environment inheritance. No persistent worker pooling is implemented yet.

The tool takes `request: WorkerRequest` as a JSON object and must return
structured content with matching `knight`, matching `task_id`, and nonempty
`proposal`. Text-only JSON, tool errors, and mismatched identities are rejected.
Timeouts are per protocol request, not a single graph deadline. This launches
trusted code with normal OS permissions; it is not a security sandbox.

The `nori-architect-mcp --endpoint ... --model ...` server exposes the actual
NORI local proposal path for Architect's plan/review/orchestration capabilities.
It performs inference only. Other Knights still require their own adapters.
A2A, remote authenticated transports, OS-level resource isolation and Watchman
remain unfinished.

Verification: 13 tests passed with the MCP extra, including real stdio success,
wrong response task ID, tool failure, missing tool and timeout; fixture child
process exit was checked after each case. A separate live check routed an
Architect task through its MCP process into NORI HTTP and the installed Qwen
model, returning exactly `4` for `2 + 2`, with both audit layers recorded in
`NORI/Logs/architect-mcp-live.json`. This proves the transport/inference path,
not general reasoning accuracy or other Knight implementations.

## Host worker configuration (0.1.0.dev5)

The CLI accepts `--workers host-workers.json`. That separate host-owned file
contains executable configuration; it must not be sourced from model output,
attachments, or untrusted graphs. Roles and tasks stay in the graph file.

```json
{
  "version": 1,
  "workers": [{
    "knight": "architect",
    "command": "C:/path/to/venv/Scripts/python.exe",
    "args": ["-m", "nori_architect.mcp_server", "--endpoint", "http://127.0.0.1:8766", "--model", "qwen2.5-coder-14b.gguf"],
    "capabilities": ["plan", "review", "orchestration"],
    "tool": "nori_propose",
    "timeout": 120
  }]
}
```

Replace the executable and service endpoint with the actual installation. The
selected interpreter must have `nori-architect[mcp]` installed. Example invocation:

```powershell
nori-architect graph.json --workers host-workers.json --edition home --audit run.jsonl --allow-role planner --allow-role reviewer
```

No local fallback model arguments are required for a workers-only deployment.
If supplied, `--endpoint` and `--model` must appear together. Explicit Architect
worker configuration takes precedence over the local model binding.

All host entries are validated before task execution. Duplicate Knights/JSON
keys, unsupported fields, nonabsolute executables, invalid timeouts and invalid
capability/argument lists are rejected. Each CLI audit event contains the SHA-256
of the exact host configuration bytes read; command arguments are not logged.
This digest provides provenance, not signing or file-tamper prevention.

Fifteen tests pass with MCP installed, including actual CLI-to-MCP dispatch and
verification that a denied role does not launch the configured process.
