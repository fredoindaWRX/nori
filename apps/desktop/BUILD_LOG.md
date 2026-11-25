# Nori local assistant build log

## 2026-10-22 — initial architecture assessment

### Goal

Build Nori's own local, Dots-style assistant: persistent Nori identity and user-editable memory, specialist workers, durable background tasks with visible progress, safe approvals, and usable desktop/mobile access. Use public Dots behavior as a product reference only; preserve Nori's original implementation, local data path, identity, and approval rules.

### Current source evidence

- `apps/desktop/bridge/local-chat.mjs` exposes a narrowly bounded Nori-project reader and selected attachment-copy writing. Its policy explicitly excludes shell execution and arbitrary writes.
- `apps/desktop/bridge/aider-tools.mjs` provides the local Aider coding worker. `apps/desktop/bridge/nori-v2-query.mjs` routes coding tasks separately from ordinary conversation.
- `apps/desktop/desktop/computer-host.cjs` and `apps/desktop/bridge/computer-control-session.mjs` provide an approval-gated, time-limited path for inspecting and acting on one user-selected application window. This is not a general shell or filesystem worker.
- `apps/desktop/desktop/remote-control-service.cjs` contains a local remote-control service; its end-to-end availability, pairing, and mobile task continuity have not yet been verified in this assessment.
- A bounded source search did not find a System/Shell Neuron or a durable general-purpose background-task queue. This is a source-search finding, not proof about the installed package.
- REA's static analysis of `C:\Program Files\Nori\resources\app.asar` timed out at its 300-second tool deadline. A separate REA archive-identification request is still pending. Shipped-package findings therefore remain unverified until that request settles or a supported narrower REA analysis succeeds.

### Reference behavior and design decision

Public Dots documentation describes persistent notes distinct from conversation history, tasks that continue between conversations, visible activity/progress, follow-up/stop controls, cross-device access, and approval checks that remain in force for delegated and background actions. Nori should implement those behaviors with her own local data store and local workers; never copy proprietary code or rely on private account data.

Start with the highest-impact missing capability identified in the supplied goal: a System Neuron for scoped filesystem operations and command execution. It must be opt-in, bind every operation to a selected workspace, show the exact proposed action in a native approval dialog, execute without a shell, enforce path and process limits, return a verifiable result, and remain separate from Aider and REA. No approval will be bypassed, and no user files will be used for the acceptance test.

### Next

1. Finish the installed-artifact REA check or record its concrete limitation.
2. Trace the current native approval/IPC boundary and durable task persistence before choosing integration points.
3. Implement the System Neuron contract plus negative and positive tests in an isolated synthetic workspace.
4. Verify a harmless end-to-end task, then proceed to durable background progress, memory lifecycle, and desktop/mobile continuity.
