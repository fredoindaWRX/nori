"""Local-only repair comparison; candidates execute only in the WSL sandbox."""
import ast
import hashlib
import json
from pathlib import Path
import sys
import time
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT / "shared")]
from orchestration.wsl_python_runner import WslPythonRunner


def main():
    output = ROOT / "runtime-data" / "model-comparisons" / ("repair-" + time.strftime("%Y%m%d-%H%M%S"))
    output.mkdir(parents=True, exist_ok=False)
    source = (ROOT / "shared/orchestration/architect_worker.py").read_text(encoding="utf-8")
    broken = (ROOT / "runtime-data/neo/workspace/tasks/c953d068af7d4c829d062b56bb81ea5f/check_dispatch.py").read_text(encoding="utf-8")
    prompt = ("Return ONLY a complete corrected Python regression test, no Markdown. Use the actual source API. "
              "The test must call ArchitectWorker._dispatch_result with four input values: object(), an actually self-referencing list, "
              "float('nan'), and integer 42. Use envelopes containing knight='tank', dispatch_id='test', result={'status':'completed','data':value}. "
              "For invalid values assert failed and check json.dumps(returned, allow_nan=False) succeeds. For 42 assert completed "
              "and output.data equals 42. Do not merely test json.dumps alone or remove cases/assertions. Fix constructor and incorrect test-input mistakes. "
              "Keep the script under 2500 characters.\nACTUAL SOURCE:\n" + source + "\nBROKEN TEST:\n" + broken)
    (output / "prompt.txt").write_text(prompt, encoding="utf-8")
    runner = WslPythonRunner.configured()
    for model in ("qwen2.5-coder:14b", "qwen3:8b"):
        folder = output / model.replace(":", "-")
        (folder / "audit").mkdir(parents=True)
        (folder / "architect_worker.py").write_text(source, encoding="utf-8")
        (folder / "audit/nori_audit.py").write_bytes((ROOT / "shared/audit/nori_audit.py").read_bytes())
        payload = {"model": model, "stream": False, "think": False,
                   "options": {"num_ctx": 8192, "num_predict": 1800, "temperature": 0},
                   "messages": [{"role": "user", "content": prompt}]}
        started = time.monotonic()
        request = Request("http://127.0.0.1:11434/api/chat", data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
        with urlopen(request, timeout=180) as response:
            generated = json.load(response)
        (folder / "generation.json").write_text(json.dumps(generated, indent=2), encoding="utf-8")
        code = generated["message"]["content"].strip()
        if code.startswith("```python\n") and code.endswith("```"):
            code = code[len("```python\n"):-3].strip()
        (folder / "check_dispatch.py").write_text(code, encoding="utf-8")
        result = {"model": model, "generation_seconds": time.monotonic() - started,
                  "source_sha256": hashlib.sha256(source.encode()).hexdigest(), "done_reason": generated.get("done_reason")}
        try:
            ast.parse(code)
            if generated.get("done_reason") == "length":
                raise ValueError("Truncated output")
            result["execution"] = runner.run(folder, "check_dispatch.py", [], 10)
        except (SyntaxError, ValueError) as error:
            result["validation_error"] = str(error)
        (folder / "receipt.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
        print(json.dumps({"model": model, "folder": str(folder), "seconds": result["generation_seconds"],
                          "exit_code": result.get("execution", {}).get("exit_code"), "error": result.get("validation_error")}), flush=True)


if __name__ == "__main__":
    main()
