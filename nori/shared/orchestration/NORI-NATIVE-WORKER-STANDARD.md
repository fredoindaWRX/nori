# NORI native Knight standard

This standard applies to every Knight before it can be presented as a working
part of NORI Home OS, NORI Server OS, or NORI Robotics OS.

## Identity and provenance

Each Knight has a NORI-owned name, package namespace, command surface,
configuration format, documentation, visual identity, and version. Reference
projects are design inputs and licensed foundations, not the shipped NORI
identity. Required upstream copyright, license, NOTICE, and source-offer terms
remain intact. A rename or copied directory never counts as a native
implementation.

## Native implementation requirements

Every Knight must provide:

1. A NORI-owned task contract with typed inputs, bounded outputs, cancellation,
   timeouts, and explicit failure states.
2. A NORI-owned control loop that runs through Architect and the Seth model
   runtime rather than requiring Ollama or a hosted provider.
3. Capability-specific tools with least-privilege grants, path and network
   boundaries, and Watchman enforcement for physical actions.
4. Structured events for request, plan, tool proposal, approval decision,
   execution, result, cancellation, failure, and recovery.
5. A health probe and restart path that prove the worker can recover from a
   failed model or tool process.
6. Edition profiles for Home, Server, and Robotics. Unsupported roles remain
   unavailable instead of silently falling back to a different worker.
7. Reproducible packaging, dependency inventory, retained license evidence,
   and tests that run without paid services.

## Functional readiness gate

A Knight may move from `planned` to `native` only when all of these pass on the
target edition:

- registry and configuration validation;
- one real successful task using its declared capability;
- permission denial with no tool side effects;
- cancellation or timeout;
- dependency failure and recovery;
- audit-event verification;
- package/install verification;
- edition boot or service-start verification.

Image, voice, browser, coding, research, memory, execution, device, and robotics
claims require the relevant real backend or hardware. A mocked response proves
the contract only; it does not prove the capability.

## Twelve Knight capability map

| NORI Knight | Reference foundation | NORI role | Required working capability |
|---|---|---|---|
| Neo | OpenHands | Code Smith | repository analysis, edits, commands, validation |
| Trinity | goose | All-Rounder | general tasks, automation, and data work |
| Morpheus | Cline | IDE Warrior | editor-aware coding and project navigation |
| Apoc | Browser Use | Scout | observable browser navigation and interaction |
| Oracle | Khoj | Librarian | private indexing, retrieval, documents, and vision retrieval |
| Merovingian | Letta | Chronicler | scoped persistent memory with deletion and export |
| Architect | CrewAI | Commander | planning, routing, dependencies, cancellation, and recovery |
| Keymaker | GPT Researcher | Scribe | cited research with source traceability |
| Smith | Open Interpreter | Executor | sandboxed code and command execution |
| Tank | Agent Zero | Steward | workspace, desktop, files, projects, and device adapters |
| Machine | LocalAI | Seth backbone | local model discovery, loading, inference, and lifecycle |
| Sentinel | OpenClaw | Watchdog | triggers, monitoring, identity, policy, and escalation |

The twelve roles may share models. They do not require twelve large models to
remain resident at once. Hardware profiling selects models and concurrency,
while the declared behavior and readiness gate stay the same.

## Per-Knight mutation acceptance criteria

These are requirements from the original NORI mutation plan. They supplement
the universal readiness gate above.

| NORI Knight | Required NORI-owned mutation |
|---|---|
| Neo | Rewrite the agent loop, use the Seth adapter, define NORI tools, and use the NORI workspace presentation. |
| Trinity | Replace the extension system with the NORI plugin API, prompts, and configuration format. |
| Morpheus | Rebuild the editor command surface and use NORI's provider and project-context layers. |
| Apoc | Define NORI browser actions, selector strategies, observable sessions, cancellation, and recovery. |
| Oracle | Select NORI embedding profiles, implement the retrieval pipeline, and provide NORI document and media parsers. |
| Merovingian | Implement NORI memory records, scope, retention, deletion, export, and bounded background consolidation. |
| Architect | Replace crew/task behavior with the NORI graph, role registry, routing, dependencies, cancellation, and recovery. |
| Keymaker | Implement the NORI research planner, source-evidence records, citations, and report templates. |
| Smith | Implement the NORI execution sandbox, supported runtimes, resource limits, and permission checks. |
| Tank | Implement the NORI workspace, project layout, desktop/file tools, and HAL device adapters. |
| Machine | Implement Seth model backends, NORI API routes, model lifecycle, retrieval, health, and hardware policy. |
| Sentinel | Implement the NORI event loop, triggers, on-device inference path, identity checks, monitoring, and escalation. |

Completion is recorded per row with source paths, tests, runtime evidence, and
the editions on which the capability was exercised. Until then the roster keeps
that Knight in `planned` state.
