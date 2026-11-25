# The Merovingian — Chronicler

MerovingianAgent exposes memory_read, memory_write, memory_search and memory_compress
through run(operation, actor=..., session=...). All twelve Knight IDs are accepted after
the supplied authorization callback authenticates the session and requested operation.

Persistent local SQLite journal separates core and archival records. The owner fingerprint
lives in a separate immutable table with UPDATE/DELETE triggers, outside summarization.
No memory-deletion tool is exposed. This is application/database enforcement, not protection
against an administrator replacing the database file. Initial owner binding must come from
Sentinel's authenticated host, never model-generated text.

Phi-4 via Ollama (model phi4) produces derived summaries with original source IDs. Original
records are preserved. Summaries are model-derived and may omit details; consult sources.
Batches are bounded to 6000 characters for the local context. Oversized items remain intact.

ActivityGate uses a separate SQLite database shared by participating processes. Wrap every
Knight task with gate.active(knight). Compression takes an exclusive idle transaction;
new participating tasks cannot start until it releases. Crashed active tasks leave entries
behind and block consolidation until supervised recovery. The existing twelve-process host
is NOT yet wired to this gate, so system-wide idle scheduling is not enabled automatically.
The package has no timer: a host scheduler calls memory_compress on idle opportunities.

LettaBlocks replicates journal records to local Letta /v1/blocks/. Call sync_letta after
configuring the adapter. Core and archival records use separate labels; archival here means
journal experiences replicated as blocks, NOT Letta's archival-passage/vector-search API.
SQLite is the authoritative durable store in this version, and searches are substring based.
Sync failures preserve local records. A timeout after remote creation can cause a duplicate
on retry; production reconciliation is still needed. Owner binding stays outside replication.

Eight tests pass with persistent SQLite and a fake Letta adapter. Live Letta and live Phi-4
consolidation are not verified. Install phi4 in Ollama before invoking the default summarizer.
The previous shared MerovingianWorker HTTP route remains unchanged.
