# Automatic account-transfer records

- A transfer remains the single source of truth.
- Veyra automatically creates a protected `Financial > Account Transfers` expense row in both affected accounts.
- The source account receives an outgoing positive record.
- The destination account receives an incoming negative record.
- Planned and completed records stay linked through `transferId`.
- The mirror records use `cashImpactHandledByTransfer: true` and `internalTransferRow: true`, so balances and Available Funds are changed only by the transfer engine.
- Editing, completing, cancelling, or deleting the transfer refreshes/removes both mirror records automatically.
- The older destination-only `Income > Internal Transfers` mirror is removed during synchronization.

## Expense reporting totals rebuild

Transfer mirrors now have two deliberately separate meanings:

- **Cash impact:** always `0` on the mirror row. The account-transfer engine remains the sole source of bank-balance and Available Funds movement.
- **Expense reporting impact:** completed outgoing mirrors contribute their positive amount to Expenses → Financial → Account Transfers; completed incoming mirrors contribute the same amount with a negative sign.

Only `completed` transfer records participate in Expense sub-category, Financial category, and Expenses grand totals. Planned, skipped, and cancelled records never enter Actual totals. This keeps the Expenses workspace traceable without double-counting the underlying cash movement.

## Budget Allocation transfer visibility

Completed account-transfer mirror rows now participate in Budget Allocation **reporting** for their Financial category while remaining excluded from **budget consumption** and ledger cash impact.

- Outgoing completed mirror: positive Financial activity in the source account.
- Incoming completed mirror: negative Financial activity in the destination account.
- `Available Funds` continues to be adjusted by the transfer engine exactly once.
- Category cards expose `reportingActual` and signed `transferActivity`.
- Allocation usage / remaining / overspend calculations continue to use `budgetActual`, which excludes transfer mirrors.
- Expense-category drill-downs use the same reporting value so the category card, detail panel, and Expenses workspace agree.

This is intentional: transfers are visible everywhere a user audits monthly financial activity, but they never consume the same budget twice.


## Transfer route edit rebuild — 2026-08-07

- Transfer mirror records are now treated as fully derived data.
- Every transfer sync first removes all generated transfer mirrors from every account/month, then regenerates them from the canonical `accountTransfers` list.
- Editing source account, destination account, month, amount, date, or status therefore cannot leave stale records behind.
- Route reversal test: Shared → Main edited to Main → Shared correctly swaps both signed Financial mirrors without changing the transfer's single cash-impact source of truth.

## User-defined transfer reporting classification

- Each transfer now stores independent outgoing and incoming reporting classifications.
- A classification contains a workspace (`income`, `savings`, or `expenses`), category/group, and sub-category/row.
- Transfer mirrors are embedded as protected derived transactions inside the selected existing row instead of forcing every transfer into Financial → Account Transfers.
- Reporting signs follow workspace semantics: Income/Savings use outgoing negative and incoming positive; Expenses use outgoing positive and incoming negative.
- The canonical transfer remains the sole source of cash, Available Funds, and account-balance impact. Mirror transactions carry `cashImpactHandledByTransfer: true` and are excluded from `rowActual()` / financial-engine cash math.
- Income, Savings, Expenses, and Budget Allocation reporting use a separate reporting actual that includes completed transfer mirrors.
- Editing a transfer classification deterministically removes the old mirror transaction and regenerates it in the newly selected row.
- Protected transfer transactions cannot be manually edited or deleted from the row workspace; they are managed from Account Transfers.
- Transfer Rules now also store outgoing/incoming reporting classifications so recurring generated transfers remain consistently categorized.


## Transfer math + explainability fix
- Available Funds now sums every genuine income row, including user-created categories/sub-categories.
- Generated Shared Expenses settlement rows remain reimbursements and are not redistributed as fresh Available Funds.
- Completed account transfers affect Available Funds exactly once through transfer net.
- Transfer mirror signs are derived from direction + reporting section, not trusted from stored sign:
  - Expenses: outgoing positive, incoming negative.
  - Income/Savings: incoming positive, outgoing negative.
- Added Explain this number breakdowns for Safe to Spend, Bank Account, Available Funds, and Used from available funds.
