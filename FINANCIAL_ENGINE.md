# Veyra Financial Engine 2.4

`js/core/financial-engine.js` is the reporting source of truth for account/month totals.

## Owned metrics

- Income: actual Income-tab rows, excluding system-managed internal-transfer visibility rows.
- Spending: the same category totals used by the Expenses tab. Paid subscriptions are added only when they do not yet have a matching ledger transaction.
- Savings: actual Savings-tab rows.
- Transfer net: completed incoming transfers minus completed outgoing transfers for the selected month.
- Closing bank balance: opening balance + income - spending - savings + transfer net.

## Consumers

The All Accounts overview and transfer reporting now consume `window.VeyraFinancialEngine` rather than maintaining a separate expense formula.

Future views should call `VeyraFinancialEngine.metrics(accountId, monthName)` or `VeyraFinancialEngine.allAccounts(monthName)` instead of recalculating totals.

### Transfer mirror reporting vs cash impact

Internal account-transfer mirror rows are presentation/accounting records, not a second cash ledger. `rowActual()` therefore continues to return zero for transfer mirrors. The Expenses workspace uses a separate signed reporting calculation for these rows: completed outgoing transfers are positive Financial activity, completed incoming transfers are negative Financial activity. Planned/cancelled/skipped transfers remain zero in Actual totals. This separation is required so category and grand-total reporting is complete while bank cash and Available Funds are changed exactly once by the transfer engine.

### Budget Allocation account-transfer mirrors
Completed transfer mirrors have separate reporting and budget-consumption semantics. The source/destination transfer changes `Available Funds` through the account-transfer engine. The Financial category in Budget Allocation displays the signed mirror via `reportingActual`, but allocation usage/remaining calculations use `budgetActual` and therefore do not deduct/add the same transfer twice.

### Transfer classification vs cash impact

Account transfer classification is presentation/reporting metadata only. A transfer may be reported in Income, Savings & Investments, or Expenses on each side independently. The canonical `accountTransfers` record remains the only source of balance and Available Funds movement. Generated mirror transactions are excluded from ledger `rowActual()` and are included only in reporting totals through the reporting-actual layer. This prevents a user-selected category from ever changing the transfer's underlying accounting treatment.


## User-defined transfer reporting invariant
Transfer classification is reporting-only. The canonical transfer object owns cash impact. Available Funds uses genuine income rows plus completed transfer net. Reporting mirrors are excluded from rowActual cash/budget impact and use signed presentation values derived from transfer direction and selected reporting section.
