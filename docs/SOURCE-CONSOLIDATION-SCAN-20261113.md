# One-source scan, 2026-11-13

Wil: "make sure we are not working in worktrees and everything in the project updates to one source, and not
scattered around either. Do a scan to confirm." This is the read-only scan. Nothing was moved, merged or deleted.

## Verdict: not one source yet

### 1. 26 git worktrees are still registered

| Where | Count |
|---|---|
| `C:\Nori` (main checkout) | 1 |
| `C:\Nori\dev\worktrees\*` | 19 |
| `C:\Nori\worktrees\nori-aider-approval`, `C:\Nori\h`, `C:\Nori-worktrees\rea-routing-20261026` | 3 |
| `C:\Users\Studio\.cline\worktrees\*` (Cline) | 3 |

**Empty:** 14 of them have no uncommitted changes and no commits past the baseline (`838244d9`). Removing these loses nothing.

**Not empty:** these hold work that still has to be reviewed before the worktree goes. The table shows uncommitted files and commits past the baseline.

| Worktree | Uncommitted | Commits |
|---|---|---|
| nori-dots-current-source | 46 | +117 |
| neuralese-artcraft-results | 1,491 | 0 |
| codex-norama-qwen36-native | 328 | 0 |
| neuralese-durable-commit | 0 | +6 |
| all-worktrees-integration | 0 | +5 |
| autopilot-safety | 0 | +3 |
| `C:\Nori\h` | 5 | +2 |
| dev-team-cline | 0 | +1 |
| heretic-compatibility-audit | 0 | +1 |
| nori-rea-desktop-tools | 9 | 0 |
| aider-native-worker | 4 | 0 |
| aider-chat-handoff | 3 | 0 |

There are also 24 branches. A branch keeps its commits after its worktree is removed.

### 2. The main checkout has never been committed past the baseline

`C:\Nori` has 1 commit and about 39,300 staged or changed files. Git is not yet recording history for the real source.

### 3. The installed app and `apps/desktop` have drifted apart in both directions

Compared R87 (`4B204104`, what is installed) against `apps/desktop`, ignoring node_modules and line endings. Of 959 installed files:

- 831 are identical.
- 83 differ: bridge 47, desktop 23, dist 7, public 5, plus package.json.
- 45 exist only in the installed app: bridge 11, desktop 7, dist 27.

Among the 47 differing bridge files, 31 were edited in source after 10-30, many on 11-10 (Codex backports). The installed copies also carry R66 to R87 fixes that source lacks. So each file needs a three-way merge. Copying either side over the other would lose work.

### 4. Other scattered copies

- `.work\` holds 339 stage and verification folders. Many contain full app extracts (`x\`). They fall under `docs/ARTIFACT-RETENTION-POLICY.md`.
- Nested repos sit inside the project: `nori-os\.git`, `e2e-test-workspace`, `NoriLabs\*`, `dev\neurons-coding-acceptance`, and 4 under `.work\phone-protocol-audit-*`.
- Nori's Python Core and engine run from `C:\Program Files\Nori\resources\NoriSuite`. This scan did not compare them with source.

## Proposed path to one source (needs Wil's go-ahead; Codex Core Work 1 is install coordinator)

1. Freeze: no new worktrees. All agents work only in `C:\Nori` on `main`, and stage under `.work\` only for builds.
2. Reconcile `apps/desktop` with installed R87, one file at a time, using a three-way merge with the R85/R84 extracts as the common base. Keep both sides' fixes and run the bridge tests. Codex already started this port on 11-10, so coordinate with them first.
3. Commit the reconciled main checkout. That becomes the single source. After that, every install is built from source, not patched onto an extract.
4. For each non-empty worktree: commit its leftover changes to its own branch, then merge or decline them into main one at a time. Then `git worktree remove` it. Branches stay, so nothing is lost.
5. Remove the 14 empty worktrees.
6. Sort `.work\` and the nested repos under the retention policy (Recycle Bin, never permanent delete), then re-run this scan to confirm.

## Result (2026-11-13, same day)

- **apps/desktop = installed R87.** Snapshot of the old source: commit `be1ed85c`. Alignment: commit `8e64e5e3`. 605 installed files were compared: all match, apart from `package.json` (the build manifest). The installed app was not changed (it still hashes to `4B204104…868B`).
- **Three-way merge tried and rejected.** It merged 57 files automatically but silently dropped newer installed features (owned-coding checks, scoped native reads and others), and 12 tests broke that pass on both sides. So the installed code wins, and the ~1,000 genuinely source-only lines are listed for deliberate porting with their 38 tests in `docs/SOURCE-PORT-LIST-20261113.md`.
- **Worktrees: 22 of 25 removed from git.** Tracked leftovers were committed to their branches: `feat/aider-chat-handoff`, `feat/aider-native-worker`, `codex/norama-qwen36-native` (328 Norama engine files), `codex/nori-dots-current-source`, `feat/nori-rea-desktop-tools` and `wip/h-20261113`. The folders, including gigabytes of untracked verification data, were moved, not deleted, to `.work/archive/worktrees-20261113/`. Only Cline's 3 worktrees remain registered; Cline was running, and the retention policy protects its state.
- **Still separate on purpose:** `nori-os/` (Codex's active Nori OS repo), the test-fixture repos (`e2e-test-workspace`, `NoriLabs/*`, `dev/neurons-coding-acceptance`) and Nori's Python Core under Program Files (not compared yet).
- Rule added to `AGENTS.md`: "One source, no worktrees".
