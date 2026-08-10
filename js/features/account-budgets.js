(function () {
  'use strict';

  var SCOPED_KEYS = [
    'months','activeMonth','subscriptions','usageItems','debt','debts','debtProfiles','financialGoals','financialGoalHistory','goals',
    'recurringTransactions','csvImportBatches','creditCards','creditCardCharges','debtState'
  ];

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function state() { return window.state || null; }

  function ensureStore(s) {
    if (!s.accountBudgets || typeof s.accountBudgets !== 'object' || Array.isArray(s.accountBudgets)) {
      s.accountBudgets = {};
    }
    return s.accountBudgets;
  }

  function capture(accountId) {
    var s = state();
    if (!s || !accountId) return null;
    var bucket = {};
    SCOPED_KEYS.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(s, key)) bucket[key] = clone(s[key]);
    });
    ensureStore(s)[accountId] = bucket;
    return bucket;
  }

  function load(accountId) {
    var s = state();
    if (!s || !accountId) return false;
    var bucket = ensureStore(s)[accountId];
    if (!bucket) return false;
    SCOPED_KEYS.forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(bucket, key)) s[key] = clone(bucket[key]);
      else delete s[key];
    });
    s.activeAccountId = accountId;
    return true;
  }

  function clearRowActivity(row, keepPlanned) {
    if (!row || typeof row !== 'object') return;
    if (Array.isArray(row.transactions)) row.transactions = [];
    ['actual','spent','received','paid','progress','current','currentAmount','realised','realized'].forEach(function(k){
      if (typeof row[k] === 'number') row[k] = 0;
    });
    if (!keepPlanned) {
      ['planned','budget','target','amount','monthlyAmount','expected','allocation','allocated'].forEach(function(k){
        if (typeof row[k] === 'number') row[k] = 0;
      });
    }
  }

  function sanitizeMonth(month, keepPlanned) {
    var m = clone(month || {});
    ['income','savings','expenses'].forEach(function(key){
      if (Array.isArray(m[key])) m[key].forEach(function(row){ clearRowActivity(row, keepPlanned); });
    });
    m.scenario = null;
    m.lockedForecast = null;
    m.splitwise = {};
    m.splitwiseCategories = {};
    m.goals = [];
    m.goalRolloverLink = null;
    m.rolloverLink = null;
    return m;
  }


  function neutralStarterMonth(name) {
    function income(id, group, label) { return { id:id, type:'VARIABLE', group:group, name:label, planned:0, toggleBased:false, transactions:[] }; }
    function savings(id, group, label, classification) { return { id:id, type:'VARIABLE', group:group, name:label, planned:0, classification:classification || 'savings', transactions:[] }; }
    function expense(id, group, label, fixed) { return { id:id, type:fixed ? 'FIXED' : 'VARIABLE', group:group, name:label, planned:0, fixed:!!fixed, transactions:[] }; }
    return {
      name: name || new Date().toLocaleString('en-US',{month:'long',year:'numeric'}),
      income:[
        income('income-salary','Primary Income','Salary'),
        income('income-other','Primary Income','Other Income'),
        income('income-noncash','Work','Non-Cash Benefits'),
        income('income-rollover','Adjustments','Spillover previous Month'),
        income('income-splitwise','Shared Expenses','Shared Expenses')
      ],
      savings:[
        savings('savings-core','Savings','Emergency Fund','savings'),
        savings('savings-goals','Savings','Short-Term Goals','savings'),
        savings('savings-invest','Investments','Investments','investment')
      ],
      expenses:[
        expense('expense-rent','Housing','Rent / Mortgage',true),
        expense('expense-utilities','Housing','Utilities',true),
        expense('expense-insurance','Housing','Insurance',true),
        expense('expense-internet','Connectivity','Internet',true),
        expense('expense-mobile','Connectivity','Mobile',true),
        expense('expense-tv','Connectivity','TV',true),
        expense('expense-groceries','Groceries','Groceries',false),
        expense('expense-noncash','Essentials','Non-Cash Benefits',false),
        expense('expense-health','Health','Health',false),
        expense('expense-leisure','Leisure','Leisure',false),
        expense('expense-financial','Financial','Financial',false)
      ],
      incomeCategoryOrder:['Primary Income','Work','Adjustments'],
      savingsCategoryOrder:['Savings','Investments'],
      expenseCategoryOrder:['Housing','Connectivity','Groceries','Essentials','Health','Leisure','Financial'],
      savingsCategoryAllocations:{},
      allocationTargets:{groceries:18,transport:8,eatingOut:8,shopping:8,leisure:8,health:5,other:5,savings:25},
      splitwise:{}, splitwiseCategories:{}, scenario:null, goals:[], goalRolloverLink:null, rolloverLink:null,
      forecastLockDay:5, lockedForecast:null,
      specialFundingSource:{label:'Non-Cash Benefits',incomeName:'Non-Cash Benefits',expenseName:'Non-Cash Benefits',expenseTargetType:'category',expenseTargetKey:'Essentials',enabled:true}
    };
  }

  function monthIndexByName(name) {
    var parsed = new Date(String(name || '') + ' 1');
    return isNaN(parsed.getTime()) ? null : parsed.getFullYear() * 12 + parsed.getMonth();
  }

  function makeBucketFromSource(sourceId, mode) {
    var s = state();
    var store = ensureStore(s);
    capture(s.activeAccountId);
    var source = store[sourceId] || store[s.activeAccountId] || {};
    var sourceMonths = Array.isArray(source.months) ? source.months : [];
    var activeName = source.activeMonth;
    var activeIndex = sourceMonths.findIndex(function(m){ return m && m.name === activeName; });
    if (activeIndex < 0) activeIndex = Math.max(0, sourceMonths.length - 1);
    var relevantMonths = sourceMonths.slice(activeIndex);
    if (!relevantMonths.length) relevantMonths = [null];
    var keepPlanned = mode === 'copy-planned';
    var months = relevantMonths.map(function(sourceMonth){
      var monthName = sourceMonth && sourceMonth.name ? sourceMonth.name : new Date().toLocaleString('en-US',{month:'long',year:'numeric'});
      var month = mode === 'blank' ? neutralStarterMonth(monthName) : sanitizeMonth(sourceMonth, keepPlanned);
      if (!month.name) month.name = monthName;
      return month;
    });
    return {
      months: months,
      activeMonth: months[0].name,
      // Subscriptions are operational, account-owned records. Budget setup modes
      // may copy structure/planned values, but must never clone subscriptions.
      subscriptions: [],
      usageItems: [],
      debt: { version: 6, debts: [], scenarios: [], settings: { selectedDebtId: null, simulator: {}, simulatorByMonth: {} } },
      debts: [], debtProfiles: [], financialGoals: [], financialGoalHistory: [], goals: [], recurringTransactions: [],
      csvImportBatches: [], creditCards: [], creditCardCharges: [],
      debtState: { items: [], debts: [], profiles: [] }
    };
  }

  function ensureForwardMonths(accountId) {
    var s = state();
    if (!s || !accountId) return;
    var store = ensureStore(s);
    var bucket = store[accountId];
    var reference = store[s.defaultAccountId] || store[(s.accounts || []).find(function(a){return a.isDefault;})?.id] || store[s.activeAccountId];
    if (!bucket || !reference || !Array.isArray(reference.months)) return;
    if (!Array.isArray(bucket.months)) bucket.months = [];
    var existing = {};
    bucket.months.forEach(function(m){ if(m && m.name) existing[m.name]=true; });
    var firstIdx = bucket.months.length ? monthIndexByName(bucket.months[0].name) : null;
    reference.months.forEach(function(refMonth){
      if (!refMonth || !refMonth.name || existing[refMonth.name]) return;
      var idx = monthIndexByName(refMonth.name);
      if (firstIdx != null && idx != null && idx < firstIdx) return;
      var fresh = neutralStarterMonth(refMonth.name);
      bucket.months.push(fresh);
      existing[refMonth.name]=true;
    });
    bucket.months.sort(function(a,b){ return (monthIndexByName(a.name)||0)-(monthIndexByName(b.name)||0); });
  }

  function retag(value, accountId) {
    if (Array.isArray(value)) { value.forEach(function(item){ retag(item, accountId); }); return; }
    if (!value || typeof value !== 'object') return;
    if (Object.prototype.hasOwnProperty.call(value, 'accountId')) value.accountId = accountId;
    Object.keys(value).forEach(function(key){ retag(value[key], accountId); });
  }

  function createForAccount(accountId, options) {
    var s = state();
    if (!s || !accountId) return;
    options = options || {};
    var bucket = makeBucketFromSource(options.sourceAccountId || s.activeAccountId, options.mode || 'blank');
    retag(bucket, accountId);
    ensureStore(s)[accountId] = bucket;
  }

  function switchAccount(accountId) {
    var s = state();
    if (!s || !accountId || accountId === s.activeAccountId) return true;
    capture(s.activeAccountId);
    if (!ensureStore(s)[accountId]) createForAccount(accountId, { mode: 'blank', sourceAccountId: s.activeAccountId });
    ensureForwardMonths(accountId);
    load(accountId);
    if (typeof window.saveState === 'function') window.saveState(s);
    if (typeof window.render === 'function') window.render();
    window.dispatchEvent(new CustomEvent('veyra:account-budget-switched',{detail:{accountId:accountId}}));
    return true;
  }

  function removeAccount(accountId) {
    var s = state();
    if (!s) return;
    var store = ensureStore(s);
    delete store[accountId];
  }

  function removeLegacyClonedSubscriptions() {
    var s = state();
    if (!s) return false;
    var store = ensureStore(s);
    var accountIds = Object.keys(store);
    if (accountIds.length < 2) return false;

    var defaultId = s.defaultAccountId || ((s.accounts || []).find(function(a){ return a && a.isDefault; }) || {}).id || '';
    var orderedIds = accountIds.slice().sort(function(a, b) {
      if (a === defaultId) return -1;
      if (b === defaultId) return 1;
      return 0;
    });
    var ownerBySubscriptionId = Object.create(null);
    var changed = false;

    orderedIds.forEach(function(accountId) {
      var bucket = store[accountId];
      if (!bucket || !Array.isArray(bucket.subscriptions)) return;
      bucket.subscriptions = bucket.subscriptions.filter(function(subscription) {
        if (!subscription || subscription.id == null) return true;
        var id = String(subscription.id);
        if (!id) return true;
        if (!ownerBySubscriptionId[id]) {
          ownerBySubscriptionId[id] = accountId;
          return true;
        }
        // Old "copy structure" builds cloned subscriptions with the same ID.
        // Keep the first/original owner (default account has priority) and remove
        // only the duplicate clone. Independently created subscriptions use new IDs.
        changed = true;
        return false;
      });
    });
    return changed;
  }


  function emptyDebtStore() {
    return { version: 6, debts: [], scenarios: [], settings: { selectedDebtId: null, simulator: {}, simulatorByMonth: {} } };
  }

  function migrateLegacyAccountOwnedData() {
    var s = state();
    if (!s) return false;
    var store = ensureStore(s);
    var defaultId = s.defaultAccountId || ((s.accounts || []).find(function(a){ return a && a.isDefault; }) || {}).id || s.activeAccountId;
    if (!defaultId) return false;
    if (!store[defaultId]) capture(defaultId);
    var owner = store[defaultId] || (store[defaultId] = {});
    var changed = false;

    // These features historically lived at root state and therefore appeared in
    // every account. Existing legacy records belong to the Main/default account.
    if (Array.isArray(s.usageItems) && !Object.prototype.hasOwnProperty.call(owner, 'usageItems')) {
      owner.usageItems = clone(s.usageItems);
      changed = true;
    }
    if (s.debt && typeof s.debt === 'object' && !Object.prototype.hasOwnProperty.call(owner, 'debt')) {
      owner.debt = clone(s.debt);
      changed = true;
    }
    if (Array.isArray(s.financialGoalHistory) && !Object.prototype.hasOwnProperty.call(owner, 'financialGoalHistory')) {
      owner.financialGoalHistory = clone(s.financialGoalHistory);
      changed = true;
    }

    Object.keys(store).forEach(function(accountId) {
      var bucket = store[accountId];
      if (!bucket) return;
      if (!Object.prototype.hasOwnProperty.call(bucket, 'usageItems')) { bucket.usageItems = []; changed = true; }
      if (!Object.prototype.hasOwnProperty.call(bucket, 'debt')) { bucket.debt = emptyDebtStore(); changed = true; }
      if (!Object.prototype.hasOwnProperty.call(bucket, 'financialGoalHistory')) { bucket.financialGoalHistory = []; changed = true; }
      // Month goals are account-owned and must never be inherited operationally.
      if (Array.isArray(bucket.months)) bucket.months.forEach(function(month) {
        if (month && !Array.isArray(month.goals)) { month.goals = []; changed = true; }
      });
    });

    // Re-apply the currently selected account after migration so root-state
    // feature modules read only that account's operational records.
    var activeId = s.activeAccountId || defaultId;
    var active = store[activeId];
    if (active) {
      s.usageItems = clone(active.usageItems || []);
      s.debt = clone(active.debt || emptyDebtStore());
      s.financialGoalHistory = clone(active.financialGoalHistory || []);
    }
    return changed;
  }

  function initialize() {
    var s = state();
    if (!s) return setTimeout(initialize, 30);
    var store = ensureStore(s);
    if (!store[s.activeAccountId]) capture(s.activeAccountId);
    var cleaned = removeLegacyClonedSubscriptions();
    var migrated = migrateLegacyAccountOwnedData();
    if ((cleaned || migrated) && typeof window.saveState === 'function') window.saveState(s);
  }

  window.VeyraAccountBudgets = {
    SCOPED_KEYS: SCOPED_KEYS.slice(),
    capture: capture,
    load: load,
    createForAccount: createForAccount,
    switchAccount: switchAccount,
    removeAccount: removeAccount,
    ensureForwardMonths: ensureForwardMonths
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize);
  else initialize();
}());
