(function () {
  'use strict';

  var TRANSFER_ROW_ID = 'income-internal-transfers';

  function appState() { return window.state || null; }
  function number(value) { var n = Number(value || 0); return Number.isFinite(n) ? n : 0; }
  function clean(value) { return String(value == null ? '' : value).trim().replace(/\s+/g, ' '); }

  function accountById(accountId) {
    var state = appState();
    return state && Array.isArray(state.accounts)
      ? state.accounts.find(function (account) { return account && account.id === accountId; })
      : null;
  }

  function accountBucket(accountId) {
    var state = appState();
    if (!state) return null;
    if (window.VeyraAccountBudgets && typeof window.VeyraAccountBudgets.capture === 'function' && state.activeAccountId) {
      window.VeyraAccountBudgets.capture(state.activeAccountId);
    }
    return state.accountBudgets && state.accountBudgets[accountId] ? state.accountBudgets[accountId] : null;
  }

  function monthFromBucket(bucket, monthName) {
    return bucket && Array.isArray(bucket.months)
      ? bucket.months.find(function (month) { return month && month.name === monthName; }) || null
      : null;
  }

  // Non-cash "special funding" pairs (e.g. employer non-cash benefits that fund
  // a matching expense category) never touch real cash, and the amounts don't
  // always land in the same month as each other. headerMetrics() in app.js
  // already excludes both sides entirely from real cash math for this reason;
  // mirror that here so VeyraFinancialEngine's closingBankBalance doesn't pick
  // up the unspent/unmatched portion as phantom cash. See audit note v2.5.0.
  function specialFundingConfigForMonth(month) {
    if (typeof specialFundingSourceConfig !== 'function') return null;
    try {
      var state = appState();
      return specialFundingSourceConfig(state, month);
    } catch (e) { return null; }
  }

  function isSpecialFundingIncomeRow(row, month) {
    var config = specialFundingConfigForMonth(month);
    if (!config || config.enabled === false) return false;
    return !!clean(config.incomeName) && clean(row && row.name) === clean(config.incomeName);
  }

  function isSpecialFundingExpenseRow(row, month) {
    var config = specialFundingConfigForMonth(month);
    if (!config || config.enabled === false) return false;
    return !!clean(config.expenseName) && clean(row && row.name) === clean(config.expenseName);
  }

  function coreRowActual(row) {
    if (!row) return 0;
    if (row.internalTransferRow || row.id === TRANSFER_ROW_ID) return 0;
    if (typeof rowActual === 'function') return number(rowActual(row));
    var transactions = Array.isArray(row.transactions) ? row.transactions : [];
    var transactionTotal = transactions.reduce(function (sum, transaction) {
      if (transaction && (transaction.internalTransferMirror || transaction.cashImpactHandledByTransfer && transaction.transferId)) return sum;
      return sum + number(transaction && transaction.amount);
    }, 0);
    if (row.fixed || row.toggleBased) {
      if (Math.abs(transactionTotal) > 0.00001) return transactionTotal;
      return row.fixedPaid ? number(row.planned) : 0;
    }
    return transactionTotal;
  }

  function incomeActual(month) {
    return (month && Array.isArray(month.income) ? month.income : []).reduce(function (sum, row) {
      if (row && (row.internalTransferRow || row.id === TRANSFER_ROW_ID)) return sum;
      if (isSpecialFundingIncomeRow(row, month)) return sum;
      return sum + coreRowActual(row);
    }, 0);
  }

  function savingsActual(month) {
    return (month && Array.isArray(month.savings) ? month.savings : []).reduce(function (sum, row) {
      return sum + coreRowActual(row);
    }, 0);
  }

  function expenseGroups(month) {
    var groups = [];
    (month && Array.isArray(month.expenses) ? month.expenses : []).forEach(function (row) {
      var group = clean(row && row.group) || 'Unassigned';
      if (groups.indexOf(group) < 0) groups.push(group);
    });
    return groups;
  }

  function withBucketSubscriptions(bucket, callback) {
    var state = appState();
    if (!state) return callback();
    var previous = state.subscriptions;
    state.subscriptions = Array.isArray(bucket && bucket.subscriptions) ? bucket.subscriptions : [];
    try { return callback(); }
    finally { state.subscriptions = previous; }
  }

  function spendingActual(bucket, month) {
    if (!month) return 0;
    return withBucketSubscriptions(bucket, function () {
      return expenseGroups(month).reduce(function (total, group) {
        var rows = (month.expenses || []).filter(function (row) {
          return (clean(row && row.group) || 'Unassigned') === group && !isSpecialFundingExpenseRow(row, month);
        });
        if (typeof expenseTabCategoryTotalForGroup === 'function') {
          return total + number(expenseTabCategoryTotalForGroup(month, group, rows));
        }
        return total + rows.reduce(function (sum, row) { return sum + coreRowActual(row); }, 0);
      }, 0);
    });
  }

  function transferMonth(transfer) {
    if (transfer && transfer.monthName) return transfer.monthName;
    if (!transfer || !transfer.date) return '';
    var date = new Date(String(transfer.date) + 'T12:00:00');
    return isNaN(date.getTime()) ? '' : date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  }

  function transferNet(accountId, monthName) {
    var state = appState();
    var transfers = state && Array.isArray(state.accountTransfers) ? state.accountTransfers : [];
    return transfers.reduce(function (net, transfer) {
      if (!transfer || transfer.status !== 'completed' || transferMonth(transfer) !== monthName) return net;
      if (transfer.toAccountId === accountId) net += number(transfer.amount);
      if (transfer.fromAccountId === accountId) net -= number(transfer.amount);
      return net;
    }, 0);
  }

  function openingBalance(accountId) {
    var account = accountById(accountId);
    return number(account && account.openingBalance);
  }

  function metrics(accountId, monthName) {
    var bucket = accountBucket(accountId);
    var month = monthFromBucket(bucket, monthName);
    var income = incomeActual(month);
    var spending = spendingActual(bucket, month);
    var savings = savingsActual(month);
    var transfers = transferNet(accountId, monthName);
    var opening = openingBalance(accountId);
    return {
      accountId: accountId,
      monthName: monthName,
      openingBalance: opening,
      income: income,
      spending: spending,
      expenses: spending,
      savings: savings,
      transferNet: transfers,
      closingBankBalance: opening + income - spending - savings + transfers,
      monthMovement: income - spending - savings + transfers,
      hasMonth: !!month
    };
  }

  function allAccounts(monthName) {
    var state = appState();
    return state && Array.isArray(state.accounts)
      ? state.accounts.filter(function (account) { return account && !account.archived; }).map(function (account) {
          var result = metrics(account.id, monthName);
          result.account = account;
          return result;
        })
      : [];
  }

  window.VeyraFinancialEngine = {
    version: '2.5.0',
    rowActual: coreRowActual,
    incomeActual: incomeActual,
    savingsActual: savingsActual,
    spendingActual: spendingActual,
    transferNet: transferNet,
    metrics: metrics,
    allAccounts: allAccounts
  };
}());
