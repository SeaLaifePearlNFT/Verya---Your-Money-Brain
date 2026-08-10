(function () {
  'use strict';

  var DATA_VERSION = 2;
  var DEFAULT_ACCOUNT_ID = 'account-main';
  var BACKUP_KEY = 'budget_dashboard_v12_pre_accounts_v2';

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function makeDefaultAccount() {
    return {
      id: DEFAULT_ACCOUNT_ID,
      name: 'Main Account',
      type: 'current',
      currency: 'EUR',
      openingBalance: 0,
      currentBalance: null,
      icon: 'wallet',
      color: '',
      isDefault: true,
      includeInNetWorth: true,
      archived: false,
      // 'private' (default): only visible to the signed-in identity that owns this
      // browser's data. 'shared': syncs to a Drive file both partners can read/write.
      // See Stage 1 of the sync/sharing build — visibility has no effect yet until
      // Stage 4 (sync engine) reads it.
      visibility: 'private',
      createdAt: new Date().toISOString()
    };
  }

  function validAccounts(accounts) {
    return Array.isArray(accounts) && accounts.some(function (account) {
      return isObject(account) && typeof account.id === 'string' && account.id.trim();
    });
  }

  function ensureAccounts(state) {
    if (!validAccounts(state.accounts)) state.accounts = [makeDefaultAccount()];

    state.accounts = state.accounts.filter(function (account) {
      return isObject(account) && typeof account.id === 'string' && account.id.trim();
    }).map(function (account, index) {
      return Object.assign({
        name: index === 0 ? 'Main Account' : 'Account ' + (index + 1),
        type: 'current',
        currency: 'EUR',
        openingBalance: 0,
        currentBalance: null,
        icon: 'wallet',
        color: '',
        isDefault: index === 0,
        includeInNetWorth: true,
        archived: false,
        visibility: 'private'
      }, account);
    });

    var defaultAccount = state.accounts.find(function (account) { return account.isDefault && !account.archived; })
      || state.accounts.find(function (account) { return !account.archived; })
      || state.accounts[0];

    state.accounts.forEach(function (account) { account.isDefault = account.id === defaultAccount.id; });

    var activeExists = state.accounts.some(function (account) {
      return account.id === state.activeAccountId && !account.archived;
    });
    if (!activeExists) state.activeAccountId = defaultAccount.id;

    return defaultAccount.id;
  }

  function tagTransactions(rows, accountId) {
    if (!Array.isArray(rows)) return;
    rows.forEach(function (row) {
      if (!isObject(row)) return;
      if (!row.accountId) row.accountId = accountId;
      if (Array.isArray(row.transactions)) {
        row.transactions.forEach(function (transaction) {
          if (isObject(transaction) && !transaction.accountId) transaction.accountId = accountId;
        });
      }
    });
  }

  function tagCollection(collection, accountId) {
    if (!Array.isArray(collection)) return;
    collection.forEach(function (item) {
      if (isObject(item) && !item.accountId) item.accountId = accountId;
    });
  }

  function attachExistingData(state, accountId) {
    if (Array.isArray(state.months)) {
      state.months.forEach(function (month) {
        if (!isObject(month)) return;
        if (!month.accountId) month.accountId = accountId;
        tagTransactions(month.income, month.accountId);
        tagTransactions(month.savings, month.accountId);
        tagTransactions(month.expenses, month.accountId);
        tagCollection(month.goals, month.accountId);
        tagCollection(month.subscriptions, month.accountId);
        tagCollection(month.debts, month.accountId);
      });
    }

    [
      'subscriptions', 'debts', 'debtProfiles', 'financialGoals', 'goals',
      'recurringTransactions', 'csvImportBatches', 'creditCards', 'creditCardCharges'
    ].forEach(function (key) { tagCollection(state[key], accountId); });

    if (isObject(state.debtState)) {
      tagCollection(state.debtState.items, accountId);
      tagCollection(state.debtState.debts, accountId);
      tagCollection(state.debtState.profiles, accountId);
    }
  }

  function migrateState(state, options) {
    if (!isObject(state)) return state;
    options = options || {};

    var previousVersion = Number(state.dataVersion || 1);
    if (previousVersion < DATA_VERSION && options.rawStorageSnapshot && !localStorage.getItem(BACKUP_KEY)) {
      try { localStorage.setItem(BACKUP_KEY, options.rawStorageSnapshot); } catch (_error) {}
    }

    var accountId = ensureAccounts(state);
    attachExistingData(state, accountId);
    state.dataVersion = Math.max(previousVersion, DATA_VERSION);
    return state;
  }

  function getActiveAccount(state) {
    if (!isObject(state) || !Array.isArray(state.accounts)) return null;
    return state.accounts.find(function (account) { return account.id === state.activeAccountId; }) || null;
  }

  window.VeyraAccountsFoundation = {
    DATA_VERSION: DATA_VERSION,
    DEFAULT_ACCOUNT_ID: DEFAULT_ACCOUNT_ID,
    BACKUP_KEY: BACKUP_KEY,
    migrateState: migrateState,
    getActiveAccount: getActiveAccount
  };
}());
