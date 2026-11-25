# The Keymaker — research and reporting

KeymakerAgent accepts OracleTools, a report output directory, and authenticated owner
context. Set online=True only when the host permits web research. Offline mode never
calls the web provider. The default local model comes from config.yaml (Qwen3 8B on
Fredo's current PC). An explicit installed model override is supported.

ResearchPlanner uses the local model to produce up to six sub-queries. Each query
retrieves up to three Oracle chunks and, online, searches public sources via ddgs and
reads page text using the existing read-only HTTP worker. There is no browser automation,
login, code execution or general filesystem-writing tool. Search queries go to external
search providers only in online mode; the model endpoint remains local Ollama.

Evidence is deduplicated and bounded to twelve sources; synthesis input is further
bounded to fit context. Findings carry exact quotes and source IDs. Unknown IDs and
invented quotations are discarded. Matching quotations do not prove a synthesized claim
is entailed by them: reports explicitly retain that review limitation. Similar or mirrored
sources are not automatically independent; domain diversity is not enforced in this version.

file_write only creates generated-name Markdown reports inside the configured output
directory. The model cannot choose executable files or arbitrary paths. Sources are
listed with local paths or web URLs, chunk excerpts, and retrieval timestamps. Publication
dates and formal bibliographic styles are not extracted automatically.

Seven deterministic tests passed: offline isolation, multi-source collection, deduplication,
quote validation, local fallback after network failure, no-evidence handling, bounded plans,
and optional report saving. Live web provider and local model synthesis are unverified.
The old shared KeymakerWorker/HTTP route is unchanged; this is the richer agent package.
Dependencies: ddgs installed in .venv-architect; OracleTools dependencies apply for local RAG.
