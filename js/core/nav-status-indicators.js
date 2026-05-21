/* ══════════════════════════════════════════════════════
   Navigation Phase 3: contextual status indicators
   UI-only read model for the grouped nav cards.
   ══════════════════════════════════════════════════════ */
(function() {
  'use strict';

  let scheduled = false;

  function scheduleNavStatusRefresh() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(function() {
      scheduled = false;
      updateVeyraNavStatusIndicators();
    });
  }

  function activeMonth() {
    try {
      if (typeof window.getActiveMonth === 'function') return window.getActiveMonth();
    } catch (e) {}
    try {
      let appState = window.state || {};
      let months = Array.isArray(appState.months) ? appState.months : [];
      return months.find(function(month) { return month && month.name === appState.activeMonth; }) || months[0] || null;
    } catch (e) {}
    return null;
  }

  function rowActual(row) {
    if (!row || typeof row !== 'object') return 0;
    if (typeof window.rowActual === 'function') {
      try { return Number(window.rowActual(row) || 0); } catch (e) {}
    }
    let txTotal = Array.isArray(row.transactions)
      ? row.transactions.reduce(function(sum, tx) { return sum + Number(tx && tx.amount || 0); }, 0)
      : 0;
    if (row.fixed || row.toggleBased) return txTotal || (row.fixedPaid ? Number(row.planned || 0) : 0);
    return txTotal;
  }

  function transactionCount(rows) {
    if (!Array.isArray(rows)) return 0;
    return rows.reduce(function(count, row) {
      if (!row || typeof row !== 'object') return count;
      if (Array.isArray(row.transactions) && row.transactions.length) return count + row.transactions.length;
      return count + (rowActual(row) > 0 ? 1 : 0);
    }, 0);
  }

  function currentMonthTone(month) {
    try {
      if (typeof window.monthDayStats === 'function' && month && month.name) {
        return window.monthDayStats(month.name).daysLeft <= 0 ? { label: 'Closed', tone: 'neutral' } : { label: 'Live', tone: 'good' };
      }
    } catch (e) {}
    return { label: 'Live', tone: 'good' };
  }

  function getDebtCount(month) {
    try {
      if (typeof window.ensureDebtState === 'function') {
        let debtState = window.ensureDebtState(window.state || {});
        if (debtState && Array.isArray(debtState.debts)) return debtState.debts.length;
      }
    } catch (e) {}
    if (month && Array.isArray(month.debts)) return month.debts.length;
    return 0;
  }

  function getSubscriptionCount(month) {
    let subs = month && Array.isArray(month.subscriptions) ? month.subscriptions : [];
    if (!subs.length) return 0;
    try {
      if (typeof window.activeSubscriptionMonthKey === 'function' && typeof window.getSubscriptionStatus === 'function') {
        let monthKey = window.activeSubscriptionMonthKey();
        return subs.filter(function(sub) {
          let status = window.getSubscriptionStatus(sub, monthKey);
          return status === 'due' || status === 'paid' || status === 'active';
        }).length || subs.length;
      }
    } catch (e) {}
    return subs.length;
  }

  function getSubscriptionDueCount(month) {
    let subs = month && Array.isArray(month.subscriptions) ? month.subscriptions : [];
    if (!subs.length) return 0;
    try {
      if (typeof window.activeSubscriptionMonthKey === 'function' && typeof window.getSubscriptionStatus === 'function') {
        let monthKey = window.activeSubscriptionMonthKey();
        return subs.filter(function(sub) { return window.getSubscriptionStatus(sub, monthKey) === 'due'; }).length;
      }
    } catch (e) {}
    return subs.filter(function(sub) { return String(sub && sub.status || '').toLowerCase() === 'due'; }).length;
  }

  function getUsageTrackedCount() {
    try {
      if (typeof window.getUsageItems === 'function') return window.getUsageItems().length;
    } catch (e) {}
    try {
      let usage = window.state && window.state.usage;
      if (usage && Array.isArray(usage.items)) return usage.items.length;
    } catch (e) {}
    return 0;
  }

  function getUsageDueCount() {
    try {
      if (typeof window.dueCount === 'function') return Number(window.dueCount() || 0);
    } catch (e) {}
    let pill = document.getElementById('usageDuePill');
    let value = pill && pill.textContent ? parseInt(pill.textContent, 10) : 0;
    return Number.isFinite(value) ? value : 0;
  }

  function getGoalCount(month) {
    if (month && Array.isArray(month.goals)) return month.goals.length;
    return 0;
  }

  function setStatus(viewName, label, tone) {
    let btn = document.querySelector('[data-view-btn="' + viewName + '"]');
    if (!btn) return;
    let status = btn.querySelector('[data-nav-card-status]');
    if (!label) {
      if (status) status.remove();
      return;
    }
    if (!status) {
      status = document.createElement('span');
      status.setAttribute('data-nav-card-status', '1');
      btn.appendChild(status);
    }
    status.className = 'view-btn-status status-' + (tone || 'neutral');
    status.textContent = label;
  }

  function compactCount(n, singular, plural) {
    n = Number(n || 0);
    if (n <= 0) return '';
    return n + ' ' + (n === 1 ? singular : plural);
  }

  function updateVeyraNavStatusIndicators() {
    let month = activeMonth();
    if (!month) return;

    let monthState = currentMonthTone(month);
    setStatus('overview', monthState.label, monthState.tone);

    let cashCount = transactionCount(month.income) + transactionCount(month.savings);
    setStatus('income-savings', compactCount(cashCount, 'entry', 'entries'), cashCount ? 'good' : 'neutral');

    let expenseCount = transactionCount(month.expenses);
    setStatus('expenses', compactCount(expenseCount, 'entry', 'entries'), expenseCount ? 'warn' : 'neutral');

    let debtCount = getDebtCount(month);
    setStatus('debt', compactCount(debtCount, 'profile', 'profiles'), debtCount ? 'warn' : 'neutral');

    let goalCount = getGoalCount(month);
    setStatus('financial-goals', compactCount(goalCount, 'goal', 'goals'), goalCount ? 'good' : 'neutral');

    let dueSubs = getSubscriptionDueCount(month);
    let subCount = getSubscriptionCount(month);
    setStatus('subscriptions', dueSubs ? compactCount(dueSubs, 'due', 'due') : compactCount(subCount, 'active', 'active'), dueSubs ? 'warn' : (subCount ? 'good' : 'neutral'));

    let usageDue = getUsageDueCount();
    let usageTracked = getUsageTrackedCount();
    if (usageDue > 0) {
      setStatus('usage', '', '');
    } else {
      setStatus('usage', compactCount(usageTracked, 'tracked', 'tracked'), usageTracked ? 'good' : 'neutral');
    }
  }

  window.updateVeyraNavStatusIndicators = updateVeyraNavStatusIndicators;

  document.addEventListener('DOMContentLoaded', function() {
    scheduleNavStatusRefresh();
    let nav = document.getElementById('viewNav');
    if (nav) nav.addEventListener('click', function() { setTimeout(scheduleNavStatusRefresh, 0); });
    let monthList = document.getElementById('monthList');
    if (monthList) monthList.addEventListener('click', function() { setTimeout(scheduleNavStatusRefresh, 80); });

    ['updateUsageDuePill', 'updateAchievementsPill', 'renderAll', 'setActiveView'].forEach(function(name) {
      let original = window[name];
      if (typeof original !== 'function' || original.__veyraNavStatusWrapped) return;
      let wrapped = function() {
        let result = original.apply(this, arguments);
        scheduleNavStatusRefresh();
        return result;
      };
      wrapped.__veyraNavStatusWrapped = true;
      window[name] = wrapped;
    });

    let monthTitle = document.getElementById('monthTitle');
    if (monthTitle && window.MutationObserver) {
      new MutationObserver(scheduleNavStatusRefresh).observe(monthTitle, { childList: true, characterData: true, subtree: true });
    }
  });
})();
