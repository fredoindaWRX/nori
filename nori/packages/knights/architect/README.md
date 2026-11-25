# NORI Architect

The owner-goal entry point is `packages.knights.architect.agents.architect.ArchitectAgent`.
CrewAI plans the task graph; NORI validates and schedules it. Independent Knights execute
concurrently, while calls to the same Knight are serialized. Dependency failures block
only dependent tasks. A completed plan contains actual structured worker results.

## Wiring

Construct a Router and register each active Knight with a handler and its real request
contract. The handler accepts a request dict and returns a dict whose status is completed,
failed, denied, blocked, or cancelled. Fallbacks must use the identical contract.
Pass an authenticated-session authorization callback to ArchitectAgent. It is checked
before planning and every dispatch/restart and must return status FULL_ADMIN.
A public fingerprint alone is not proof of private-key possession: the host must verify
the session before supplying owner context. The existing Sentinel prototype is not a
complete production authentication system.

Call run(goal, owner_context, on_progress=callback). It returns run_id, goal, status,
per-task outputs and attempt history, and a completion report. progress(run_id) provides
a thread-safe snapshot during execution. Task dependencies establish execution order;
request payloads are explicit and are not automatically rewritten with earlier outputs.

The default TaskDecomposer uses CrewAI with local ollama/qwen3 at 127.0.0.1:11434.
Set model and base_url explicitly for another installed local model. A planner callable
can be supplied for offline deterministic tests. No hosted API key is required.

Recovery is capped at three attempts by default. Tasks must explicitly be retry_safe
before a retry or redirect is permitted. Set this only for operations safe to repeat.
Authorization denial never triggers a fallback. An optional restart callback integrates
a real process supervisor; without one recovery retries the handler, not a pretend respawn.

## Validation and deployment limits

Tests exercise parallelism, dependencies, recovery, denials, revocation, and malformed plans.
This package is an explicit API; the older shared ArchitectWorker and HTTP service have
not been switched to it. Register active worker handlers before deployment. Progress is
in memory; durable crash recovery is not implemented. Handlers must enforce their own
I/O deadlines. Python threads cannot forcibly terminate a stuck handler, and revocation
prevents subsequent work rather than terminating an already executing operation.
