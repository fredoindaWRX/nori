import datetime
text = """2026-09-20 {ts} -04:00 | CLINE-AIDE-1 | AIDE-REGRESSION-01 | broad pre-reload regression green (772+35 passed, 0 failed)
- Broad Council source regression, from `C:\\Nori\\nori` with `PYTHONPATH=C:\\Nori\\nori`: `C:\\Nori\\nori\\.venv-architect\\Scripts\\python.exe -m pytest tests_startup shared\\tests packages\\knights\\machine\\tests -q --basetemp C:\\Nori\\pytest-temp-aide1` => 772 passed, 30 skipped, 0 failed in 47.23s (covers tests_startup, shared tests, and the machine package).
- Workspace source suite, from `C:\\Nori\\workspace`: `C:\\Nori\\nori\\.venv-architect\\Scripts\\python.exe -m pytest test_server.py test_outputs.py test_voice.py test_wake.py test_speech.py -q --basetemp C:\\Nori\\pytest-temp-aide1-ws` => 35 passed, 0 skipped, 0 failed in 3.31s.
- Both runs were launched detached via Start-Process -NoNewWindow -PassThru with stdout/stderr redirected to C:\\Nori\\aide1_council_out.txt / .err and C:\\Nori\\aide1_ws_out.txt / .err, then polled to natural completion (PIDs 29244 and 28276); no run was killed, both summary lines are genuine full-run summaries.
- Constraint statement: read-only verification only. No live service started, stopped, restarted, or reloaded; no Ollama model load/generate or any model traffic; no source files edited; tests use repo-local basetemp dirs and never touched live services, credentials, OS/USB artifacts, or safety components.
- Note: skipped counts (30 Council) are pre-existing conditional skips in the suites, not failures; nothing needs follow-up from this lane.
"""
ts = datetime.datetime.now().strftime('%H:%M')
text = text.replace('{ts}', ts)
text = text.replace('\r\n', '\n').replace('\r', '\n')
with open(r'C:\Nori\TEAM_UPDATES.txt', 'a', encoding='utf-8', newline='') as f:
    f.write(text)
print('APPENDED OK, lines:', len(text.splitlines()))
