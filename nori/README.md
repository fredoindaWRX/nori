# N.O.R.I. Round Table

Local development launcher for twelve worker services. Sentinel starts first; every subsequent worker waits for its predecessor's HTTP listener. The native supervisor stops workers in reverse order, Sentinel last, and tears down the council if a worker exits. Docker Compose uses the same dependency order on startup and shutdown. Independent container restarts do not provide council-wide failure handling.

## The twelve, in startup order

| Knight | Role | Desktop model | Port |
| --- | --- | --- | --- |
| sentinel | Watchdog | qwen3:8b | 9112 |
| architect | Commander | qwen3:8b | 9107 |
| machine | Seth backbone | qwen3:8b | 9111 |
| merovingian | Chronicler | qwen3:8b | 9106 |
| oracle | Librarian | gemma4:12b | 9105 |
| tank | Steward | qwen3:8b | 9110 |
| smith | Executor | qwen3:8b | 9109 |
| neo | Code Smith | qwen2.5-coder:14b | 9101 |
| trinity | All-Rounder | qwen3:8b | 9102 |
| morpheus | IDE Warrior | qwen2.5-coder:14b | 9103 |
| apoc | Scout | qwen3:8b | 9104 |
| keymaker | Scribe | qwen3:8b | 9108 |

Model assignments retain Fredo's 32 GB RAM / RTX 4080 SUPER 16 GB desktop profile. Twelve services share inference capacity; this does not load twelve large models simultaneously. Ollama permits one loaded model and one concurrent inference request. Docker uses CPU by default; native Ollama is the existing GPU development path.

## Install and activate locally

Use Python 3.12 for the container environment. The launcher itself uses the standard library. Docker Desktop must be running in Linux container mode for Compose. Run commands from this directory (`C:/Cortana/nori`). GNU Make is optional; equivalent commands appear below.

Development activation is a shared API secret, not product licensing or TPM enrollment. In PowerShell:

```powershell
$env:NORI_API_TOKEN = python -c "import secrets; print(secrets.token_urlsafe(48))"
python main.py --check
python -m unittest discover -s tests_startup -v
python main.py
```

Keep the secret private. This environment variable lasts for the current terminal; use a private secret store for persistent deployment. `NORI_OWNER_FINGERPRINT` may be set to an already verified owner fingerprint. Leaving it unset renders an unbound owner in the prompt. Setting it is not proof of ownership.

Start native Ollama first and ensure the configured models are installed. For containers instead:

```powershell
docker compose config --quiet
docker compose build
docker compose up -d
```

Do not run native and container workers on the same ports simultaneously. Stop native Ollama before exposing container Ollama on port 11434. Container model storage is separate from native Ollama:

```powershell
docker compose exec ollama ollama pull qwen3:8b
docker compose exec ollama ollama pull qwen2.5-coder:14b
docker compose exec ollama ollama pull gemma4:12b
docker compose exec ollama ollama pull embeddinggemma
```

Models must exist in the chosen Ollama registry. A missing model leaves `/health` degraded; it does not prevent a listener from starting. `/live` checks only the worker listener. Compose health checks use `/live`, not model readiness. Read `/health` before inference.

## Interface and storage

Each worker offers `GET /live`, `GET /health`, authenticated `POST /chat` with `{"goal":"your request"}`, and authenticated `POST /task` for that worker's existing typed runtime payload. Send `Authorization: Bearer <NORI_API_TOKEN>`. `/chat` generates text and does not run tools. Tool mappings and grants are in `config.yaml`, which uses JSON syntax valid as YAML 1.2.

Worker data is stored in `runtime-data` natively and separate persistent Docker volumes in containers. Ollama, Letta, and ChromaDB also have persistent volumes. All published ports bind to localhost. LocalAI remains available through the optional `localai` Compose profile.

ChromaDB and Letta are provisioned services here; this launcher does not automatically connect all standalone knowledge and memory packages to them. See package-specific integration code before ingesting documents.

## Remote access

Tailscale is optional: set `TS_AUTHKEY` privately, then run `docker compose --profile remote up -d tailscale`. State persists in its volume. The container uses userspace networking, with no host network privileges. This joins a tailnet; it does not automatically expose worker APIs or proxy localhost. An authenticated gateway and explicit tailnet routing/Serve configuration remain integration work. No remote access was activated by creating these files.

