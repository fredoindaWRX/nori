# Apoc Browser Scout

Use packages.knights.apoc.agents.apoc.ApocAgent. Supply authenticated owner context,
allowed_origins and output_dir. Each run creates and closes a fresh Chromium context.
No user browser profile is attached. No cross-session cookie storage or RAG is used.
Screenshots intentionally remain in output_dir as task artifacts.

Tools: browser_use (navigate or click), web_scrape (page text), form_fill,
screenshot, cookies (list metadata or clear). Cookie secrets cannot be exported or
imported by the model. Downloads and service workers are disabled. Extra windows close.
Host-supplied origins apply to network requests as well as top-level navigation; include
needed asset origins explicitly. This is a scope restriction, not an OS/network sandbox.

Authentication detection covers HTTP 401/403, common login URL paths, and password fields.
It is conservative and not universal: custom SSO, challenges and unusual iframe login
flows can require additional detection. On detection actions stop and return a handoff
for the Architect. A dispatcher callback performs the handoff if configured; otherwise
the caller receives it. This package does not enter credentials or restore login cookies.

The model comes from the current desktop config (Qwen3 8B). An explicit installed model
can override it. No official Qwen3 70B tag was found in the earlier library check.
The host must authenticate the caller; the fingerprint only fills the prompt template.

Playwright and Chromium installed in the existing .venv-architect environment.
Run tests with its Python: -m pytest packages/knights/apoc/tests/test_apoc.py -q.
Six tests use actual Chromium and a disposable local HTTP server. They verify form
submission, screenshots, scraping, cookies, scope, login/401 handoff and session isolation.
The model transport is deterministic in the agent test; live Ollama browser planning
was not tested. The existing shared read-only Apoc HTTP worker remains unchanged.
