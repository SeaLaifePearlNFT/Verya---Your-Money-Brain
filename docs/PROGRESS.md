# Progress

Pruning rule: keep only the last 5 session entries in full. Condense older ones into an "Earlier" summary of one line per milestone. Delete completed next steps. Remove anything stale.

Update rule: before every commit/push and at "wrap up", refresh focus, next steps, blockers, and the current session entry from observed results. Record validation limits; include this file and NOTES.md in the commit.

## Current focus
Checkpoint of the existing app before starting an adaptive phone/desktop interface. This checkpoint includes the Tools & Actions dark-mode hover/title fix, persistent project memory, and removal of the unwanted ZIP. No mobile redesign or separate worktree has been created.

## Next steps
1. Create an isolated development branch/worktree for the adaptive interface, preserving the current main workspace. This session was limited to the checkpoint and push.
2. Use a separate preview origin with disposable data and Google sync disconnected; establish financial regression scenarios before redesigning screens.
3. Start with phone Home and quick expense/savings entry, sharing existing financial logic and retaining desktop functionality.
4. Verify the pending hover/focus appearance in a browser. Before pushing a development branch, verify hosting publishes only the intended production branch.

## Open questions / blockers
- Browser appearance of the hover fix has not been verified; whitespace checks passed.
- GitHub publishing and offline use are requirements. Hosting configuration is unverified; conflicting service-worker behavior needs investigation when offline work is prioritized.
- Browser minimum versions and release checks remain unspecified. No automated test/lint runner or CI workflow was found.
- Duplicate source assets remain unchanged pending investigation.

## Recent sessions
### 2026-09-25 - Checkpoint and wrap-up
- Prepared the UI fix, memory files, and ZIP deletion as the recoverable baseline requested for main; user authorized committing and pushing to GitHub.
- Reviewed durable notes and recorded the shared mobile/desktop direction and isolated-development plan. Whitespace checks passed; browser/deployment verification was not performed.
- This entry is recorded before the checkpoint commit/push; use Git history and remote status to confirm their outcome.

### 2026-09-25 - Publishing and offline requirements
- Recorded GitHub pushes as the intended publishing path and offline core budgeting with clear cloud-sync/live-feature limitations.
- Offline implementation is lower priority; hosting/offline behavior was not tested.

### 2026-09-25 - Owner policies and archive cleanup
- Recorded financial math/interaction safeguards and Chrome, Brave, Firefox, Edge, Safari support; removed the unwanted ZIP.
- Changes are included in the wrap-up checkpoint; no financial logic changed.

### 2026-09-25 - Project memory setup
- Inspected structure, script/style loading, storage/sync, accounting docs, configs, and recent commits; created AGENTS.md, PROGRESS.md, and NOTES.md.
- Documented source-backed rules and unresolved policies.

### 2026-09-25 - Tools & Actions polish
- Capitalized Actions in trigger, heading, and accessible label; added dark theme hover/focus colors for non-danger drawer buttons and close button.
- Whitespace checks passed; browser verification pending. Included in the wrap-up checkpoint.

## Earlier
- 2026-09-25: dashboard/chart/Smart Insights updates pushed as bf39f2f; changed JS syntax and whitespace checks passed, browser behavior untested.
- 2026-09-15: loan and rollover fixes (b0a8466, Git history).
- 2026-08-27: shared-account rollover updates (10aec32, Git history).
- 2026-08-21: Drive sync fix (336db45, Git history).
