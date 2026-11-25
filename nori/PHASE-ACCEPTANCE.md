# NORI phased acceptance status

Adapted from the owner's checklist. Desktop profile retained: Qwen3 8B,
Qwen2.5-Coder 14B and Gemma4 12B. No unsupported large-model tags pulled.

- Phase 0: all three configured inference models returned exactly OK. Docker engine is now running; Letta App Server /readyz and Chroma heartbeat return HTTP 200. New configured App Server MemFS adapter passed live write/read/search; existing local historical memory was preserved and not automatically migrated.
- Phase 1: reused existing monorepo and .venv-architect environment; no second git repository or replacement environment created.
- Phase 2: all twelve actual package classes import in isolated processes. This is import verification, not twelve services booting.
- Phase 3: three distinct model routes tested; not twelve full agent/tool runs.
- Phase 4: in-process bus tests pass with a test Sentinel adapter. The live HTTP routes now share a token-authenticated gateway; concurrent request tests pass. No ungated test sends allowed.
- Phase 5: live central bearer-token gate is integrated; TPM end-to-end authentication remains incomplete. A public fingerprint alone is not proof of possession.
- Phase 6: all nine requested routing examples pass after intent-rule corrections.
- Phase 7: full live single-Knight capability acceptance remains pending. Current chat endpoint generates text only.
- Phase 8: fixed-plan Architect/Neo/Smith host execution previously passed, but is superseded by the September 14 hard floor. Unisolated execution is now denied until a real isolated runner exists; ordinary Neo workspace work remains available. Free-form multi-Knight execution remains pending. CGM examples are synthetic, not medical predictions.
- Phase 9: Architect-to-Merovingian remember/recall passed through the live gateway. Full cross-session conversational recall, historical migration and reboot acceptance remain pending.
- Phase 10: live council kill switch and recovery pending. A normal restart must not silently clear an emergency revocation.
- Phase 11: remote gateway and Tailscale enrollment pending; no verified port 9090 chat service.
- Phase 12: shared prompts.covenant loader and separate autonomy direction implemented and tested for all twelve worker identities. New activation records include identity covenant; Merovingian protects a local covenant record. Live autonomy preference saved/read through Letta. Verified owner activation, protected Letta covenant replication and unattended tool planning remain incomplete; prompt presence is not security enforcement.
- Phase 13: no host networking disabled. Offline acceptance remains pending; no verified 10/12 claim.
- Phase 14: stress test deferred until the normal live task path passes.
- Phase 15: unattended daily operation not ready.

September 14 hard-floor integration: fourteen deterministic invariants are separate
from the unchanged covenant. Local services remain allowed; unverified remote
traffic, unauthenticated alternate service dispatch, protected file effects and
unisolated execution are denied. See `Documentation/HARD-FLOOR.md` for exact
coverage and the pending OS, TPM, isolated-runner and remote-transport work.

Evidence: runtime-data/readiness-check/phase-readiness.json.
Run repeatable foundation/import checks with:
`.venv-architect/Scripts/python.exe -m examples.phase_readiness`
Run startup and routing tests with: `python manage.py test`.
