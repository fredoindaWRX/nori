# NORI Round Table startup

`main.py` starts twelve local worker processes. Each worker exposes /health, authenticated
POST /task for its existing typed tool contract, and POST /chat for Ollama responses.
Chat uses the shared covenant and the configured model; it does not automatically execute
tools. The newer CrewAI Architect package is not connected to this HTTP host yet.

`config.yaml` uses JSON syntax (valid YAML 1.2) and defines all twelve roles, model names,
tool capabilities, grants, and distinct ports 9101 through 9112. Model names are assignments;
they must be installed in Ollama before chat becomes available. It does not download models.

## Windows local start

Use Python with no additional packages for this host. Set NORI_API_TOKEN to a securely
generated random secret of at least 32 characters, then run `python main.py` from this folder.
Clients send Authorization: Bearer <secret>. The optional NORI_OWNER_FINGERPRINT fills the
covenant template; it does not authenticate a user. This host uses a bearer token, not TPM
verification. Existing Sentinel typed tasks are the event worker, not the new key gate.
Ctrl+C stops the child processes. A child exit stops the council; Compose restarts containers.

## Docker

Start Docker Desktop's Linux engine. Set the same NORI_API_TOKEN environment variable,
then run `docker compose build` and `docker compose up -d`. The Makefile provides equivalent
build, run (local), check, test, deploy (local Compose), stop, and logs targets when Make is installed.
No remote deployment occurs. Host ports bind to localhost only.

Compose includes Ollama, Letta, LocalAI, and all twelve NORI workers with persistent volumes.
Letta and LocalAI are provisioned infrastructure; the current workers do not automatically
migrate their memory to Letta or route inference to LocalAI. Ollama is the active chat provider.
Base images are CPU configurations and use moving upstream tags; pin validated image digests
before a release. No GPU passthrough or large model download is performed automatically.

A /health response of degraded means the process is alive but its assigned model is not ready.
Container health checks check service liveness; inspect model_ready for inference readiness.
The typed tools retain their existing permissions and request schemas. Some hardware and
model-inspection operations need additional host-specific provisioning inside containers.

Validation: configuration and local worker startup can be checked without Docker.
The container build/run requires a running Docker engine and is a separate verification step.
