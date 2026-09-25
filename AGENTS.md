# Project briefing

Veyra (Your Money Brain) is a browser-based personal budgeting app for monthly income, expenses, savings, multiple accounts, transfers, and forecasts. Data is stored locally, with Google sign-in, Drive sync, and shared-budget features. `index.html` is the landing/sign-in page; `app.html` is the budgeting workspace.

## Stack and architecture
- Static HTML, CSS, and vanilla JavaScript; no package manifest, bundler, or backend source is present.
- `js/core/app.js`: central state, budget calculations, rendering, charts, and event handlers; other core files provide financial reporting, navigation indicators, and card visibility.
- `js/data/`: identity-scoped storage, account schema/migration, backups, Google/Drive sync, shared connections, and brand/config globals.
- `js/features/`: accounts, transfers/rules, CSV import, credit cards, Smart Insights, usage, achievements, and user guide.
- `js/ui/`: theme toggle, layout shell, and modal coordination.
- `js/vendor/`: bundled LZString and PDF.js. Dependencies are loaded by classic script tags in HTML.
- `styles/`: main app styling and feature/override sheets. Landing page loads root `landing.css`; a separate `styles/landing.css` also exists.
- `assets/`: logo asset; another logo exists at root.
- `FINANCIAL_ENGINE.md` and `TRANSFER_RECORDS_CHANGELOG.md`: accounting invariants and transfer history.
- `sw.js` and `js/core/sw.js`: differing worker copies; see NOTES before changing caching.
- `CNAME` and `CNAME.txt`: custom domain records. ZIP distribution archives do not belong in this repository.

## Commands
- Install: none required for app dependencies; vendored scripts are committed. No `npm install` workflow exists.
- Dev: serve the repo root with a static HTTP server, then open `/app.html` or `/index.html`.
  Optional external tool: `npx --yes http-server . -p 8000 -c-1` (requires Node/npm and downloads a tool; not a repo script).
- Build: none; HTML/CSS/JS are served directly.
- Test: no automated test runner or test suite found. Syntax-check changed JavaScript with `node --check <file>`; this does not validate browser behavior.
- Lint: no configured linter. Use `git diff --check` for whitespace errors.
- Target Chrome, Brave, Firefox, Edge, Safari, and comparable mainstream browsers. Minimum versions are not specified; avoid assuming Chromium-only behavior is sufficient.
- Manually check affected flows in light/dark themes and relevant viewport sizes; use disposable budget data for destructive flows.
- Windows environment fallback when Git is absent from PATH: `& 'C:\Program Files\Git\cmd\git.exe' <args>` in PowerShell.

## Publishing and offline requirements
- Owner intends code updates to reach the live website through pushes to GitHub. Hosting configuration has not been verified; do not claim a deployment succeeded from a push alone.
- Core budgeting should work offline. Local saving and Google cloud saving/sync are distinct: cloud sync requires connectivity.
- When implementing network-dependent features, clearly indicate offline mode, unavailable cloud sync/AI, and stale investment prices. See NOTES for deferred implementation work.

## Conventions and patterns
- Classic scripts share globals and `window.Veyra*` APIs; many feature modules use IIFEs and defensive guards. Preserve dependency/load order in `app.html`.
- Named camelCase helpers, DOM IDs, event listeners, and template-string HTML are common; use existing `escapeHtml` helpers when interpolating user text.
- Match nearby formatting: older modules use `var`, newer sections use `const`/`let`; quote and indentation styles vary. Avoid unrelated reformatting.
- CSS uses custom properties and `html[data-theme="dark"]`; some legacy overrides also use `.dark-mode` and `!important`.
- Inspect late-loaded `styles/overview-spacing.css` and selector specificity before changing a component's appearance. Prefer existing theme variables over fixed hover colors.
- Use the existing EUR formatting and financial helpers rather than adding parallel formulas.

## Hard rules
- Never count transfer mirrors as a second cash/budget movement. Canonical `accountTransfers` owns cash impact; mirror rows are derived reporting data.
- Use `VeyraFinancialEngine.metrics(accountId, monthName)` / `.allAccounts(monthName)` for account reporting instead of independently recomputing totals (see FINANCIAL_ENGINE.md).
- Do not break identity isolation or silently rename persisted storage keys; preserve migration/backup behavior.
- Drive sync snapshot application must not mutate stale live `window.state`; its existing path writes persisted data and reloads (see `js/data/drive-sync.js`).
- Preserve all financial math rules and interactions between features unless a flaw is demonstrated. Before correcting one, document a reproducible example, expected versus actual results, and effects on related calculations; validate the correction and affected flows. Do not change accounting behavior as an incidental part of UI work.
- Do not add ZIP distribution archives to the repository.

## Session protocol
- At session start: read docs/PROGRESS.md and docs/NOTES.md before doing anything.
- Before any commit or push you make, and whenever I say "wrap up": update docs/PROGRESS.md and docs/NOTES.md per the rules in each file, then include them in the commit.
- Only change AGENTS.md when something stable changes (stack, structure, commands, conventions). Never put session state in it.
