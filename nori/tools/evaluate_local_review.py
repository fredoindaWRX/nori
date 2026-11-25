"""Read-only local-model review evaluation; no file or execution grants."""
import json
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from packages.knights.trinity.agents.trinity import TrinityAgent


def main():
    source_path = ROOT / 'tablet_ui/tablet.js'
    output = ROOT / 'runtime-data/tablet-structured-review.json'
    agent = TrinityAgent(ROOT, ROOT / 'runtime-data/review-evaluation-audit.jsonl',
                         owner_fingerprint='local-read-only-evaluation', grants=())
    started = time.monotonic()
    result = agent.review_source(source_path.read_text(encoding='utf-8'))
    result.update(source_path=str(source_path), model=agent.model,
                  elapsed_seconds=round(time.monotonic()-started, 2),
                  execution_mode='read-only evaluation; no tools or writes granted')
    output.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
