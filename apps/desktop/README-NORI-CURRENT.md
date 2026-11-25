# N.O.R.I. Desktop — current Nori guide

N.O.R.I. is one locally operated desktop assistant in the canonical `C:\Nori` product root. The old Cortana name is historical lineage only. The desktop shell is at `C:\Nori\apps\desktop`; it is the user-facing app, not a second assistant beside the Nori core.

## Canonical runtime and update rule — 2026-10-18

Maintain one canonical Nori orchestration/runtime path and one host-owned capability-routing contract and manifest. Extend them when adding capabilities; do not create parallel Nori brains, duplicate dispatchers, or a competing runtime for each app. ArtCraft apps and other local engines remain separate providers behind that common contract because their binaries and dependencies cannot literally be combined into one file. A provider is available only when the active Nori runtime can discover it, route a request through the validated Neuralese boundary, and verify its result.

The required update design has one canonical install target. The installer applies a verified update to that target; users should not be asked to choose among a growing set of runtime candidates. Keep at most one previous verified copy solely for rollback, not as a second selectable runtime. Build only one temporary update at a time, verify it before applying it, and do not accumulate retry outputs as release candidates. Preserve user state separately from replaceable program files. Failed diagnostic outputs are not releases and should be cleaned through the authorized cleanup path; never remove the current runtime or its sole rollback copy during promotion.

Implementation status: the installer declares one stable AppId and the default install target `{autopf}\Nori`, so it is configured as one product/install target rather than a version picker. Actual install, upgrade-in-place, modify, rollback, and user-state preservation have not been exercised on Windows, so those behaviors remain unverified. Separately, the developer Start Menu launcher still selects an unpacked candidate through `release/current-desktop.txt`; that pointer is a development-launch mechanism, not a version choice in the installer.

The `native-installer-r3` receipt reports a successful compile and hashed installer volumes, but explicitly records `releaseVerified: false`, `setupLaunched: false`, and `installedSuiteVerified: false`. It is a build artifact, not proof of an installed or fully working Nori release. The release pointer remains authoritative for the selected desktop.

## Current verified state

As of 2026-10-18, `release/current-desktop.txt` selects `image-runtime-20261018-r2`. That selected build has not been replaced. The r3 desktop and suite candidate folders remain present. The r3 installer build completed: its receipt records `compiled: true`, `packagedAppIdentityVerified: true`, and hashes for the setup executable and three data volumes. It also explicitly records `releaseVerified: false`, `setupLaunched: false`, `installedSuiteVerified: false`, and `publisherAuthenticated: false`. Therefore r3 is a built candidate, not a verified installed release. Do not change the launch pointer or claim the Windows installation is qualified from this receipt alone.

The r3 packaged ArtCraft workflow suite passed 14/14 cases across 13 local app CLIs (synthetic isolated create/read/edit/save operations) via Nori's Neuralese dispatch boundary. The `local-chat` plus Neuralese suite passed 41/41 tests, including synthetic GPT-OSS and NorLlama app routing. These results verify the packaged CLI and mocked/local-chat contracts; they do not verify every GUI feature, a live model-selected request through the installed desktop, or installed-release behavior.

The same 14/14 packaged ArtCraft workflow suite was rerun against the currently selected `image-runtime-20261018-r2` package on 2026-10-18. FilmCraft, PDFCraft, FigCraft, PhotoCraft, VectorCraft, EffectCraft, DesignCraft, WordCraft, SoundCraft, DeckCraft, CADCraft, GridCraft, and LightCraft each completed an isolated create/read/edit/save workflow through Neuralese; the suite removed its temporary workspaces. This qualifies these local CLI workflows only, not every GUI feature or arbitrary user project.

The selected r2 package's bundled ComfyUI image runtime was started directly from its packaged Python/ComfyUI files on loopback with isolated temporary input/output/user directories. `/system_stats` became ready in about 25 seconds. Nori's source `generateImage()` route accepted a validated Neuralese image-intent frame and produced a 512x512 PNG with the bundled Z-Image Turbo, Qwen text encoder, and VAE; the image was visually inspected and depicts a red 1993 Honda Civic del Sol with gold mesh wheels. Output SHA-256: `89d0138b6ba98caf859d791e20a6ff5d0408d4f3670d2d40031404ca21913aec`; preserved result: [artcraft-image-r2-smoke-20261018.png](../../verification/artcraft-image-r2-smoke-20261018.png). The image-provider unit suite passed 8/8. The test-owned Comfy process was stopped and the selected pointer remained r2. This verifies the packaged image engine plus Nori's image-route adapter, not the full desktop's autostart, chat UI display, or saved-output UX.

