"""Owned real checkpoint cache-seam diagnostic; no tools or execution grant."""
import hashlib
import json
import subprocess
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from actual_candidate_probe import ROOT, digest
from actual_performance_probe import MODEL_SHA, TIMING_TASK


def checked_rows(output, count):
    rows = [json.loads(line) for line in output.splitlines() if line.strip()]
    phases = ['stateless_vs_chunked', 'different_chunk_boundaries',
              'rollback_then_reuse', 'reset_then_prefill']
    if len(rows) != 5 or [row.get('phase') for row in rows[:-1]] != phases:
        raise ValueError('Missing or extra long-context comparison evidence')
    expected_counts = [128, count, count + 1, count]
    for row, expected in zip(rows[:-1], expected_counts):
        if (row.get('tokens') != expected or row.get('logits') != 128256
                or row.get('reference_top') != row.get('actual_top')
                or not isinstance(row.get('max_absolute'), (int, float))
                or not 0 <= row['max_absolute'] < 1e-3):
            raise ValueError('Long-context all-logit agreement failed')
    final = rows[-1]
    if (final.get('status') != 'PASS' or final.get('tokens') != count
            or final.get('layers') != 28 or final.get('cpu_full_context_reference') is not False
            or final.get('external_reference') is not False
            or final.get('tools_executed') != 0 or final.get('execution_authorized') is not False):
        raise ValueError('Invalid long-context diagnostic completion')
    return rows


def main():
    if len(sys.argv) != 1:
        raise ValueError('This diagnostic takes no model/default overrides')
    model = ROOT / 'models/language/llama3.2-3b-instruct/llama3.2-3b-instruct.gguf'
    tokenizer = ROOT / 'engine/norama/norama-tokenizer.exe'
    probe = ROOT / 'engine/norama/norama-long-context-probe.exe'
    if digest(model) != MODEL_SHA:
        raise ValueError('Default checkpoint changed; no process started')
    identities = {str(path.relative_to(ROOT)): digest(path) for path in (tokenizer, probe)}
    flags = getattr(subprocess, 'CREATE_NO_WINDOW', 0)
    encoded = subprocess.run([str(tokenizer), str(model), '--encode', TIMING_TASK],
                             cwd=ROOT, capture_output=True, text=True, check=True,
                             timeout=15, creationflags=flags)
    tokens = [int(value) for value in encoded.stdout.strip().split(',')]
    if not 129 <= len(tokens) <= 1024 or any(not 0 <= value < 128256 for value in tokens):
        raise ValueError('Tokenized diagnostic outside bounds')
    result = subprocess.run([str(probe), str(model), '--actual', *map(str, tokens)],
                            cwd=ROOT, capture_output=True, text=True, check=True,
                            timeout=190, creationflags=flags)
    rows = checked_rows(result.stdout, len(tokens))
    if digest(model) != MODEL_SHA or any(digest(ROOT / path) != sha for path, sha in identities.items()):
        raise ValueError('Diagnostic artifacts changed during the run')
    print(json.dumps({'model_sha256': MODEL_SHA, 'identities': identities,
                      'prompt_sha256': hashlib.sha256(TIMING_TASK.encode()).hexdigest(),
                      'token_ids_sha256': hashlib.sha256(json.dumps(tokens, separators=(',', ':')).encode()).hexdigest(),
                      'processes_completed': True, 'comparisons': rows,
                      'scope': 'Own cache partition/reset/rollback consistency; NOT external model parity',
                      'task_execution_qualified': False, 'tools_executed': 0,
                      'execution_authorized': False}))


if __name__ == '__main__':
    main()
