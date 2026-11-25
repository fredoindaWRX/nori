# The Machine — inference routing

Machine exposes model_inference, embed, rerank, model_status. Registry task types map
deterministically to explicit local models; there is no model deciding where to route.
Default routes read the desktop config: general Qwen3 8B, coding Qwen2.5-Coder 14B,
knowledge Gemma4 12B; embedding/rerank use embeddinggemma. Installed and loaded status
come from Ollama /api/tags and /api/ps, not assumptions based on configuration.

OOMHandler recognizes explicit backend memory exhaustion, emits an Architect event,
and retries once with options.num_gpu=0. Unrelated errors are not retried. CPU RAM can
also be insufficient; that failure emits another event and propagates. Notification
requires a connected callback; otherwise events stay in the in-memory events list.
Fallback reports CPU execution requested, not independent verification of device placement.

Embedding responses are checked for count, dimensions and finite numbers. Reranking is
cosine similarity against the query embedding, not a trained cross-encoder reranker.
Scores are similarities, not calibrated probabilities. Text generation is bounded and
non-streaming. One router instance serializes requests; shared cross-process capacity
control remains the Ollama server's configured responsibility. No planning/tools execution.

Seven unit tests pass with deterministic backends. Live Ollama status and embedding
reranking passed on the desktop; no actual OOM was induced. Auth belongs to the hosting
service. This package is not yet substituted into all Knights that call Ollama directly,
and the older shared Machine/Seth inspection worker remains unchanged.
