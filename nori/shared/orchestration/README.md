# NORI orchestration

The orchestration layer owns worker registration, task planning, approval boundaries, and audit events. Inference engines are adapters behind the NORI model-service contract.

Every Knight is governed by `NORI-NATIVE-WORKER-STANDARD.md`. A reference
repository, fork, package rename, or mocked test does not make a Knight
functional. The registry exposes only implementations that have passed the
native readiness gate.

Run `knight_readiness.py` to emit the declared machine-readable status. Release
verification can use `--require-all-native` as a hard gate; it intentionally
fails until every Knight has passed its capability evidence.

## Round Table service

`knight_service.py` is NORI's loopback-only service host. It activates the
edition-specific roster in one shared process, exposes `/health` and
`/v1/knights`, and accepts typed `/v1/dispatch` requests. It does not create a
separate resident large model for every Knight. The shared local model service
is supplied explicitly at start-up, while each request remains routed through
the named Knight contract, policy evaluator, and audit stream.

The source host is not evidence that it is deployed. Deployment requires the
host to be staged into a Home, Server, or Robotics image, configured for that
edition, started by its local service manager, and confirmed through its live
health endpoint. The readiness report keeps those states separate.

## Knights runtime

`knight_runtime.py` connects implemented Knight proposal roles to NORI's local model HTTP API. Construct it with a literal loopback endpoint, an explicit model id, a Policy granting plan and infer, and an audit file; then call `configure_edition("home")`, `configure_edition("server")`, or `configure_edition("robotics")` before `run(task)`. The runtime validates the roster, clears workers from a previous edition, and registers only implemented roles assigned to the selected edition. `enable_architect()` remains available for compatibility. Unsupported capabilities, planned roles, or missing grants are denied before inference. HTTP redirects and environment proxies are disabled.

The compatibility `run()` surface returns model-generated proposals and never
executes tools. The native Architect uses `run_architect()` with a bounded,
typed dependency graph. It validates all node identifiers, capabilities,
dependencies, and cycles before dispatch, then routes each ready node through
the edition-aware Knight boundary. Failed nodes block their dependents while
independent branches continue, and every graph and node outcome is audited.

The Council graph is a NORI-owned implementation. Reference projects remain
provenance and design research; they are not the executing orchestration layer.

`knight_registry.py` validates that the complete twelve-role roster is present,
rejects duplicate or unknown roles, applies Home/Server/Robotics role profiles,
and exposes only roles with a NORI-native implementation status. A planned
reference cannot become executable simply because it is listed in the roster.
Worker capabilities and permissions come from this registry rather than a
second runtime definition. Edition profiles determine which of the twelve
native foundations can receive work.

`CAPABILITY_OVERLAP` is the intentional fallback authority map. It currently
allows Neo to support Morpheus's read-only IDE contract, Oracle to support
Keymaker's research-report contract, and Machine to support Tank's read-only
hardware contract. Resolution keeps the declared candidate order and requires
both edition activation and the contract permission. The capability's bounded
typed implementation remains unchanged, and dispatch reports whether fallback
was used. Robotics, motion, and actuator requests are reserved for Watchman and
are rejected at the Knight boundary.

`COLLABORATION_GRAPH` defines the wider peer team for every Knight capability.
Each contract names one lead, eligible backups, independent reviewers, and
supporting contributors. Edition filtering removes unavailable peers without
granting extra authority. This lets Knights share adjacent work and recover
from failures while keeping one owner for the typed result and one clear audit
trail.

## Task graphs

`TaskGraph` accepts TaskNode records with stable ids, capabilities, dependencies, and token budgets. It rejects missing dependencies, duplicate ids, and cycles before calling workers. Nodes run sequentially in dependency order. Completed predecessor proposals are passed as reference data to successors. A failed or denied node blocks its dependents while independent nodes may continue. Node and graph outcomes are audited. Graph completion means the requested generations returned; it does not certify factual accuracy or execute proposed changes. Persistence/resume of interrupted graphs and tool execution are not implemented yet.
