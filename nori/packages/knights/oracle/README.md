# The Oracle — local document librarian

DocumentIndexer(db_path).build(docs_root) builds a new Chroma snapshot from an explicitly
selected folder. Keep db_path outside docs_root. Only after successful indexing does the
active snapshot switch; failed builds leave the last index available. Rebuild after edits
or deletions. Old snapshots remain on disk for now and require a separate retention policy.

Supported: UTF-8 TXT, Markdown, CSV, JSON, RST, text-bearing PDF via pdfplumber, DOCX.
No OCR for scanned PDFs. Empty/unsupported documents are listed as skipped. Source IDs
include document text hashes. Chunks retain source path and chunk number. Full-text file_read
is deliberately restricted to indexed chunk IDs; it does not read arbitrary filesystem paths.

Embeddings: embeddinggemma via local Ollama /api/embed; installed for this implementation.
Index metadata enforces the same embedding model during queries; changing it requires rebuild.
Chroma stores vectors locally with telemetry disabled. No remote embedding service is used.

OracleAgent(indexer, owner_fingerprint=...) uses installed gemma4:12b. Supply authenticated
owner context from the host; a fingerprint in a prompt is not authentication. No personal
folder is chosen automatically. The host selects the corpus and controls its access.

The model selects supporting quotes from retrieved chunks. Code validates every citation
ID and exact quote before returning excerpt-only answers, not unrestricted generated prose.
This prevents invented quotations; it cannot prove that a selected real quote is relevant
or that the indexed document itself is accurate. Retrieval can miss answers; not_found
means no supported answer was found, not a proof the entire corpus lacks the information.
Cosine cutoff 0.55 is an initial default requiring evaluation on the owner's corpus.

Errors return failed rather than pretending the corpus has no answer. No browser or report
tools are provided. The package is not yet wired into the older shared Oracle HTTP worker.

Use .venv-architect Python (ChromaDB and pdfplumber already installed). Nine tests exercise
real Chroma persistence, lookup, no-evidence abstention, invented quote rejection, deletion
reindexing, embedding-model mismatch, and indexed-only reads. Live fixture results are
recorded separately in tests/live-validation.json.
