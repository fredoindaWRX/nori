# Morpheus IDE specialist

Use packages.knights.morpheus.agents.morpheus.MorpheusAgent with a trusted
context_provider callback returning open_files (path, optional content, dirty),
project_tree and diagnostics. Context is refreshed on every file operation.
Only open files can be read, edited or checked. Tree metadata does not grant file access.
The host must authenticate owner context; the prompt fingerprint alone is not authentication.

The current desktop model is read from config.yaml (Qwen2.5-Coder 14B).
Use model="devstral" to explicitly select an installed Devstral model on suitable hardware.
The bounded Ollama JSON action loop supports tools, final responses and handoffs to Neo.
Without a dispatcher a handoff returns to the host; it does not start Neo automatically.

Changes are single-region replacements with an expected content SHA-256. Unsaved buffers
require apply_edit(path, expected_sha256, updated_content), which must atomically compare
and apply through the IDE. Saved-file fallback is available when no buffer content was
provided; it rechecks the disk but is not atomic against unrelated external editors.
allow_writes must be supplied by the host. Large changes are handed to Neo.

code_execution currently compiles Python source for syntax validation without executing it.
It cannot run tests or arbitrary programs: those can read closed files or spawn processes,
violating this package's open-file boundary without an additional execution sandbox.
No browser or research tools are exposed. An IDE extension/context bridge is not included;
this package consumes an explicit context callback rather than claiming to see live tabs.

Twelve tests cover real file edits, closed-file denial, context changes, traversal,
unsaved buffers, stale edits, syntax checking, Neo handoff and the model tool loop.
The old shared MorpheusWorker and HTTP route remain unchanged.
