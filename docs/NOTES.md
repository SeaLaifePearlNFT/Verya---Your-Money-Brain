# Durable notes

Pruning rule: never delete a decision unless it's been reversed. When reversed, replace it with the new decision and a one-line note of what it replaced. Merge duplicate gotchas. Remove gotchas that no longer apply because the code changed.

Update rule: before every commit/push and at "wrap up", add or correct durable findings and dated decisions with their reasons; review existing notes for stale facts. If nothing durable changed, record that review in the current PROGRESS session entry. Include both memory files in the commit.

## Decisions
- 2026-09-25: Owner chose one adaptive application with shared financial logic and data, rather than independent phone/desktop builds that could diverge. Phone prioritizes expense/savings entry, balances, safe spending, categories, debt, and subscriptions; desktop provides broader analytics. Cross-device data continuity requires sync, distinct from shared code updates.
- 2026-09-25: Preserve a committed baseline before mobile work. Proposed next step is an isolated branch/worktree and separate local preview with disposable data and Google sync disconnected, instead of experimenting on production or maintaining a permanent fork. Owner authorized only the checkpoint, push, and wrap-up this session; worktree creation is still pending.
- 2026-09-25: Owner specifies GitHub pushes as the publishing workflow rather than a separate manual upload. Hosting configuration is still unverified.
- 2026-09-25: Core budgeting should work offline; network-only operation would prevent the desired offline use. Distinguish local saving from unavailable Google cloud saving/sync, and show offline status for future AI/live-price features so users do not mistake stale prices or unsynced changes for current cloud data. Owner considers this implementation a lower priority for now.
- 2026-09-25: Owner requires preserving all financial math and cross-feature interactions, rather than changing behavior during routine cleanup. Corrections are allowed when a flaw is demonstrated; document the evidence and validate related calculations.
- 2026-09-25: Remove the tracked ZIP and keep distribution ZIP archives out of the repo; the owner says it should not be there. Retaining/updating it as a release artifact is no longer the policy.
- 2026-09-25: Target Chrome, Brave, Firefox, Edge, Safari, and comparable mainstream browsers rather than a single browser engine. Owner requested broad support; exact minimum versions and release checks remain unspecified.
- 2026-09-25: Keep stable instructions in AGENTS.md, work state in PROGRESS.md, and durable reasoning in NOTES.md, as requested by the owner. This avoids mixing changing session state into the briefing loaded every session.
- 2026-09-25 (existing design verified; original date unknown): Account reporting uses `VeyraFinancialEngine`; canonical transfers own cash movement and generated mirrors only affect reporting. Counting mirrors as ordinary ledger cash would double-count transfers. Sources: FINANCIAL_ENGINE.md, TRANSFER_RECORDS_CHANGELOG.md, financial-engine.js.
- 2026-09-25 (existing design verified; original date unknown): Identity isolation wraps localStorage while leaving default local-identity keys unchanged. Unlike rewriting every consumer or migrating all local keys, this preserves existing storage access and local data. Full proxy enumeration was deliberately omitted to avoid browser Storage proxy-invariant problems (identity.js comments).
- 2026-09-25: Use existing dark theme tokens for Tools & Actions hover/focus instead of its fixed white background, which made light text unreadable. Preserve danger-button styling and light-theme rules; browser validation remains pending.

## Gotchas
- Entry points differ: `/index.html` is landing/sign-in; `/app.html` is the actual dashboard. Serve the repository root over HTTP for local previews.
- No package.json, lockfile, build/test/lint runner, or checked-in CI workflow was found. Do not claim `npm test`/build/lint ran; `node --check` only parses JavaScript.
- Identity loads before other storage users. Main budget key is `budget_dashboard_v12`; accounts-foundation.js handles schema version 2 and a pre-migration backup. LZString is used by persistence/sync paths; do not assume every stored blob is plain JSON.
- Drive sync writes restored snapshots to persisted storage then reloads. Its comments explicitly prohibit using stale live `window.state` or transfer APIs during snapshot application because that previously corrupted the restore path.
- Service-worker conflict: index.html registers root `sw.js` (v6), while app.html unregisters workers and removes `veyra-shell-*` caches. `js/core/sw.js` is a separate v9 copy, not the worker registered by index.html. Do not infer active behavior from old deploy comments alone.
- Landing HTML loads root `landing.css`, but worker asset lists mention `styles/landing.css`. Both exist; trace consumers before editing duplicate files.
- CSS has extensive historical overrides; overview-spacing.css loads after main.css. Theme toggle sets/removes `html[data-theme="dark"]`, storing preference under `veyra-theme`.
- Forecast headline/status now use the live projection even after lock; the frozen locked value remains a comparison. See `bf39f2f` and smart-insights-engine.js; preserve the distinction when changing forecast UI.
- Google sync config contains public client-side OAuth/Picker identifiers; no backend config is present. Authorized origins and provider-console settings cannot be established from this repo alone.
- In this Windows session Git was absent from PATH but available at `C:\Program Files\Git\cmd\git.exe`; Python's WindowsApps alias failed. Node was available. A temporary Node preview used port 8000; do not assume that process survives a new session.
- Read/write source as UTF-8: default Windows PowerShell decoding displayed mojibake for existing symbols; that display alone is not evidence of file corruption.

## Ideas / parked
- Deferred: reconcile service-worker registration/removal and validate offline reload/local budgeting; implement clear connectivity/cloud-sync status and future AI/price-feed offline handling when prioritized. Offline support is a requirement, not a verified current capability.
- Deployment verification remains technical follow-up: CNAME points to `veyrafinance.com`; GitHub Pages is mentioned in source comments, but hosting settings and automatic publishing from GitHub have not been inspected.
- Parked: determine the role of duplicate worker/landing/logo files from their consumers before proposing cleanup. ZIP removal does not authorize deleting these assets.
- TODO: establish minimum supported browser versions and a practical release-validation process; the browser families are confirmed, but no automated testing rollout has been agreed.
