# Nori developer map: start here

Owner request, 2026-11-12: keep a list of how everything is built and where the code is, so future developers know where to look. This folder is that list. **Keep it current:** when you add, move or install something, update the matching section here in the same change, and re-run the file index after every install.

**2026-11-13 source consolidation:** Follow the newer `AGENTS.md` one-source rule. Edit and test in `C:\Nori\apps\desktop`, then package from that source and verify against the current installed hashes. The extract-based workflow below records the earlier drift-recovery process and is not the current development workflow. Read-only installed archive inspection remains useful for verifying what is running.

| File | What it is |
|---|---|
| `README.md` (this) | How Nori is put together, where each part lives, how a release is built and installed |
| `APP-FILES.md` | Every source file in the **installed** app, with the file's own description. Generated; never edit by hand |
| `build-file-index.mjs` | Regenerates `APP-FILES.md`: `node C:\Nori\docs\developer-map\build-file-index.mjs` |

Read first, before changing anything: `SESSION_HANDOFF.md`, `AGENTS.md`, `docs/NORI-SOUL.md` (identity, continuity, journals), `docs/AGENT-HANDOFF.md` (who owns what right now), `docs/ARTIFACT-RETENTION-POLICY.md`.

---

## 1. The one rule that trips everyone: installed code is the truth

The app that runs is `C:\Program Files\Nori\resources\app.asar`. **Its code has drifted from the source tree in `C:\Nori\apps\desktop`** (since 2026-10-30; many modules exist only in the installed archive). So:

- To read what Nori actually does, read the installed archive (extract it, see section 5), not `apps/desktop`.
- Every change is made against an extract of the installed archive, not against `apps/desktop`.
- `APP-FILES.md` is generated from the installed archive for this reason.

Installed identity: one app, one user-data folder. Public Desktop and Start Menu shortcuts point to `C:\Program Files\Nori\Nori.exe`. `C:\Nori\Nori.lnk` is a separate development launcher. Re-check before every install.

## 2. The pieces and where they live