Reference: [Tailscale container settings](https://tailscale.com/docs/features/containers/docker/docker-params), [Chroma Docker storage](https://docs.trychroma.com/guides/deploy/docker).

## Make targets

- `make build`: build the worker image.
- `make run`: run the native supervisor.
- `make test`: run startup tests.
- `make check`: validate configuration and Compose syntax (API secret required).
- `make deploy`: validate, test, build, then start containers.
- `make stop`: stop containers without deleting data volumes.
- `make logs`: follow container logs.

## Covenant and current boundaries

All workers load `prompts/covenant.md`, substituting their name and configured owner fingerprint. The covenant expresses their purpose, judgment, delegation, and reporting behavior. It is a prompt, not cryptographic authorization.

This entry point currently launches `shared/orchestration/knight_runtime.py`, not all standalone `packages/knights` implementations. The common bearer check runs at each worker; requests do not yet traverse a central Sentinel gate. TPM-backed Ed25519 enrollment, immutable Letta binding, integrated kill-switch enforcement, and end-to-end autonomous agent cooperation are not established by this launcher. Do not treat this development stack as the finished NORI OS or a remotely hardened production service.

The Dockerfile uses a non-root worker user and copies only runtime files, not personal documents or local credentials. Validate a full live container run before shipping. Image tags are development defaults; pin reviewed image digests for a reproducible release.

## Shared message bus

bus.py provides twelve in-process priority queues. Attach a trusted asynchronous Sentinel adapter implementing check(message) and log_denial(message). send returns True for delivery and False for denial; missing Sentinel or check failure raises without delivery. Priority 5 precedes priority 1; equal priorities retain arrival order. receive consumes a single message. Agent labels do not authenticate the caller. This bus is not yet wired into main.py: separate worker processes/containers cannot share asyncio queues. Cross-process transport and the Sentinel adapter remain required for deployment.

### Shared handoff tool

The host creates a separate tool closure for each in-process Knight:

```python
from bus import AgentName
from tools.handoff import make_handoff

handoff = make_handoff(bus, AgentName.ARCHITECT)
result = await handoff("neo", "Review the installer", {"file": "installer.py"})
```

Register the returned function with that agent's tool registry. The sender is bound by the host; callers supply only recipient, task and context. Sentinel denial returns an explicit denial; gate failures propagate. Successful delegation means queued, not completed. This tool is not yet registered in the separate live worker services.

### Task-name routing

`orchestration/router.py` exposes `await route(task, classify=None, timeout=15)`. It selects a recipient; it does not execute or send the task. Whole-word keyword matches select specialists before generic verbs. Ambiguous or unmatched tasks use the host-supplied asynchronous classifier when available. Missing, timed-out, disconnected, or invalid classification returns Trinity; authorization errors propagate. The classifier must enforce Sentinel authorization and return an actual Machine model result, not the boolean from bus.send. Live Machine request/reply integration remains outstanding. Architect's existing package execution router is unchanged.
`n### Glucose workflow simulation`nRun `python -m examples.glucose_workflow` from this directory. Uses the existing Architect dependency scheduler with simulated handlers. A (sensor fixture) and C (mock artifact) are independent; B waits for A; D waits for A/B/C; E waits for D. No real CGM, predictor, generated code execution, phone delivery or Letta storage is connected. Values 82 and 64 are fixed test fixtures; confidence is unset. Failed tasks remain in Architect progress records even if the subsequent memory task is blocked.

### Configuration intent and activation

The `system`, `models`, `bus`, `memory`, `security`, and `network` sections record the requested platform configuration. Desktop assignments remain active in `knights`; the loader rejects disagreements with `models.assignments` or endpoint aliases. Requested server assignments are inactive, not a selectable installed model profile. Official Qwen3 tags do not list 70b; Gemma4's official listing uses sizes such as 26b and 31b rather than the requested 27b. Validate exact model tags and server capacity before activation.

Chroma remains at the existing published port 8000; the requested 8001 endpoint is recorded separately. TPM enrollment, the 30-second heartbeat, integrated kill switch, and offline enforcement remain integration work. Flags express intent where accompanying status says pending; they do not activate those capabilities. The asyncio task-concurrency target of four does not change Ollama's single-inference limit or automatically reconfigure the independent Architect package. Tailscale remains opt-in through the remote profile. No fixed count of offline-capable agents has been verified. Owner fingerprint is null until verified activation, never a placeholder presented as a real identity.

## Daily commands for Fredo's desktop

Hardware profile: Ryzen 7 9800X3D, 32 GB RAM, RTX 4080 SUPER 16 GB. Active models remain Qwen3 8B, Qwen2.5-Coder 14B, and Gemma4 12B. No larger models were downloaded by adding management commands. Native Ollama is the existing desktop inference path; Docker Ollama has separate model storage and no GPU configuration in this Compose file.

Choose ONE worker deployment: `make run` (native; Ctrl+C stops it), or `make deploy` (Compose; `make stop` stops it). Do not start both on the same ports.

- `make status` or `python manage.py status`: observed worker/model availability.
- `make status KNIGHT=neo`: one worker. Legacy spelling KNEIGHT is also accepted.
- `make chat` or `python manage.py chat`: Architect text-only replies; no autonomous tool dispatch.
- `make test`: standard-library startup/bus/workflow suite.
- `make test KNIGHT=neo`: that package's pytest suite, using the selected Python environment.
- `make test-integration`: shared-bus lifecycle tests with simulated adapters.
- `make logs`: Compose logs.

Use `make PYTHON=.venv/bin/python ...` on Linux or the appropriate Python executable on Windows. The new requirements.txt collects package development dependencies; clean Python 3.12 installation has not been verified. It is not required for the standard-library worker launcher. Playwright's Chromium installation is separate (`python -m playwright install chromium`).

Kill/kill-switch, memory search, offline verification and kill-switch integration test commands currently return an explicit unsupported error. They do not invent successful results or terminate unrelated Python processes. The sample TPM init module and phone URL were not installed or verified. There is no verified chat server at port 9090. Tailscale enrollment remains a separate owner login, and joining the mesh alone does not expose the application.


### Current Letta deployment update

Letta now runs the App Server with persistent state at /root/.letta, mapped locally to port 8283. Readiness is /readyz; WebSocket is /ws. A local capability token is mounted from runtime-data/secrets/letta-token; keep it private and back it up securely. The image is pinned by digest. The old PostgreSQL volume is preserved but not mounted. Existing code using /v1/blocks is not compatible and still needs migration; service readiness does not mean Merovingian is connected. This follows https://docs.letta.com/self-hosting/. Chroma remains at port 8000.


### Shared council gateway (2026-09-14)

The native entry point now hosts all twelve HTTP routes in ONE process with
one asyncio bus and Sentinel gate. Individual `--knight` processes are disabled
because their separate queues cannot form a shared security boundary.
From the project parent on Windows, run `Launch-NoriCouncil.ps1`. It stores a
local bearer secret in `nori/runtime-data/secrets/council-token`; do not commit or
share it. Existing processes must be inspected before restarting.

`/chat` goes through Sentinel, the addressed Knight, then Machine for generation.
It remains text-only (no automatic tool execution). `/task` dispatches the existing
typed tools. Architect graph nodes re-enter the gateway with unique request IDs.
The host owns sender identity; clients cannot set a sender in their request body.
SQLite audit is `runtime-data/sentinel/bus-audit.sqlite3`; it excludes credentials
and message bodies. This is a trusted-process application gate, not TPM identity,
an OS sandbox, or an immediate cancellation guarantee for in-flight native tools.

Letta uses authenticated App Server WebSockets and MemFS, not the old v1 block API.
The endpoint, token FILE path, and provisioned agent ID come from config. Merovingian
`/task` supports `letta_write` (block/content), `letta_read` (block), and
`letta_search` (query). Existing local memory is preserved; historical memories are
not automatically migrated. The adapter cannot write owner_fingerprint or covenant.

The optional Docker `council` profile replaces the twelve independent worker
containers. It expects native host Ollama and the Compose Letta/Chroma services.
Do not start both native and container councils on ports 9101–9112. Old worker
volumes have been retained. Compose configuration was validated; the running
verification used the native council with Docker-hosted Letta.
