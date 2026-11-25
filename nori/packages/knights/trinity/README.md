# Trinity — Generalist

The new package exposes TrinityAgent.run(goal) with a bounded Ollama tool loop. It loads
the shared covenant and the role prompt, supports explicit host specialist classification,
and honors model-issued handoffs to Neo, Apoc, or Keymaker before other tools in that batch.
Without a dispatcher callback a handoff is returned to the caller, not silently executed.

Default model is read from config.yaml: Qwen3 8B for Fredo's RTX 4080 SUPER / 32 GB PC.
Qwen3 70B is not an official Qwen3 library tag. A model override is accepted explicitly.
No dedicated retrieval database is used.

Tools: existing workspace file reading/writing, Python script execution, quick public
HTML search, and public page text inspection. Browser support is read-only; interactive
work goes to Apoc. Search providers may block automated requests; errors are not success.
The search_provider callback permits a configured search backend.

Construct with workspace_root, audit_path, authenticated owner_fingerprint, and host grants.
Relevant grants are workspace_read, workspace_write, execution_run, browser_read.
allow_writes is a host-owned authorization flag; model arguments cannot turn it on.
The host must authenticate the owner before construction. The fingerprint is not proof
of identity. Python execution inherits the existing Smith worker's isolation limits;
a workspace path restriction is not an OS sandbox. Use a container for untrusted scripts.

This package does not replace the existing plugin-only TrinityWorker HTTP route.
Tests cover prompt inheritance, three specialist routes, handoff precedence, actual Python
execution, file boundaries, host write authority, search/browser adapters, and loop limits.