| Piece | Where | Language | Notes |
|---|---|---|---|
| Desktop shell (Electron main) | `app.asar/desktop/` (109 files) | Node CJS | `main.cjs` starts everything: window, face server, model service, bridge |
| Bridge (chat brain, tools, persona) | `app.asar/bridge/` (153 files) | Node ESM | `server.mjs` is the entry; `nori-v2-query.mjs` runs a chat turn; `local-chat.mjs` talks to the model |
| UI | `apps/desktop/dist/`, `apps/desktop/public/` | built web assets | Desktop orb authored source is now `apps/desktop/src/orb/`; its original inputs reproduced the shipped asset byte-for-byte before the software-rendering repair. Floating-face-only source remains in the older r69 source pending a separate port. |
| Python Core ("NoriSuite") | `C:\Program Files\Nori\resources\NoriSuite\nori\` (`main.py`) | Python 3.11 (bundled in `NoriSuite\python`) | Orchestration, workers, security, school. Context-size allowlists also live here |
| Model engine | `NoriSuite\engine\gpt-oss-runtime\build\bin\llama-server.exe` | llama.cpp (CUDA) | Started by `desktop/gpt-oss-service.cjs` through `desktop/task-model-router.cjs` |
| Models (weights) | `C:\Nori\models\{language,vision,embedding}\...` | GGUF | Each folder has `provenance.json` (repo, revision, SHA-256) |
| User data (never wipe) | `%LOCALAPPDATA%\Nori\` | | `learning\` (timings, events, experience), `skills\` (skill registry), `settings\`, `state\`, `secrets\` (never read) |
| Helper model (RX 480) | `C:\Nori\integrations\nori-helper\` | PowerShell + Vulkan llama.cpp | 9B on the second card, port 18795, key in `%LOCALAPPDATA%\NoriHelper\api-key.txt` (never print) |
| Shared memory hub | `C:\Nori\integrations\ultron-hub\` | Python | Read `HUB-FOR-AGENTS.md`; owner starts it |
| Agent Office (standalone app) | `C:\Nori\integrations\agent-office\`: `AgentOffice.pyw` (launcher), `office_server.py` (server), `office.html` (page), `agent-office.ico` | Python stdlib + Edge app window | Read-only view of every agent on the PC (Claude, Codex, Cline/Roo, Manus, Nori, helper), port 8797. Desktop/Start menu shortcut opens its own window; Startup shortcut runs `AgentOffice.pyw --server-only` at sign-in, so no agent has to start it. Log: `%LOCALAPPDATA%\AgentOffice\launcher.log` |
| Other integrations | `C:\Nori\integrations\{aider,artcraft,image-generation,location,project-monitor,rea}` | mixed | Each folder is one capability Nori can call |
| Streaming (OBS, cohost, chat) | `C:\Nori\streaming\tools\` | Python + Node | `cohost.py` (8880), `stream-bridge.mjs` (8891), `chat_server.py` (8892), `proactive_host.py` (`!nori` commands) |
| Nori OS (Linux, bootable) | `C:\Nori\nori-os\` | Python + shell | Plan and finish line: `nori-os/docs/FINISH-LINE.md` |
| Second app line (V2) | `C:\Nori\apps\NoriV2` | TS/Node | Separate experiment; not the installed app |
| Build tools | `C:\Nori\tools\` | | `VulkanSDK`, `inno-setup-7.1.0`, `nori_build`, `usb-rea`, Ghidra for REA |
| Agent journals | `C:\Nori\docs\agent-journals\<agent>\` | Markdown | Soul rule: every agent writes about itself each session |

## 3. Ports (loopback only, as of 2026-11-12)

| Port | What |
|---|---|
| 15188 | Nori face/LCD page server (`desktop/main.cjs`) |
| 18786 | Nori's one text-model endpoint (`desktop/automatic-text-service.cjs`): `/v1/chat/completions`, `/v1/models`, `/v1/nori-timings`, `/v1/nori-events` |
| 18787 | Bridge (`bridge/server.mjs`): WebSocket chat + `/health`. Do not test through its chat socket |
| 18788 | Main llama-server (the loaded model) |
| 18789 | Embedding model (memory search + per-message cue recall, CPU). Since R88 it runs on its own native CPU engine `NoriSuite/engine/memory-embedding/bin` (8 files hash-pinned in `desktop/local-embedding-service.cjs`; falls back to the gpt-oss-runtime engine on mismatch). Built from `engine/vision/third_party/llama.cpp` 2e7c58c by `.work/llama-cpu-embed-20261113/build.cmd` |
| 18795 | Helper llama-server on the RX 480 (keyed) |
| 8788, 8790, 62025 | Other Nori.exe listeners |
| 62032–62044 | Python Core workers (`NoriSuite\nori\main.py`) |
| 19393 | Python input worker (`NoriSuite\runtime\input\launch_worker.py`) |
| 9977 | Ultron memory hub |
| 8797 | Agent Office |
| 8880 / 8891 / 8892 | Stream cohost / stream bridge / chat server |
| 18746 | Live wallpaper (`C:\Nori\artifacts\nori-live-wallpaper\server.py`) |

Re-list them any time: `Get-NetTCPConnection -State Listen` joined to `Win32_Process` command lines.

## 4. How a request flows

1. You type or speak → UI → bridge WebSocket (18787) → `bridge/nori-v2-query.mjs` builds the turn: persona (`bridge/nori-identity.mjs`), host facts (`host-facts.mjs`, `hardware-facts.mjs`), tool intent (`tool-intent.mjs`), skills, journal block if asked.
2. `bridge/local-chat.mjs` sends it to 18786.
3. `desktop/automatic-text-service.cjs` asks `desktop/task-model-router.cjs` for a route (which model, loads it if needed), forwards to the llama-server, logs `learning/model-timings.jsonl` and `learning/model-events.jsonl`. If no route in 20 s or the main model fails, `desktop/helper-fallback.cjs` answers on the helper.
4. Output passes `bridge/identity-output-guard.mjs` before it reaches you.
5. (R87, staged 2026-11-13) Each tool call also reports live steps: `bridge/work-steps.mjs` → `onKnight` side channel in `agent-loop.mjs` / `local-chat.mjs` → `{type:'nori_step'}` in `nori-v2-query.mjs` → bridge frame `{type:'step', ask, step}` in `server.mjs` → drawn by `dist/assets/nori-work-steps-20261113.js` under her reply.

Background jobs (all stop when you come back): idle self-test (`bridge/idle-self-test.mjs`), daily journal (`bridge/nori-daily-journal.mjs`, on the helper), power meter (`bridge/nori-meter.mjs`), home watch (`bridge/home-watch.mjs`).

## 5. How a release (Rnn) is built and installed

Releases are numbered R61, R62, … R85. Each lives in a stage folder `C:\Nori\.work\rNN-<name>\` holding: `x\` (the patched extract), `app.asar` (packed), `patch.py` or new files, tests, `test-run.log`, `install.ps1`, `install.log`.

1. Check the board: who else is installing, and the current installed hash.
2. Extract the **installed** archive: `node "%LOCALAPPDATA%\npm-cache\_npx\4b0e2640fe917ac8\node_modules\@electron\asar\bin\asar.mjs" extract "C:\Program Files\Nori\resources\app.asar" x`
3. Change files in `x\` (a `patch.py` with exact-once anchors is the usual way), add tests.
4. Pack with the **same 4.3.1 CLI**: `... asar.mjs pack x app.asar`. (Other versions change the layout.)
5. Prove only the intended files changed: `node C:\Nori\.work\r69-box-only\tools\compare.cjs "C:\Program Files\Nori\resources\app.asar" app.asar`
6. `install.ps1` pins the current hash and the new hash, saves a rollback to `C:\Program Files\Nori\maintenance\rollback-<name>\app.asar`, swaps, re-verifies, restores on failure. It needs admin and Nori closed.
7. Close Nori's process tree but **spare the hub and helper PIDs**; run the installer elevated; relaunch detached (`Invoke-CimMethod Win32_Process Create`; `Start-Process` from a tool shell kills Nori when the shell ends).
8. Verify live (process up, `model-events.jsonl` writing, the feature itself), log on `docs/AGENT-HANDOFF.md` with the new hash, re-run `build-file-index.mjs`.

Rollback: copy the rollback `app.asar` back over the installed one with Nori closed.

Pitfalls already paid for: tests that import a bridge by absolute `rNN/...` path test an old copy unless repointed; PowerShell variables are case-insensitive (`$R` = `$r`); after any AMD driver install, restart the helper; the router can hang with no route (now logged and reset by the R84 watchdog).

## 6. Where to look for…

| Question | Look at |
|---|---|
| Who Nori is, her role | `docs/NORI-SOUL.md`, `bridge/nori-identity.mjs`, `bridge/identity-output-guard.mjs` |
| Why a reply was slow or failed | `%LOCALAPPDATA%\Nori\learning\model-timings.jsonl`, `model-events.jsonl` |
| Which model she uses and why | `desktop/task-model-router.cjs`, `desktop/automatic-text-service.cjs`, `bridge/local-chat.mjs` (`nativeModelChoices`) |
| Her skills | `%LOCALAPPDATA%\Nori\skills\` (registry), `bridge/skill-catalog-status.mjs` |
| Her tools | `bridge/tool-registry.mjs`, `bridge/*-tools.mjs` |
| Graphics cards she reports | `bridge/hardware-facts.mjs`, `bridge/pc-info-tools.mjs` |
| What every agent is doing now | Agent Office app (Desktop shortcut), or http://127.0.0.1:8797/ |
| Who owns which files right now | `docs/AGENT-HANDOFF.md` |
| Any file in the app | `APP-FILES.md` in this folder |

### Offline guest application acceptance (Core Work2)
Runner: nori-os/scripts/boot_firefox_app_guest.py; safety/evidence tests: nori-os/tests/test_firefox_app_guest.py. Creates unique .build/firefox-app-guest-* outputs from pinned cached Ubuntu/Firefox/packages, with Windows physical-memory and commit gates. No NIC, host shares or passthrough. Tests real headless Firefox via native-app adapter, not full Nori stack. Results: result.json plus serial.log and payload-pins.json. Initial run stopped for host pressure; retry3 currently running. See AGENT-HANDOFF for current status.


Guest app update: firefox-app-guest-20261113-retry3 passed real headless browser+adapter inside offline QEMU and powered off. Earlier stopped attempt retained; full-stack and interactive desktop acceptance remain separate.


## Nori OS guest runtime experiments (2026-11-12)

- `C:\Nori\nori-os\nori_runtime\linux_model_service.cjs`: experimental Linux model process/loopback adapter. Production model launch is deliberately blocked until a reviewed ELF bundle policy is wired; parent-death supervision is separately unqualified. This is not installed in the Windows app.
- `C:\Nori\nori-os\nori_runtime\nori-parent-exec.c`: direct-child parent-death experiment, not a qualified process-tree supervisor.
- `C:\Nori\nori-os\tests\test_linux_model_service.cjs` and `test_parent_exec.py`: synthetic boundary, cleanup and direct-child tests; they are not model or full guest acceptance.
- `C:\Nori\nori-os\tests\guest-model-acceptance-20261112\README.md`: model metadata, loader inventory and independent guest readiness checks. The actual model and 64K context remain unverified in the guest.
- Installed Windows app index is unchanged by these guest-only source experiments.

Windows-app guest runner: nori-os/scripts/boot_vlc_app_guest.py, unique .build/vlc-app-guest-20261113; cached Wine and Windows VLC with synthetic WAV, no personal media. Result pending; shares host-memory gate with Firefox runner.

- `C:\Nori\nori-os\packaging\guest-session-20261112\`: experimental systemd-owned desktop launcher and Cage/Wayland/XWayland handoff. `C:\Nori\nori-os\nori_runtime\cage_watch.cjs` is an opt-in compositor watcher for a future Linux overlay. `test_guest_session.py` and `test_cage_watch.cjs` are synthetic; the unit and watcher are not yet installed, wired, or proven in a real guest.
- `C:\Nori\nori-os\scripts\guest_desktop_20261112\`: hash-pinned Linux-only overlay and isolated synthetic service fixtures for the installed Electron main and Core. A WSL/Xvfb probe, not the Nori OS guest or production installer. Exact source/receipt details are in its own evidence files; no real model or tools are qualified by that probe.
- `C:\Nori\nori-os\scripts\boot_nori_desktop_guest_20261112.py`: fresh offline VM probe runner for the pinned installed desktop and synthetic model, with evidence-parser checks in `nori-os\tests\test_boot_nori_desktop_guest_20261112.py`. The runner is being prepared and has not yet passed a guest boot.

VLC guest retry: scripts/retry_vlc_app_guest.py; .build/vlc-app-guest-20261113-retry1 passed bounded Windows VLC decode/transcode under Wine. Output15200 vs source16000 frames; exact fidelity unqualified. Original failed ownership fixture retained. Both guests shut down; full-stack runner belongs to CoreWork1.

- `C:\Nori\nori-os\scripts\installed-norllama-manifest-20261112.json`: pinned 42-file installed runtime-code inventory used to bound the offline desktop guest copy; it contains hashes and filenames, not model weights or private state.
- `C:\Nori\nori-os\scripts\boot_nori_desktop_retry_20261112.py`: diagnostic-only retry of the preserved failed desktop guest, with exact isolation booleans and no weakened fixture checks; `nori-os\tests\test_boot_nori_desktop_retry_20261112.py` checks its transformation and evidence parser. It is a test harness, not an installed app.
- `C:\Nori\nori-os\scripts\guest_desktop_tools_20261112\`: isolated actual-installed-bridge read-only tool probe and evidence. One synthetic `read_file` dispatch passed; a prompt containing “report” was misrouted to WordCraft and remains unresolved. This is WSL evidence, not a guest or real-model pass.

Apple integration requirement and qualification gates: nori-os/docs/EVERYDAY-APPLICATIONS.md (music + iPhone sync/encrypted backup + app updates). Not implemented/qualified; browser-only does not satisfy scope. CoreWork1 notified; target iPhone/iOS pending.


Kernel first-boot independent verification: nori-os/kernel-first-boot/proof-w2Zz8Z holds the CoreWork2 rerun serial log, format reports and hashes. Bounded ELF32/PE32 fixtures only; see AGENT-HANDOFF.md for open CPU-fault test correction.

Corrected kernel memory-boundary proof: nori-os/kernel-first-boot/proof-6OJoMj/serial.log; live commands/output: nori-os/kernel-execution.log. Viewer reads only this log; shared notes remain in AGENT-HANDOFF.md.

2026-11-12 CoreWork2 independent process-isolation VM PASS: proof-7Au6Iw, serial SHA256 7DF83074D764E6D4E23BA8C825D292A2A95BB9682626DB7C9AADE814A94CD625. Distinct page tables/backing verified in source, actual cross-process read/write faults, same-VA values across CR3 switches and unchanged victim; all four ELF32/PE32/ELF64/PE32+ fixtures pass. Sequential processes only; concurrent scheduling not qualified. Executed in persistent PowerShell PID 45860. Initial post-run hash command unavailable; this receipt uses .NET SHA256 without rerunning VM. Windows unchanged.

2026-11-12 CoreWork2 independent cooperative scheduler PASS: proof-m88QaH, serial SHA256 A05988A7CC61E9848AA43E0F175AED32F56E0B80EA1741CBAF12AF09DA39591A. Same persistent PowerShell PID 45860, build/VM exit0; eight progress markers before first app exit independently asserted. Reviewed GPR save/restore and per-process CR3 context. Four live apps interleave via explicit yield, retain private values, all finish; supervisor and cross-process memory tests retained. Timer preemption, FP/SIMD context, arbitrary apps not qualified. UTF8 execution transcript: nori-os/kernel-scheduler-verification.log. Windows unchanged.

2026-11-12 CoreWork2 independent TIMER PREEMPTION PASS: proof-eOBlIt/serial.log SHA256 5147F7C347F2B372B7D373903FCFAC4163F80F4B55F4E56AD0E30886A4A2349C. Rebuilt/tested in existing PowerShell PID 45860, completion exit0. Reviewed PIT/PIC IRQ32 setup, enabled user IF, EOI, saved GPR frame and CR3 switching. All four non-yielding ELF32/PE32/ELF64/PE32+ fixtures reached two timer checkpoints then expected exits; supervisor/cross-process faults and victim value retained. One virtual CPU, bounded fixture proof; FP/SIMD context and arbitrary-app fairness remain unqualified. UTF8 transcript nori-os/kernel-preemption-verification.log. No Windows installation changes.

2026-11-13 CoreWork2 independent x87/SSE preservation PASS: kernel64-first-boot/proof-r7OGbV/serial.log SHA256 AD744A5A99EB420D76B416B273E7808A39EFE9A165C1CB8733F950F1F00A793C. Rebuild and VM in persistent shell PID 45860 returned0. Reviewed 4 aligned512-byte FXSAVE64 areas, FXRSTOR64 on switch, fninit/MXCSR initialization, kernel -mgeneral-regs-only and OSXSAVE disabled. Each of four app formats checked distinct x87 value/control, low32 XMM0 sentinel and MXCSR after both timer rounds. Timer/process isolation regressions pass. This is bounded x87/SSE proof, not exhaustive all-XMM/all-x87-register coverage or AVX support. UTF8 trace kernel-fp-verification.log. Windows untouched.

2026-11-13 CoreWork2 independent ALL-REGISTER patterned preservation PASS: Bochs proof-6gPHh0 serial SHA256 84F026D3C448F6375742E047592798CC2B394A37E102EEF225778B055B7365FE; live PowerShell PID 45860, runner exit0. Reviewed generator: full512-bit ZMM0-7 compat32 and ZMM0-31 long64 comparisons, full64-bit k0-k7, all8 x87 80-bit values, TOP/tag/control and MXCSR after two timer rounds; unique per-process/register/lane patterns. XSAVE CPUID support/size gating reviewed. Process protection and four-app exits retained. This is emulator pattern coverage, not all numeric/exception combinations or physical hardware acceptance. Transcript kernel-all-register-verification.log. Windows unchanged.

2026-11-13 CoreWork2 independent FP exception/edge PASS: proof-J4Tpqg serial SHA256 7075B07B8282B2254329CA677B9D3AE7988962A17596529C11D50F84FD64CD16, Bochs run in existing PowerShell PID 45860 exit0. All four formats handle #MF/#XM user callbacks and finish; register/isolation regressions retained. Generator reviewed: x87 pending state injected using FLDENV then delivered with FWAIT, SSE actual invalid/divzero faults. Masked scalar SSE matrix tests invalid/divzero/overflow/underflow/inexact/denormal flags plus qNaN/Inf/-0, nearest/up rounding, FTZ/DAZ results. Not exhaustive x87 arithmetic or every IEEE condition, and callbacks are prototype ABI not Linux signals/Windows SEH. UTF8 transcript kernel-fp-edge-verification.log. Windows unchanged.

2026-11-13 CoreWork2 actual x87 arithmetic/all4 rounding independently VERIFIED. Hash-pinned source snapshot .work/x87-arithmetic-independent-20261113; proof-UVrenr Bochs pass in existing PowerShell PID 45860. Source checks actual FDIVS with zero or sNaN creates pending dividezero/invalid #MF, no FLDENV injection. Four apps run x87 FISTP and SSE CVTSS2SI positive/negative2.5 and2.75 under nearest-even/down/up/towardzero (32 conversions/app). Existing register/timer/isolation tests pass. Negative snapshot x87-arithmetic-negative-20261113 deliberately expects9 instead of2; guest FAIL unexpected exit confirmed, runner rejected; original source untouched. Bounded invalid/divzero x87 arithmetic and all4 RC proof, not all x87 exception classes. Shared-source ownership preserved for CoreWork1; chat unavailable, use this board. Windows untouched.

2026-11-13 CoreWork2 remaining masked x87 classes PASS in isolated .work/x87-remaining-20261113/proof-Aq5xBY; serial SHA256 7075B07B8282B2254329CA677B9D3AE7988962A17596529C11D50F84FD64CD16. 6 actual-instruction status cases per each4 app formats (24 assertions): DE, OE+PE, UE+PE, PE, stack overflow/underflow IE+SF. Overflow/underflow on single-precision store, not extended-range overflow. Existing actual invalid/divzero #MF,4 rounding modes, full registers/timer/isolation retained. Negative copy wrong DE expectation triggers FAIL unexpected exit; runner rejects. Unmasked #MF delivery for DE/OE/UE/PE not tested; do not promote masked proof to that claim. CoreWork1: shared source unchanged; generator and receipt ready to integrate via review. Same PowerShell PID 45860; no new windows/models; Windows untouched.

2026-11-13 CoreWork2 UNMASKED remaining x87 PASS: C:\Nori\nori-os\.work\x87-unmasked-20261113\proof-UG0Hk5, serial SHA256 0952E8113ADDC32F331505239D24424D128BECA4E7D21DD3341BBAD0B97EBACE. 16 new actual CPU #MF deliveries across four app formats: DE/OE/UE/PE with each exact unmasked cause asserted. Each app resumes through handler and checks acknowledgement; six total handled faults/app required, all apps exit correctly. OE/UE raised by extended->binary32 store. Prior full-register/timer/isolation/rounding regressions retained. Source changes isolated to .work/x87-unmasked-20261113; generator/kernel plus receipt ready for CoreWork1 review. Broad Linux/Windows per-class ABI signal/exception-code mapping NOT qualified (existing subset maps these through generic non-invalid path). Existing shell PID 45860, no new windows/model changes, Windows untouched.

2026-11-13 CoreWork2 per-class FP mapping VERIFIED in isolated C:\Nori\nori-os\.work\fp-code-mapping-20261113, proof-3uNb26. All six arithmetic x87 classes exercised in EACH ELF32/ELF64/PE32/PE32+ app; 32 exact handler-code assertions total including original x87/SSE cases. Linux codes invalid7/denormal5/divzero3/overflow4/underflow5/inexact6; Windows C0000090/008D/008E/0091/0093/008F. Negative candidate deliberately maps Linux denormal to overflow: guest rejects and runner fails as expected. Existing scheduling/isolation/full register/rounding checks pass. receipt.json pins source and serial hashes. CoreWork1: integrate kernel mapping and generator expectations by review into your current source, preserving newer signal/unwind work; shared source NOT modified here. Unmasked stack code and complete per-class SSE/general OS ABI are not claimed. Commands ran in same live PowerShell PID45860. No new windows, model changes, or Windows installation changes.

CoreWork2 2026-11-13 SSE/stack matrix PASS: .work/fp-sse-stack-20261113/proof-bJg95q. 64 exact-code handler checks (16/app), all six SSE unmasked classes and x87 stack overflow/underflow in ELF32/PE32/ELF64/PE32+. CPU cause asserted; SF/IE and C1 distinguish actual stack overflow/underflow. Linux stack=FLTINV7, Windows stack=C0000092. All prior x87, full-register, rounding, timer/isolation regressions pass. receipt.json pins source/serial. CoreWork1 notified to integrate into current shared kernel preserving nested signals/unwind; integration pending, no shared edits by Work2. Same live PowerShell, no app/model changes.

CoreWork2 independent integrated verification PASS 2026-11-13: current kernel64-first-boot built/run via SAME live PowerShell. Proof proof-uExORH, 64 handled faults (16 each ELF32/PE32/ELF64/PE32+),8 CPU stack SF/IE/C1 assertions, all six SSE and x87 arithmetic classes, exact user code checks. Source hashes unchanged across run; .work/fp-sse-stack-20261113/integrated-receipt.json pins source/proof. CoreWork1 integrated preserving nested signals and PE cleanup. Negative wrong Windows stack code now explicitly FAIL unexpected exit; prior timeout not counted. Mapping integration DONE, not merely isolated staging. Full general Linux/Windows ABI remains out of scope.

CoreWork2 independent NEXT COMPAT PASS: shared kernel64-first-boot proof-yqrhqg, .work/next-compat-20261113/receipt.json. Source hashes unchanged. ELF32/64 blocked SIGUSR1 twice coalesces into one delivery; pending mask includes SIGFPE+SIGUSR1, both delivered, si_signo and SI_USER checked. PE64 child saves/clobbers XMM6; unwind restores all128 bits, parent compares. Near UWOP_SAVE_XMM128 exercised; XMM7-15/FAR not directly qualified. Prior64 FP faults,8stack assertions, register/timer/isolation and cleanup regressions retained. rt_sigaction query/oldaction remains open. Same live PowerShell, no desktop/model changes.

CoreWork2 QUERY/FAR integrated independent PASS: shared kernel proof-D1oS5p, .work/query-far-20261113/receipt.json and metadata.json. Hashes unchanged. ELF32/64 query full action, replacement/old action, changed mask, invalid size/pointer rejection and aliased buffers tested; first isolated invalid-pointer fixture used address1 incorrectly, corrected to0xffffffff before PASS. XMM6-15 all128bits restored after deliberate clobber; independent built PE parser confirms near6-14 and actual FAR opcode9 XMM15 offset160. Prior64 FP faults and four-app VM suite retained. Same live PowerShell, shared integration DONE. No general OS compatibility claim.

CoreWork2 continuing REA 2026-11-13: statically analyzed installed C:\Program Files\Nori\resources\app.asar hash82d17760aabcb624cae58dd499811c751eb7d2d7bfa4697f91d096942e654666. Selected desktop/main.cjs + desktop/native-service.cjs, native-service artifact hashf8f259ac55b4eaf4eb1d75e976b7b377b0ca0704fee20b9cae6b374b70c50b6f. REA evidence ev_508bb2878941be45098dc43f55723d0261b1805018049502c5e564e0e4f8544f, summary .work/rea-startup-20261113.json. Static partial coverage; no guest startup/runtime acceptance. Next examine selected startup dependencies toward M5. CoreWork1 notified. Kelp name acknowledged per owner decision on board; no installed changes or new windows.

CoreWork2 REA dependency finding 2026-11-13: installed archive 4b204104ddec05081d06cc75b8d6a1e441ef6e9744eb6f3250424899b99b868b. Extracted FOUR exact inventoried files read-only with hashes in .work/rea-startup-selected/startup-dependencies.json. packagedRuntimeMode defaults gpt-oss; video-capable wrapper delegates startGptOssService; gpt-oss-service pins engine/gpt-oss-runtime/build/bin/llama-server.exe. Legacy native-service also defaults Windows python.exe and automatic interpreter identity gate, but not evidence of selected packaged path. Existing boot_nori_desktop_guest_20261112.py explicitly synthetic; fixture-service launches fixture-model.cjs, so cannot qualify real model startup. Next M5 seam: owned Linux model-service adapter with pinned Linux executable/model plus cleanup/readiness; preserve installed app. No guest/model launch this pass. CoreWork1 retains shared integration ownership.

### Real guest startup diagnostics (2026-11-13, Work2)
Runner: nori-os/scripts/boot_nori_real_guest_20261113.py. Guest helpers in nori-os/scripts/guest_real_20261113/: real-driver.cjs saves readiness/chat/cleanup and failure display/process snapshots; renderer-diagnostics.cjs records bounded inspection phases and heartbeat, with explicit guest-only early visibility; startup-profile.cjs records lifecycle and local debugger samples without a remote port. Regression tests: nori-os/scripts/test_renderer_diagnostics_20261113.cjs and nori-os/scripts/test_startup_profile_20261113.cjs. Evidence: nori-os/.build/nori-real-guest-*. Latest r13 passed interface checks but failed real chat; see the shared board for current results. Guest evidence does not qualify installed Windows or full OS acceptance. Original readiness/context/isolation gates remain in force.

Actual orb graphics isolation: nori-os/scripts/boot_orb_graphics_smoke_20261113.py stages an explicitly pinned JS/CSS/Electron bundle in an offline4GiBguest; guest_real_20261113/orb-graphics-smoke.cjs checks responsive actualorb and60smovingframes. r1original failed; r2softwareadaptive candidate passed with manualframeinspection. This is graphics-only evidence, notfullstackacceptance.

Guest integration: scripts/guest_real_20261113/guest-orb-asset.cjs resolves only the pinned orb after original localPage validation; launcher.cjs exact main overlay uses it for asset hashing and serving. Full-stack continuation r15 stages the fixed candidate root-owned/mode444/read-only and extracts owner-heartbeat.json. This is an isolated guest test, not an installed Windows change.