The isolated r3 packaged desktop startup probe also reached `READY` with local imported GPT-OSS 20B online. Sensor and screen capture were denied, writes were disabled, and the probe reported cleanup pass with no owned processes remaining. The same receipt reports `toolsQualified: false` and `taskExecutionQualified: false`; this startup check does not qualify general Nori task execution.

A separate live GPT-OSS 20B synthetic local-chat test passed through the Neuralese-only VectorCraft route, saved a 503-byte editable SVG, and shut down its model runtime and temporary workspace cleanly. It used the locally bundled 12,109,564,352-byte model, with no cloud or Ollama. A source/package comparison found 430 receipt-listed Python/JavaScript source files identical between `C:\Nori` and the r3 NoriSuite; this is a bounded code comparison, not a full-build comparison. The live test did not exercise the desktop GUI/WebSocket path.

Sections below dated 2026-10-14 describe historical candidates and tests, not the current selection. GPT-OSS remains an imported inference model, not a Nori-trained SoN checkpoint. The current release still requires the relevant live desktop, tool-routing, and installed-app checks before it can be called fully working.

The historical r4 package included privacy-safe desktop lifecycle events (ready, boot complete, renderer loaded, shutdown, bounded failures, and final outcome). That historical implementation does not establish current r2/r3 lifecycle behavior. Its event format recorded no prompts, transcripts, raw errors, or credentials; logging was best-effort if the local journal runtime was unavailable.

The SoN roadmap remains `NOT_VERIFIED`: the teacher corpus is not admitted for training, training is not authorized, there is no trained or serving SoN checkpoint, and native tool execution is not qualified. See [the authoritative Nori roadmap](../../docs/NORI-LOCAL-AI-WORKSPACE-ROADMAP.md), [the current SoN review status](../../verification/son-current-review-status-20261014-r4.json), and [the latest desktop diagnostic receipt](../../verification/nori-gpt-oss-ui-diagnostic-candidate-20261012-r1.json).

## Spatial workspace source and package candidate — 2026-10-14

The source renderer now includes a `SPACE` surface with CORE, WORK, SYSTEMS, MODELS, and NOTES areas; live bridge/model/tool state; connected systems and open surfaces; locally stored notes and placements; search; drag/keyboard arrangement; pan/zoom; a bounded read-only Nori project browser; and a typed symbolic Neuralese node/edge projection. The MODELS area includes Qwen3.6-35B-A3B as a selectable **catalog visualization/candidate**, plus the Nori SoN target and the actual runtime-reported model. Selecting the Qwen catalog node does not download, load, or activate it.

A separate Windows unpacked candidate, `spatial-workspace-20261014-r4`, has been assembled from the hash-verified `spatial-workspace-20261014-r2` native stage. Its native payload matches the source manifest (12,918 files / 5,906,143,111 bytes); the complete package is 6,799,336,498 bytes. Portable integrity passed. R3 fixed an acceptance-probe packaging omission by shipping `probe-deadlines.cjs`; r4 also fixes GPT-OSS readiness reporting, which previously dereferenced the NorLlama-only runtime status.

The packaged r4 GUI reached READY in a generated protected profile with sensors/capture denied and durable writes disabled. Its GPT-OSS mode reported the imported 20B model online; a short synthetic request returned `Hey Will! How can I help today?` through the packaged bridge, and the test session shut down cleanly with no owned processes remaining. The earlier r3 NorLlama packaged conversation probe also passed hello, identity, follow-up, personality/style persistence across restart, synthetic memory recall, read-only action denial, and cleanup, using temporary imported Llama 3.2 3B weights. These are local smoke tests, not independent model-quality evaluations, a visible keyboard/mouse chat test, microphone/wake qualification, or durable action authorization.

At the time of the r4 receipt, `release/current-desktop.txt` selected r4, and the observed Start Menu shortcut resolved through that pointer while retaining its GPT-OSS launch flag. The pointer now selects r5. The unpacked candidates are not publisher-authenticated, and installed-suite behavior has not been verified.

The complete serial desktop acceptance suite subsequently exited 0: 1,070 tests, 1,054 passed, 0 failed, and 16 explicitly skipped. The exact totals are recorded in `C:\Nori\verification\spatial-workspace-package-20261014-r4.json`. After the context-fitter change, it passed again with 1,071 total, 1,055 passed, 0 failed, and 16 explicitly skipped. That run and r5's portable integrity check are recorded in `C:\Nori\verification\spatial-workspace-package-20261014-r5.json`. These validate covered source and package bytes; they do not qualify SoN, model quality, live microphone/wake, real tool actions, or Windows installer behavior.

Qwen's official model card describes 35B total parameters with 3B active, multimodal input, and 73.4 SWE-bench Verified. The screenshot's file size, 8 GB GPU / 13 GB RAM allocation, and 50–121 tok/s remain unverified estimates. Nori has no qualified Qwen runtime adapter or installed weights; it must not be advertised as loadable until the model artifact, compatible adapter, hardware measurements, and end-to-end model-switch test pass. The spatial source receipt is [here](../../verification/spatial-workspace-source-20261014-r2.json); the package-candidate verification is [here](../../verification/spatial-workspace-package-20261014-r2.json).

R4 was launched in isolated probes, but it has not been installed via a Windows installer. R5 is selected and its fresh live chat remains pending. Custom rooms, workspace writes, qualified Knight dispatch, and qualified hand-navigation remain open. SoN still has no proven trained/serving checkpoint. Do not call the spatial workspace or overall Nori desktop complete on this evidence.

## SoN source architecture and tokenizer qualification — 2026-10-14

Freshly reran the selected `son20b_v1` source-geometry and bounded native-tokenizer qualification. The source-bound graph matches 19,996,647,424 parameters, the selected 4,361-ID vocabulary, and the native parameter layout; the bounded synthetic native parity probe stayed within the unchanged tolerance. Receipt: `C:\Nori\verification\son-v1-tokenizer-geometry-qualified-20261014-r1.json`.

This clears only source-geometry and bounded native-runtime consistency. The receipt explicitly reports no training-quality tokenizer adoption, admitted dataset, training authorization, full-scale model load, trained checkpoint, or serving qualification. The current corpus receipt still records incomplete semantic dispositions, unresolved hash bindings, unapplied category/version corrections, and teacher-source-byte gaps. The full SoN training and serving objective is therefore still open; do not begin training or claim a working SoN brain from this result.

## Launch Nori on Windows

Use the **Nori** shortcut in the per-user Start Menu. It resolves the selected package through `release/current-desktop.txt` and requests local GPT-OSS 20B. The selected package is `spatial-workspace-20261014-r5`. The prior running r4 instance does not hot-reload this candidate; quit Nori from its tray menu before a live r5 check. R5 package integrity is verified, but its visible chat is not yet verified. SoN and action tools remain unqualified.

If Nori is already open, don’t start a second model instance. Quit the existing app through its tray/window controls before a controlled package replacement or a second live test. A new package must pass package integrity and launch checks before it is selected as current.

## Development commands

Run commands from `C:\Nori\apps\desktop`:

```powershell
npm run build
npm test
npm run desktop:gpt-oss
```

`npm run desktop:gpt-oss` builds and launches the source Electron app using the local imported GPT-OSS model. It is a development run, not a packaged release or proof of a Nori-trained brain. `npm run desktop` uses the NorLlama/Norama source runtime path and may select a different model/runtime mode.

Focused tests are useful evidence for the exact component they cover. A passing build or unit suite does not prove microphone/wake operation, successful desktop chat, qualified tool execution, SoN training, or a serving checkpoint. Use Nori’s [append-only project journal](../../verification/project-history/PROJECT_HISTORY_STATUS.json) and the versioned receipts under `C:\Nori\verification` for evidence; never put prompts, transcripts, credentials, or private profile content in ordinary project logs.

## Identity and capability boundary

- Nori is the product and assistant identity. Cortana is not an active app, agent, or project root.
- GPT-OSS is explicitly labeled as an imported interim model. It is not called Nori’s own trained brain.
- The GPT-OSS conversation route is local and chat-only; it does not make durable changes or execute action tools.
- A planned SoN architecture, a source test, a package manifest, or a readiness flag is not a trained or serving checkpoint. Claim those only after the exact artifact is built, served, and independently qualified.
