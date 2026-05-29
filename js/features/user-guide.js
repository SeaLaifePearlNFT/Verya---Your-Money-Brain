(function() {
  'use strict';

  var GUIDE_KEY = 'veyra_guide_v2';
  var LEGACY_GUIDE_KEY = 'veyra_guide_v1';
  var _activeMode = 'setup';
  var _activeFeature = 'overview';
  var _openStep = 0;

  function loadGuide() {
    try {
      var raw = localStorage.getItem(GUIDE_KEY);
      if (raw) return JSON.parse(raw) || {};
      var legacy = localStorage.getItem(LEGACY_GUIDE_KEY);
      if (legacy) {
        var parsed = JSON.parse(legacy) || {};
        return {
          dismissed: !!parsed.dismissed,
          manualDone: Array.isArray(parsed.manualDone) ? parsed.manualDone : [],
          firstSeen: new Date().toISOString()
        };
      }
    } catch(e) {}
    return {};
  }

  function saveGuide(data) {
    try { localStorage.setItem(GUIDE_KEY, JSON.stringify(data || {})); } catch(e) {}
  }

  function guideData() {
    var g = loadGuide();
    if (!g.firstSeen) {
      g.firstSeen = new Date().toISOString();
      saveGuide(g);
    }
    return g;
  }

  function manualDoneList() {
    var g = guideData();
    return Array.isArray(g.manualDone) ? g.manualDone : [];
  }

  function isManualDone(key) {
    return manualDoneList().indexOf(key) >= 0;
  }

  function setManualDone(key) {
    var g = guideData();
    g.manualDone = Array.isArray(g.manualDone) ? g.manualDone : [];
    if (g.manualDone.indexOf(key) < 0) g.manualDone.push(key);
    saveGuide(g);
  }

  function clearManualDone(key) {
    var g = guideData();
    g.manualDone = (Array.isArray(g.manualDone) ? g.manualDone : []).filter(function(k) { return k !== key; });
    saveGuide(g);
  }

  function resetGuideProgress() {
    var g = guideData();
    g.manualDone = [];
    g.dismissed = false;
    saveGuide(g);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getState() {
    var s = (typeof window.state !== 'undefined') ? window.state : null;
    var month = s && Array.isArray(s.months)
      ? (s.months.find(function(m){ return m && m.name === s.activeMonth; }) || s.months[0])
      : null;
    var income = month && Array.isArray(month.income) ? month.income : [];
    var expenses = month && Array.isArray(month.expenses) ? month.expenses : [];
    var savings = month && Array.isArray(month.savings) ? month.savings : [];
    var subs = s && Array.isArray(s.subscriptions) ? s.subscriptions : [];
    var goals = month && Array.isArray(month.goals) ? month.goals : [];
    return { state: s, month: month, income: income, expenses: expenses, savings: savings, subs: subs, goals: goals };
  }

  function rowHasTransactions(row) {
    return !!(row && Array.isArray(row.transactions) && row.transactions.length);
  }

  function openView(viewName) {
    if (!viewName) return;
    if (typeof window.setActiveView === 'function') {
      window.setActiveView(viewName);
      return;
    }
    var btn = document.querySelector('[data-view-btn="' + viewName + '"], [data-view="' + viewName + '"]');
    if (btn && typeof btn.click === 'function') btn.click();
  }

  function clickFirst(selectors) {
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el && typeof el.click === 'function') {
        el.click();
        return true;
      }
    }
    return false;
  }

  function runGuideAction(action) {
    if (!action) return;
    if (action.view) {
      closeGuide();
      setTimeout(function(){ openView(action.view); }, 40);
      return;
    }

    if (action.fn === 'openExpenseStructure') {
      closeGuide();
      window.veyraWizardOpenView('expenses');
      setTimeout(function(){
        clickFirst(['#manageExpensesBtn', '#manageStructureBtn', '[data-open-expense-structure]', '[data-manage-expenses]']);
      }, 180);
      return;
    }

    if (action.fn === 'openCSVImport') {
      closeGuide();
      window.veyraWizardOpenView('expenses');
      setTimeout(function(){
        if (!clickFirst(['#csvImportHistoryBtn', '#csvImportBtn', '[data-open-csv-import]'])) {
          var file = document.getElementById('csvImportFile');
          if (file && typeof file.click === 'function') file.click();
        }
      }, 180);
      return;
    }

    if (action.fn === 'openSmartInsights') {
      closeGuide();
      if (typeof window.openSmartInsightsWorkspace === 'function') {
        setTimeout(window.openSmartInsightsWorkspace, 120);
      } else {
        setTimeout(function(){ window.veyraWizardOpenView('smart-insights'); }, 40);
      }
      return;
    }

    if (action.fn === 'resetGuide') {
      resetGuideProgress();
      _openStep = 0;
      render();
    }
  }

  var SETUP_STEPS = [
    {
      key: 'income',
      title: 'Set your income',
      location: 'Income & Savings',
      time: '2 min',
      auto: function(st) { return st.income.some(function(r){ return Number(r && r.planned || 0) > 0; }); },
      summary: 'Add the income you expect this month before planning expenses.',
      body: 'Start with the money coming in: salary, freelance work, shared-expense repayments, or any predictable income. This gives every other card a reliable baseline.',
      why: 'Overview and Smart Insights are only useful when the income baseline is realistic.',
      actions: [{ label: 'Open Income & Savings', view: 'income-savings' }]
    },
    {
      key: 'expense-categories',
      title: 'Review your expense categories',
      location: 'Expenses',
      time: '4 min',
      auto: null,
      summary: 'Make the dashboard match how you actually spend.',
      body: 'Use broad categories for the main view and practical subcategories for detail. Rename anything that does not fit, remove noise, and add categories you know you will use.',
      why: 'Good categories make the Budget Allocation card and Smart Insights easier to trust.',
      actions: [
        { label: 'Open Expenses', view: 'expenses' },
        { label: 'Manage Structure', fn: 'openExpenseStructure', secondary: true }
      ]
    },
    {
      key: 'fixed-costs',
      title: 'Add fixed monthly costs',
      location: 'Expenses',
      time: '3 min',
      auto: function(st) {
        return st.expenses.some(function(r){ return !!(r && r.fixed) && Number(r.planned || 0) > 0; });
      },
      summary: 'Enter rent, insurance, phone, internet, and other recurring costs.',
      body: 'Fixed costs are the non-negotiable part of the month. Add planned amounts so Veyra knows what is already committed before variable spending begins.',
      why: 'This prevents the dashboard from making your month look healthier than it is.',
      actions: [{ label: 'Open Expenses', view: 'expenses' }]
    },
    {
      key: 'first-expense',
      title: 'Log your first expenses',
      location: 'Expenses',
      time: '3 min',
      auto: function(st) {
        return st.expenses.some(rowHasTransactions);
      },
      summary: 'Add actual spending manually or import bank transactions.',
      body: 'Actual expenses turn the dashboard from a plan into a live monthly picture. Start with a few recent transactions or import a bank CSV if you want the full month.',
      why: 'Smart Insights needs real activity before it can explain trends and risks.',
      actions: [
        { label: 'Open Expenses', view: 'expenses' },
        { label: 'Import Bank CSV', fn: 'openCSVImport', secondary: true }
      ]
    },
    {
      key: 'subscriptions',
      title: 'Add subscriptions',
      location: 'Subscriptions',
      time: '2 min',
      auto: function(st) { return st.subs.length > 0; },
      summary: 'Track recurring charges that quietly shape your month.',
      body: 'Add Netflix, gym memberships, SaaS tools, apps, or any recurring monthly payment. Subscriptions should not be hidden inside random expenses.',
      why: 'Recurring charges are easier to control when they are visible in one place.',
      actions: [{ label: 'Open Subscriptions', view: 'subscriptions' }]
    },
    {
      key: 'goals',
      title: 'Set a savings goal',
      location: 'Financial Goals',
      time: '2 min',
      auto: function(st) { return st.goals.length > 0; },
      summary: 'Give your monthly budget a destination.',
      body: 'Create a goal for an emergency fund, travel, a purchase, or another priority. Goals help connect monthly decisions to something concrete.',
      why: 'A goal makes savings feel planned instead of accidental.',
      actions: [{ label: 'Open Financial Goals', view: 'financial-goals' }]
    },
    {
      key: 'overview',
      title: 'Read the Overview',
      location: 'Overview',
      time: '2 min',
      auto: null,
      summary: 'Use Overview as your monthly command center.',
      body: 'Start with the Current Budget Allocation card, then check the financial state, summary cards, and any warnings. Overview tells you where to look next.',
      why: 'This is where Veyra turns your inputs into a quick monthly health check.',
      actions: [{ label: 'Open Overview', view: 'overview' }]
    },
    {
      key: 'smart-insights',
      title: 'Explore Smart Insights',
      location: 'Smart Insights',
      time: '3 min',
      auto: null,
      summary: 'Understand the story behind your numbers.',
      body: 'Smart Insights highlights patterns, risks, category movement, subscriptions, and practical actions. It becomes more meaningful as you log more activity.',
      why: 'This tab helps you decide what to adjust, not just what happened.',
      actions: [{ label: 'Open Smart Insights', fn: 'openSmartInsights' }]
    }
  ];

  var FEATURES = [
    {
      key: 'overview',
      label: 'Overview',
      view: 'overview',
      title: 'Overview',
      subtitle: 'Your monthly command center. Use it for the first health check before editing details elsewhere.',
      start: 'Current Budget Allocation',
      bullets: [
        'Shows where planned and logged money is going across the month.',
        'Use summary cards to check income, spending, savings, and remaining room.',
        'When something looks wrong, fix the source data in the matching tab.'
      ],
      actions: [{ label: 'Open Overview', view: 'overview' }]
    },
    {
      key: 'expenses',
      label: 'Expenses',
      view: 'expenses',
      title: 'Expenses',
      subtitle: 'Where the budget becomes real: categories, fixed costs, planned amounts, and actual spending.',
      start: 'Manage Structure, then log transactions',
      bullets: [
        'Keep categories broad enough for the Overview to stay readable.',
        'Use fixed expenses for monthly commitments such as rent and insurance.',
        'Log actual expenses manually or import a bank CSV for a faster full-month setup.'
      ],
      actions: [
        { label: 'Open Expenses', view: 'expenses' },
        { label: 'Manage Structure', fn: 'openExpenseStructure', secondary: true }
      ]
    },
    {
      key: 'income-savings',
      label: 'Income & Savings',
      view: 'income-savings',
      title: 'Income & Savings',
      subtitle: 'Set what comes in and how much should be reserved before spending decisions happen.',
      start: 'Monthly income baseline',
      bullets: [
        'Add expected income sources for the active month.',
        'Track savings as part of the monthly plan, not as an afterthought.',
        'Use Non-Cash Benefits when employer benefits offset real expenses.'
      ],
      actions: [{ label: 'Open Income & Savings', view: 'income-savings' }]
    },
    {
      key: 'smart-insights',
      label: 'Smart Insights',
      view: 'smart-insights',
      title: 'Smart Insights',
      subtitle: 'The analysis layer that explains movement, risks, and useful next actions.',
      start: 'Signals after real data exists',
      bullets: [
        'Insights improve after income, planned expenses, and actual spending are entered.',
        'Use category movement to spot rising areas before they become problems.',
        'Use guidance cards as prompts for what to review next.'
      ],
      actions: [{ label: 'Open Smart Insights', fn: 'openSmartInsights' }]
    },
    {
      key: 'subscriptions',
      label: 'Subscriptions',
      view: 'subscriptions',
      title: 'Subscriptions',
      subtitle: 'A dedicated place for recurring payments that are easy to forget.',
      start: 'Add recurring monthly charges',
      bullets: [
        'Add services, memberships, apps, and tools paid monthly.',
        'Review the total subscription load when trimming costs.',
        'Keep recurring charges separate from one-off spending for clearer insight.'
      ],
      actions: [{ label: 'Open Subscriptions', view: 'subscriptions' }]
    },
    {
      key: 'financial-goals',
      label: 'Goals',
      view: 'financial-goals',
      title: 'Financial Goals',
      subtitle: 'Connect your monthly budget to the things you are building toward.',
      start: 'Create one goal',
      bullets: [
        'Use goals for emergency funds, travel, debt payoff support, or future purchases.',
        'Review progress monthly rather than only when you remember.',
        'Goals help explain why savings targets matter.'
      ],
      actions: [{ label: 'Open Financial Goals', view: 'financial-goals' }]
    },
    {
      key: 'debt',
      label: 'Debt',
      view: 'debt',
      title: 'Debt',
      subtitle: 'Track debt obligations separately from normal monthly spending.',
      start: 'Add active balances or repayment focus',
      bullets: [
        'Use the Debt tab to keep repayment decisions visible.',
        'Separate debt tracking from normal expenses so the monthly picture stays clear.',
        'Review repayments alongside goals and cash flow.'
      ],
      actions: [{ label: 'Open Debt', view: 'debt' }]
    },
    {
      key: 'achievements',
      label: 'Achievements',
      view: 'achievements',
      title: 'Achievements',
      subtitle: 'Progress feedback that helps keep budgeting consistent.',
      start: 'Check completed milestones',
      bullets: [
        'Use achievements as motivation, not as required setup.',
        'Review streaks and badges after you have used the dashboard for a while.',
        'Custom targets can turn habits into visible progress.'
      ],
      actions: [{ label: 'Open Achievements', view: 'achievements' }]
    },
    {
      key: 'usage',
      label: 'Usage',
      view: 'usage',
      title: 'Usage',
      subtitle: 'A utility area for tracking how the dashboard is used and maintained.',
      start: 'Use when you want housekeeping',
      bullets: [
        'Review usage-related information when maintaining your dashboard.',
        'Use this after setup rather than during the first budgeting flow.',
        'Keep focus on income, expenses, and overview first.'
      ],
      actions: [{ label: 'Open Usage', view: 'usage' }]
    }
  ];

  function stepDone(step, st) {
    var autoDone = step.auto ? !!step.auto(st) : false;
    return autoDone || isManualDone(step.key);
  }

  function allDoneState() {
    var st = getState();
    return SETUP_STEPS.map(function(step){ return stepDone(step, st); });
  }

  function progressHtml(done) {
    var doneCount = done.filter(Boolean).length;
    var total = SETUP_STEPS.length;
    var pct = total ? Math.round(doneCount / total * 100) : 0;
    return {
      doneCount: doneCount,
      total: total,
      pct: pct,
      text: doneCount + ' of ' + total + ' setup steps complete'
    };
  }

  function actionsHtml(actions) {
    var html = '';
    (actions || []).forEach(function(action) {
      html += '<button class="guide-v2-action' + (action.secondary ? ' secondary' : '') + '" type="button"';
      if (action.view) html += ' data-guide-view="' + esc(action.view) + '"';
      if (action.fn) html += ' data-guide-fn="' + esc(action.fn) + '"';
      html += '>' + esc(action.label) + '</button>';
    });
    return html;
  }

  function setupStepHtml(step, idx, done, open) {
    var classes = 'guide-v2-step' + (done ? ' is-done' : '') + (open ? ' is-open' : '');
    var number = done ? '✓' : String(idx + 1);
    var html = '<article class="' + classes + '" data-guide-step="' + idx + '">';
    html += '<button class="guide-v2-step-head" type="button">';
    html += '<span class="guide-v2-step-num">' + number + '</span>';
    html += '<span class="guide-v2-step-copy"><strong>' + esc(step.title) + '</strong><small>' + esc(step.location) + ' · ' + esc(step.time) + '</small></span>';
    html += '<span class="guide-v2-step-state">' + (done ? 'Done' : (open ? 'Open' : 'Start')) + '</span>';
    html += '</button>';

    html += '<div class="guide-v2-step-body">';
    html += '<p>' + esc(step.body) + '</p>';
    html += '<div class="guide-v2-why"><span>Why it matters</span>' + esc(step.why) + '</div>';
    html += '<div class="guide-v2-actions">' + actionsHtml(step.actions);
    if (!step.auto) {
      if (isManualDone(step.key)) {
        html += '<button class="guide-v2-mark" type="button" data-guide-unmark="' + esc(step.key) + '">Unmark</button>';
      } else {
        html += '<button class="guide-v2-mark" type="button" data-guide-markdone="' + esc(step.key) + '">Mark as done</button>';
      }
    } else if (done) {
      html += '<span class="guide-v2-auto-note">Completed automatically</span>';
    }
    html += '</div>';
    html += '</div></article>';
    return html;
  }

  function renderSetup(done) {
    var p = progressHtml(done);
    var html = '<section class="guide-v2-hero">';
    html += '<div><span class="guide-v2-eyebrow">Setup guide</span><h3>Build your first monthly budget</h3><p>The fastest path to a useful dashboard: set the baseline, log the first activity, then read what Veyra is telling you.</p></div>';
    html += '<div class="guide-v2-score"><strong>' + p.doneCount + '/' + p.total + '</strong><span>complete</span></div>';
    html += '</section>';

    html += '<div class="guide-v2-steps">';
    SETUP_STEPS.forEach(function(step, idx) {
      html += setupStepHtml(step, idx, done[idx], idx === _openStep);
    });
    html += '</div>';
    return html;
  }

  function renderFeatureGuide() {
    var active = FEATURES.find(function(item){ return item.key === _activeFeature; }) || FEATURES[0];
    var html = '<section class="guide-v2-feature-layout">';
    html += '<nav class="guide-v2-feature-nav" aria-label="Guide sections">';
    FEATURES.forEach(function(item) {
      html += '<button type="button" class="' + (item.key === active.key ? 'active' : '') + '" data-guide-feature="' + esc(item.key) + '">' + esc(item.label) + '</button>';
    });
    html += '</nav>';

    html += '<article class="guide-v2-feature-panel">';
    html += '<span class="guide-v2-eyebrow">Feature guide</span>';
    html += '<h3>' + esc(active.title) + '</h3>';
    html += '<p>' + esc(active.subtitle) + '</p>';
    html += '<div class="guide-v2-start-card"><span>Start with</span><strong>' + esc(active.start) + '</strong></div>';
    html += '<div class="guide-v2-bullet-list">';
    active.bullets.forEach(function(bullet) {
      html += '<div class="guide-v2-bullet"><span>✓</span><p>' + esc(bullet) + '</p></div>';
    });
    html += '</div>';
    html += '<div class="guide-v2-actions">' + actionsHtml(active.actions) + '</div>';
    html += '</article></section>';
    return html;
  }

  function renderTips() {
    var html = '<section class="guide-v2-tips">';
    html += '<article><span>Best first session</span><strong>Do not perfect everything.</strong><p>Set income, fixed costs, and a few categories first. Improve the structure after you see how the month behaves.</p></article>';
    html += '<article><span>Categories</span><strong>Broad beats hyper-detailed.</strong><p>Too many categories make Overview noisy. Use subcategories only where they improve decisions.</p></article>';
    html += '<article><span>Insights</span><strong>Data first, insight second.</strong><p>Smart Insights becomes more useful after actual expenses and recurring costs are present.</p></article>';
    html += '<article><span>Privacy</span><strong>Your dashboard works locally.</strong><p>Veyra is designed around local-first budgeting. Keep exports/backups when making big changes.</p></article>';
    html += '</section>';
    return html;
  }

  function render() {
    var overlay = document.getElementById('guideOverlay');
    var body = document.getElementById('guideBody');
    var bar = document.getElementById('guideProgressBar');
    var line = document.getElementById('guideProgressLine');
    var title = document.getElementById('guideTitle');
    var note = document.getElementById('guideFooterNote');
    if (!body) return;

    if (overlay) overlay.classList.add('guide-v2-overlay');
    var modal = overlay ? overlay.querySelector('.guide-modal') : document.querySelector('.guide-modal');
    if (modal) modal.classList.add('guide-v2-modal');

    var done = allDoneState();
    var p = progressHtml(done);

    if (bar) bar.style.width = p.pct + '%';
    if (title) title.textContent = _activeMode === 'setup' ? 'Veyra User Guide' : (_activeMode === 'features' ? 'Feature Guide' : 'Practical Tips');
    if (line) line.textContent = _activeMode === 'setup' ? p.text : 'Learn what each area does and when to use it.';
    if (note) note.textContent = _activeMode === 'setup' ? p.text : 'Guide Hub';

    var html = '<div class="guide-v2-tabs">';
    html += '<button type="button" class="' + (_activeMode === 'setup' ? 'active' : '') + '" data-guide-mode="setup">Setup Guide</button>';
    html += '<button type="button" class="' + (_activeMode === 'features' ? 'active' : '') + '" data-guide-mode="features">Feature Guide</button>';
    html += '<button type="button" class="' + (_activeMode === 'tips' ? 'active' : '') + '" data-guide-mode="tips">Tips</button>';
    html += '</div>';

    if (_activeMode === 'setup') html += renderSetup(done);
    else if (_activeMode === 'features') html += renderFeatureGuide();
    else html += renderTips();

    body.innerHTML = html;
    wireBody(body);
  }

  function wireBody(body) {
    body.querySelectorAll('[data-guide-mode]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        _activeMode = btn.dataset.guideMode || 'setup';
        render();
      });
    });

    body.querySelectorAll('[data-guide-feature]').forEach(function(btn) {
      btn.addEventListener('click', function() {
        _activeFeature = btn.dataset.guideFeature || 'overview';
        render();
      });
    });

    body.querySelectorAll('.guide-v2-step-head').forEach(function(head) {
      head.addEventListener('click', function() {
        var step = head.closest('[data-guide-step]');
        var idx = step ? parseInt(step.dataset.guideStep, 10) : 0;
        _openStep = _openStep === idx ? -1 : idx;
        render();
      });
    });

    body.querySelectorAll('[data-guide-view], [data-guide-fn]').forEach(function(btn) {
      btn.addEventListener('click', function(event) {
        event.stopPropagation();
        runGuideAction({ view: btn.dataset.guideView, fn: btn.dataset.guideFn });
      });
    });

    body.querySelectorAll('[data-guide-markdone]').forEach(function(btn) {
      btn.addEventListener('click', function(event) {
        event.stopPropagation();
        setManualDone(btn.dataset.guideMarkdone);
        render();
      });
    });

    body.querySelectorAll('[data-guide-unmark]').forEach(function(btn) {
      btn.addEventListener('click', function(event) {
        event.stopPropagation();
        clearManualDone(btn.dataset.guideUnmark);
        render();
      });
    });
  }

  function openGuide(mode) {
    if (mode) _activeMode = mode;
    var overlay = document.getElementById('guideOverlay');
    if (overlay) {
      overlay.classList.add('cbm-open', 'guide-v2-overlay');
      overlay.setAttribute('aria-hidden', 'false');
    }
    render();
  }

  function closeGuide() {
    var overlay = document.getElementById('guideOverlay');
    if (overlay) {
      overlay.classList.remove('cbm-open');
      overlay.setAttribute('aria-hidden', 'true');
    }
  }

  window.openVeyraGuide = openGuide;
  window.closeVeyraGuide = closeGuide;


  function ensureSetupWizardLaunchButton() {
    var btn = document.getElementById('setupWizardBtn');
    if (btn || !document.body) return;
    var guideBtn = document.getElementById('setupWizardBtn') || document.querySelector('.tools-panel, .sidebar, aside, body');
    if (!guideBtn) return;
    var clone = document.createElement('button');
    clone.className = 'secondary sidebar-guide-btn setup-wizard-sidebar-btn';
    clone.id = 'setupWizardBtn';
    clone.type = 'button';
    clone.title = 'Start the first-time setup wizard';
    clone.innerHTML = '<span class="btn-icon">🧭</span> Setup Wizard';
    guideBtn.parentNode.insertBefore(clone, guideBtn.nextSibling);
    clone.addEventListener('click', function(){ startSetupWizard(0); });
  }

  document.addEventListener('DOMContentLoaded', function() {
    var guideBtn = document.getElementById('userGuideBtn');
    if (guideBtn) guideBtn.addEventListener('click', function(){ openGuide('setup'); });
    ensureSetupWizardLaunchButton();
    var setupWizardBtn = document.getElementById('setupWizardBtn');
    if (setupWizardBtn) setupWizardBtn.addEventListener('click', function(){ startSetupWizard(0); });

    var closeBtn = document.getElementById('guideCloseBtn');
    var dismissBtn = document.getElementById('guideDismissBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeGuide);
    if (dismissBtn) dismissBtn.addEventListener('click', function() {
      var g = guideData();
      g.dismissed = true;
      saveGuide(g);
      closeGuide();
    });

    var overlay = document.getElementById('guideOverlay');
    if (overlay) {
      overlay.classList.add('guide-v2-overlay');
      overlay.addEventListener('click', function(e) {
        if (e.target === overlay) closeGuide();
      });
    }

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeGuide();
    });
    // First-run onboarding is handled by the Welcome + Setup Wizard flow, not the old Guide Hub auto-open.

    setInterval(function() {
      var o = document.getElementById('guideOverlay');
      if (o && o.classList.contains('cbm-open') && _activeMode === 'setup') render();
    }, 2500);
  });

  /* ─────────────────────────────────────────────────────────────
     First-Time Setup Wizard
     Guided overlay that stays open while moving users through tabs.
     ───────────────────────────────────────────────────────────── */

  var _wizard = {
    active: false,
    step: 0,
    minimized: false
  };

  var WIZARD_KEY = 'veyra_setup_wizard_v1';

  var WIZARD_STEPS = [
    {
      key: 'welcome',
      title: 'Welcome to Veyra',
      kicker: 'First-time setup',
      view: 'overview',
      target: '',
      intro: 'Let’s build a useful monthly picture without trying to perfect every detail.',
      body: 'This wizard explains the core workflow from Overview first. When a step needs input, use the action card to open the exact tab and the wizard will minimize while you work.',
      primary: 'Start setup',
      secondary: 'Skip wizard',
      complete: function(){ return false; }
    },
    {
      key: 'income',
      title: 'Set your monthly income',
      kicker: 'Step 1',
      view: 'income-savings',
      target: '#incomeTable, #incomeSavingsView, [data-view="income-savings"]',
      intro: 'Income is the baseline for everything else.',
      body: 'Add your expected salary, freelance income, shared-expense balance, or other predictable income for the active month.',
      primary: 'I added income',
      secondary: 'Skip for now',
      complete: function(st){ return st.income.some(function(r){ return Number(r && r.planned || 0) > 0; }); }
    },
    {
      key: 'categories',
      title: 'Review expense categories',
      kicker: 'Step 2',
      view: 'expenses',
      target: '#manageExpensesBtn, #expenseCategoryList, #expensesView, [data-view="expenses"]',
      intro: 'Make the dashboard match your real spending.',
      body: 'Open Manage Structure if needed. Rename categories that do not fit, remove noise, and keep the main categories broad enough for Overview to stay readable.',
      primary: 'Categories reviewed',
      secondary: 'Open Manage Structure',
      secondaryFn: 'openExpenseStructure',
      complete: function(){ return isManualDone('wizard-categories'); }
    },
    {
      key: 'fixed-costs',
      title: 'Add fixed monthly costs',
      kicker: 'Step 3',
      view: 'expenses',
      target: '#expensesView, #expenseTable, [data-view="expenses"]',
      intro: 'Fixed costs are the money already committed.',
      body: 'Add planned amounts for rent, utilities, insurance, phone, internet, subscriptions you track as fixed rows, or other recurring obligations.',
      primary: 'Fixed costs added',
      secondary: 'Skip for now',
      complete: function(st){ return st.expenses.some(function(r){ return !!(r && r.fixed) && Number(r.planned || 0) > 0; }); }
    },
    {
      key: 'first-expense',
      title: 'Log your first expenses',
      kicker: 'Step 4',
      view: 'expenses',
      target: '#csvImportHistoryBtn, #csvImportFile, #expensesView, [data-view="expenses"]',
      intro: 'Actual spending turns your budget into a live month.',
      body: 'Log a few manual expenses or import a bank CSV. You do not need a perfect month yet — just enough to start seeing real movement.',
      primary: 'Expenses logged',
      secondary: 'Import CSV',
      secondaryFn: 'openCSVImport',
      complete: function(st){ return st.expenses.some(rowHasTransactions); }
    },
    {
      key: 'subscriptions',
      title: 'Add recurring subscriptions',
      kicker: 'Step 5',
      view: 'subscriptions',
      target: '#subscriptionsView, [data-view="subscriptions"]',
      intro: 'Recurring charges quietly shape your month.',
      body: 'Add memberships, streaming services, apps, SaaS tools, and anything else that repeats monthly.',
      primary: 'Subscriptions reviewed',
      secondary: 'Skip for now',
      complete: function(st){ return st.subs.length > 0 || isManualDone('wizard-subscriptions'); }
    },
    {
      key: 'goals',
      title: 'Create one financial goal',
      kicker: 'Step 6',
      view: 'financial-goals',
      target: '#goalsView, [data-view="financial-goals"]',
      intro: 'A goal gives the monthly budget a purpose.',
      body: 'Create a goal for savings, travel, an emergency fund, or a bigger purchase. One goal is enough to start.',
      primary: 'Goal added',
      secondary: 'Skip for now',
      complete: function(st){ return st.goals.length > 0 || isManualDone('wizard-goals'); }
    },
    {
      key: 'overview',
      title: 'Read your Overview',
      kicker: 'Step 7',
      view: 'overview',
      target: '#summaryCards, .current-allocation-card, #spendingPie, [data-view="overview"]',
      intro: 'Overview is your monthly command center.',
      body: 'Start with Current Budget Allocation, then check the summary cards and financial state. If something looks off, return to the source tab and adjust it.',
      primary: 'I understand Overview',
      secondary: 'Open Feature Guide',
      secondaryMode: 'features',
      complete: function(){ return isManualDone('wizard-overview'); }
    },
    {
      key: 'smart-insights',
      title: 'Explore Smart Insights',
      kicker: 'Step 8',
      view: 'smart-insights',
      target: '.smart-insights-workspace-v2, #insightGrid, [data-view="smart-insights"]',
      intro: 'Smart Insights explains what changed and where to pay attention.',
      body: 'The tab becomes more useful as your data grows. Use it for category movement, signals, patterns, and practical next actions.',
      primary: 'Finish setup',
      secondary: 'Open Feature Guide',
      secondaryMode: 'features',
      complete: function(){ return isManualDone('wizard-smart-insights'); }
    }
  ];

  function loadWizard() {
    try {
      var raw = localStorage.getItem(WIZARD_KEY);
      return raw ? (JSON.parse(raw) || {}) : {};
    } catch(e) { return {}; }
  }

  function saveWizard(data) {
    try { localStorage.setItem(WIZARD_KEY, JSON.stringify(data || {})); } catch(e) {}
  }

  function wizardStepDone(step) {
    if (!step || step.key === 'welcome') return false;
    var st = getState();
    return !!(step.complete && step.complete(st));
  }

  function wizardDoneCount() {
    var count = 0;
    WIZARD_STEPS.forEach(function(step) {
      if (step.key !== 'welcome' && wizardStepDone(step)) count++;
    });
    return count;
  }

  function ensureWizardDom() {
    var existing = document.getElementById('setupWizardOverlay');
    if (existing) return existing;

    var overlay = document.createElement('div');
    overlay.id = 'setupWizardOverlay';
    overlay.className = 'setup-wizard-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<section class="setup-wizard-card setup-wizard-card-v2" role="dialog" aria-modal="true" aria-labelledby="setupWizardTitle">' +
        '<div class="setup-wizard-head">' +
          '<div><div class="setup-wizard-kicker" id="setupWizardKicker">First-time setup</div><h3 id="setupWizardTitle">Setup Wizard</h3><p id="setupWizardSubtitle">A guided walkthrough of the dashboard basics.</p></div>' +
          '<button class="setup-wizard-close" id="setupWizardCloseBtn" type="button" aria-label="Close setup wizard">×</button>' +
        '</div>' +
        '<div class="setup-wizard-progress"><div id="setupWizardProgressBar"></div></div>' +
        '<div class="setup-wizard-main">' +
          '<aside class="setup-wizard-rail" id="setupWizardRail"></aside>' +
          '<main class="setup-wizard-content">' +
            '<div class="setup-wizard-body" id="setupWizardBody"></div>' +
            '<div class="setup-wizard-actions">' +
              '<button class="setup-wizard-btn ghost" id="setupWizardBackBtn" type="button">Back</button>' +
              '<div class="setup-wizard-action-right">' +
                '<button class="setup-wizard-btn secondary" id="setupWizardSecondaryBtn" type="button"></button>' +
                '<button class="setup-wizard-btn primary" id="setupWizardPrimaryBtn" type="button"></button>' +
              '</div>' +
            '</div>' +
          '</main>' +
        '</div>' +
      '</section>';

    document.body.appendChild(overlay);

    document.getElementById('setupWizardCloseBtn').addEventListener('click', closeSetupWizard);
    document.getElementById('setupWizardBackBtn').addEventListener('click', function(){
      if (_wizard.step > 0) {
        _wizard.step -= 1;
        renderSetupWizard();
      }
    });
    document.getElementById('setupWizardPrimaryBtn').addEventListener('click', handleWizardPrimary);
    document.getElementById('setupWizardSecondaryBtn').addEventListener('click', handleWizardSecondary);

    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && _wizard.active) closeSetupWizard();
    });

    window.addEventListener('resize', function(){
      if (_wizard.active) positionWizardSpotlight();
    });

    return overlay;
  }

  function startSetupWizard(stepIndex) {
    closeGuide();
    try { window.veyraWizardOpenView('overview'); } catch(e) {}
    ensureWizardDom();
    _wizard.active = true;
    _wizard.step = typeof stepIndex === 'number' ? Math.max(0, Math.min(WIZARD_STEPS.length - 1, stepIndex)) : 0;
    var data = loadWizard();
    data.started = true;
    data.dismissed = false;
    data.lastStarted = new Date().toISOString();
    saveWizard(data);
    renderSetupWizard();
  }

  function closeSetupWizard() {
    var overlay = document.getElementById('setupWizardOverlay');
    if (overlay) {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
    }
    clearWizardSpotlight();
    _wizard.active = false;
  }

  function completeSetupWizard() {
    var data = loadWizard();
    data.completed = true;
    data.dismissed = true;
    data.completedAt = new Date().toISOString();
    saveWizard(data);

    var body = document.getElementById('setupWizardBody');
    var title = document.getElementById('setupWizardTitle');
    var kicker = document.getElementById('setupWizardKicker');
    var rail = document.getElementById('setupWizardRail');
    var progress = document.getElementById('setupWizardProgressBar');
    var primary = document.getElementById('setupWizardPrimaryBtn');
    var secondary = document.getElementById('setupWizardSecondaryBtn');
    var back = document.getElementById('setupWizardBackBtn');

    if (title) title.textContent = 'Budget setup complete';
    if (kicker) kicker.textContent = 'You are ready';
    if (progress) progress.style.width = '100%';
    if (rail) rail.innerHTML = '';
    if (body) {
      body.innerHTML =
        '<div class="setup-wizard-complete">' +
          '<div class="setup-wizard-complete-emoji">🎉</div>' +
          '<h4>Your first Veyra setup is complete.</h4>' +
          '<p>You now have the structure needed to use Overview and Smart Insights as your monthly financial command center.</p>' +
          '<div class="setup-wizard-complete-grid">' +
            '<span>Income baseline</span><span>Expense structure</span><span>Actual spending</span><span>Overview check</span>' +
          '</div>' +
        '</div>';
    }
    if (back) back.style.visibility = 'hidden';
    if (secondary) {
      secondary.textContent = 'Open Guide Hub';
      secondary.dataset.mode = 'setup';
      secondary.style.display = '';
    }
    if (primary) primary.textContent = 'Start using Veyra';
    clearWizardSpotlight();
  }


  function wizardExplainerHtml(step) {
    var maps = {
      income: {what:'This tells Veyra how much money the month has available before expenses, savings, and goals are considered.', do:['Add your main salary or recurring income.','Add predictable extra income only if you realistically expect it this month.','Avoid adding uncertain income until it is confirmed.'], watch:'If income is missing, Overview and Smart Insights may make the month look worse or incomplete.'},
      categories: {what:'Categories decide how your spending is grouped across Overview, Budget Allocation, and Smart Insights.', do:['Keep main categories broad and easy to scan.','Use subcategories for detail instead of creating too many main categories.','Rename default categories so they match your real life.'], watch:'Too many categories make charts and insights harder to read.'},
      'fixed-costs': {what:'Fixed costs are commitments that usually happen every month, whether you actively spend or not.', do:['Add planned amounts for rent, utilities, phone, internet, insurance, and similar commitments.','Mark costs as fixed when they should be reserved at the start of the month.','Review these first when your budget feels tight.'], watch:'Missing fixed costs can make your remaining budget look healthier than it really is.'},
      'first-expense': {what:'Actual expenses convert the dashboard from a static plan into a live month.', do:['Log a few recent transactions manually, or use CSV import for a fuller picture.','Assign each expense to the category where you want it to appear.','Do not wait for perfection; even a few entries make the dashboard more useful.'], watch:'Smart Insights needs real spending data before it can explain meaningful trends.'},
      subscriptions: {what:'Subscriptions collect recurring charges that are easy to forget when reviewing expenses.', do:['Add streaming, apps, memberships, software, and recurring services.','Use this tab to review whether recurring costs still deserve space in your budget.','Keep subscription names clear so they remain easy to audit later.'], watch:'Recurring costs quietly reduce flexibility every month.'},
      goals: {what:'Goals connect the monthly budget to something you are building toward.', do:['Create one practical goal first.','Use goals for emergency funds, travel, larger purchases, or savings targets.','Review progress after income and expenses are entered.'], watch:'One goal is enough. More goals can come later.'},
      overview: {what:'Overview is the dashboard summary. It shows what the month looks like after your inputs are combined.', do:['Start with Current Budget Allocation.','Check whether summary cards match your expectations.','Use Overview to decide which deeper tab needs attention.'], watch:'Overview is for reading the month, not editing every detail.'},
      'smart-insights': {what:'Smart Insights explains movement, risks, and patterns behind the numbers.', do:['Look for categories that are rising or over target.','Use guidance cards as prompts for what to review next.','Come back after more expenses are logged for better signals.'], watch:'Insights are only as good as the data entered into income, expenses, subscriptions, and goals.'}
    };
    var item = maps[step.key];
    if (!item) return '';
    var html = '<div class="setup-wizard-explainer">';
    html += '<section><span>What this does</span><p>' + esc(item.what) + '</p></section>';
    html += '<section><span>What to do here</span><ul>';
    item.do.forEach(function(line){ html += '<li>' + esc(line) + '</li>'; });
    html += '</ul></section>';
    html += '<section class="setup-wizard-watch"><span>Watch out</span><p>' + esc(item.watch) + '</p></section>';
    html += '</div>';
    return html;
  }

  function currentWizardStep() {
    return WIZARD_STEPS[_wizard.step] || WIZARD_STEPS[0];
  }

  function renderSetupWizard() {
    var overlay = ensureWizardDom();
    var step = currentWizardStep();
    var totalActionSteps = WIZARD_STEPS.length - 1;
    var actionIndex = Math.max(0, _wizard.step);
    var doneCount = wizardDoneCount();
    var progressPct = step.key === 'welcome' ? 4 : Math.max(12, Math.round((Math.min(actionIndex, totalActionSteps) / totalActionSteps) * 100));

    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');

    var title = document.getElementById('setupWizardTitle');
    var kicker = document.getElementById('setupWizardKicker');
    var body = document.getElementById('setupWizardBody');
    var subtitle = document.getElementById('setupWizardSubtitle');
    var rail = document.getElementById('setupWizardRail');
    var progress = document.getElementById('setupWizardProgressBar');
    var primary = document.getElementById('setupWizardPrimaryBtn');
    var secondary = document.getElementById('setupWizardSecondaryBtn');
    var back = document.getElementById('setupWizardBackBtn');

    if (title) title.textContent = step.title;
    if (kicker) kicker.textContent = step.kicker;
    if (subtitle) subtitle.textContent = step.key === 'welcome' ? 'A guided walkthrough that opens the right dashboard areas and explains what to do there.' : step.intro;
    if (progress) progress.style.width = progressPct + '%';

    if (rail) {
      var html = '';
      WIZARD_STEPS.slice(1).forEach(function(item, idx) {
        var absoluteIndex = idx + 1;
        var done = wizardStepDone(item);
        html += '<button type="button" class="' + (absoluteIndex === _wizard.step ? 'active ' : '') + (done ? 'done' : '') + '" data-wizard-jump="' + absoluteIndex + '">';
        html += '<span>' + (done ? '✓' : idx + 1) + '</span><strong>' + esc(item.title) + '</strong><small>' + esc(item.kicker) + '</small>';
        html += '</button>';
      });
      rail.innerHTML = html;
      rail.querySelectorAll('[data-wizard-jump]').forEach(function(btn){
        btn.addEventListener('click', function(){
          _wizard.step = Number(btn.dataset.wizardJump || 0);
          renderSetupWizard();
        });
      });
    }

    if (body) {
      if (step.key === 'welcome') {
        body.innerHTML =
          '<div class="setup-wizard-welcome">' +
            '<div class="setup-wizard-welcome-icon">🧭</div>' +
            '<p class="setup-wizard-intro">' + esc(step.intro) + '</p>' +
            '<p>' + esc(step.body) + '</p>' +
            '<div class="setup-wizard-mini-grid">' +
              '<div><span>1</span><strong>Set the baseline</strong><small>Income and fixed costs</small></div>' +
              '<div><span>2</span><strong>Log activity</strong><small>Expenses and subscriptions</small></div>' +
              '<div><span>3</span><strong>Read the result</strong><small>Overview and insights</small></div>' +
            '</div>' +
          '</div>';
      } else {
        var isDone = wizardStepDone(step);
        body.innerHTML =
          '<div class="setup-wizard-guidance">' +
            '<p class="setup-wizard-intro">' + esc(step.intro) + '</p>' +
            '<p>' + esc(step.body) + '</p>' +
          '</div>' +
          wizardExplainerHtml(step) +
          '<div class="setup-wizard-status ' + (isDone ? 'done' : '') + '">' +
            '<span>' + (isDone ? '✓' : '•') + '</span>' +
            '<div><strong>' + (isDone ? 'Detected as complete' : 'Not complete yet') + '</strong>' +
            '<small>' + doneCount + ' of ' + totalActionSteps + ' setup tasks completed</small></div>' +
          '</div>';
      }
    }

    if (back) {
      back.style.visibility = _wizard.step === 0 ? 'hidden' : 'visible';
    }

    if (primary) {
      primary.textContent = step.primary || 'Continue';
      primary.dataset.final = step.key === 'smart-insights' ? '1' : '';
    }

    if (secondary) {
      secondary.textContent = step.secondary || 'Skip';
      secondary.style.display = step.secondary ? '' : 'none';
      secondary.dataset.fn = step.secondaryFn || '';
      secondary.dataset.mode = step.secondaryMode || '';
    }

    // Keep the background stable while reading the wizard. Specific tabs open only via action cards.
    setTimeout(positionWizardSpotlight, 180);
  }

  function handleWizardPrimary() {
    var step = currentWizardStep();

    if (step.key === 'welcome') {
      _wizard.step = 1;
      renderSetupWizard();
      return;
    }

    if (step.key === 'categories') setManualDone('wizard-categories');
    if (step.key === 'subscriptions') setManualDone('wizard-subscriptions');
    if (step.key === 'goals') setManualDone('wizard-goals');
    if (step.key === 'overview') setManualDone('wizard-overview');
    if (step.key === 'smart-insights') {
      setManualDone('wizard-smart-insights');
      completeSetupWizard();
      return;
    }

    if (_wizard.step < WIZARD_STEPS.length - 1) {
      _wizard.step += 1;
      renderSetupWizard();
    } else {
      completeSetupWizard();
    }
  }

  function handleWizardSecondary() {
    var step = currentWizardStep();
    var secondary = document.getElementById('setupWizardSecondaryBtn');

    if (secondary && secondary.dataset.mode) {
      closeSetupWizard();
      openGuide(secondary.dataset.mode);
      return;
    }

    if (secondary && secondary.dataset.fn) {
      runGuideAction({ fn: secondary.dataset.fn });
      setTimeout(function(){
        _wizard.active = true;
        ensureWizardDom().classList.add('is-open');
        renderSetupWizard();
      }, 260);
      return;
    }

    if (step.key === 'welcome') {
      var data = loadWizard();
      data.dismissed = true;
      saveWizard(data);
      closeSetupWizard();
      return;
    }

    if (_wizard.step < WIZARD_STEPS.length - 1) {
      _wizard.step += 1;
      renderSetupWizard();
    } else {
      completeSetupWizard();
    }
  }

  function clearWizardSpotlight() {
    var spot = document.getElementById('setupWizardSpotlight');
    if (spot) spot.removeAttribute('style');
    document.querySelectorAll('.setup-wizard-target').forEach(function(el){
      el.classList.remove('setup-wizard-target');
    });
  }

  function findWizardTarget(step) {
    if (!step || !step.target) return null;
    var selectors = step.target.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  function positionWizardSpotlight() {
    clearWizardSpotlight();
    return;
  }

  /* Extend the Guide Hub render output with a wizard launch card. */
  var _originalRenderSetup = renderSetup;
  renderSetup = function(done) {
    var html = '<section class="guide-v2-wizard-launch">' +
      '<div><span class="guide-v2-eyebrow">Recommended for new users</span><h3>First-Time Setup Wizard</h3><p>Let Veyra walk you through the main dashboard workflow step by step, while opening the right tabs for you.</p></div>' +
      '<button class="guide-v2-wizard-btn" type="button" data-start-wizard>Start Wizard</button>' +
      '</section>';
    return html + _originalRenderSetup(done);
  };

  var _originalWireBody = wireBody;
  wireBody = function(body) {
    _originalWireBody(body);
    body.querySelectorAll('[data-start-wizard]').forEach(function(btn) {
      btn.addEventListener('click', function(){
        startSetupWizard(0);
      });
    });
  };

  window.startVeyraSetupWizard = startSetupWizard;

})();
/* setupWizardBtnFallback */






/* ─────────────────────────────────────────────────────────────
   Actionable setup wizard v4
   Adds direct "do this now" actions and a floating minimized resume button.
   ───────────────────────────────────────────────────────────── */
(function(){
  if (window.__veyraActionableSetupWizardV4) return;
  window.__veyraActionableSetupWizardV4 = true;

  var ACTION_MAP = {
    income: {
      label: 'Add income now',
      helper: 'Opens Income & Savings and minimizes this guide so you can edit the income rows.',
      run: function(){ window.veyraWizardOpenView('income-savings'); }
    },
    categories: {
      label: 'Open Manage Structure',
      helper: 'Opens Expenses and the structure manager for categories and subcategories.',
      run: function(){ window.veyraWizardOpenView('expenses'); setTimeout(function(){ var b=document.getElementById('manageExpensesBtn')||document.getElementById('manageStructureBtn')||document.querySelector('[data-open-expense-structure],[data-manage-expenses]'); if(b&&typeof b.click==='function') b.click(); }, 220); }
    },
    'fixed-costs': {
      label: 'Add fixed costs now',
      helper: 'Opens Expenses so you can enter planned amounts for fixed monthly rows.',
      run: function(){ window.veyraWizardOpenView('expenses'); }
    },
    'first-expense': {
      label: 'Log or import expenses',
      helper: 'Opens Expenses. Use manual rows or CSV import to add actual spending.',
      run: function(){ window.veyraWizardOpenView('expenses'); setTimeout(function(){ var b=document.getElementById('csvImportHistoryBtn')||document.getElementById('csvImportBtn')||document.querySelector('[data-open-csv-import]'); if(b&&typeof b.click==='function') b.click(); }, 220); }
    },
    subscriptions: {
      label: 'Add subscriptions now',
      helper: 'Opens Subscriptions so you can add recurring monthly payments.',
      run: function(){ window.veyraWizardOpenView('subscriptions'); }
    },
    goals: {
      label: 'Create a goal now',
      helper: 'Opens Financial Goals so you can add your first target.',
      run: function(){ window.veyraWizardOpenView('financial-goals'); }
    },
    overview: {
      label: 'Show Overview',
      helper: 'Opens Overview so you can read the monthly command center.',
      run: function(){ window.veyraWizardOpenView('overview'); }
    },
    'smart-insights': {
      label: 'Show Smart Insights',
      helper: 'Opens Smart Insights so you can review signals and guidance.',
      run: function(){ window.veyraWizardOpenView('smart-insights'); }
    }
  };

  function ensureWizardMiniButton(){
    var btn = document.getElementById('setupWizardMiniButton');
    if (btn) return btn;
    btn = document.createElement('button');
    btn.id = 'setupWizardMiniButton';
    btn.className = 'setup-wizard-mini-button';
    btn.type = 'button';
    btn.innerHTML = '<span>🧭</span><strong>Resume setup</strong>';
    btn.setAttribute('aria-label', 'Resume setup wizard');
    btn.addEventListener('click', function(){
      btn.classList.remove('is-visible');
      var overlay = document.getElementById('setupWizardOverlay');
      if (overlay) {
        overlay.classList.add('is-open');
        overlay.setAttribute('aria-hidden', 'false');
      }
      if (typeof window.startVeyraSetupWizard === 'function') { /* public API available; keep current step via mini resume handled by overlay */ }
    });
    document.body.appendChild(btn);
    return btn;
  }

  function minimizeSetupWizardForAction(){
    var overlay = document.getElementById('setupWizardOverlay');
    if (overlay) {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
    }
    var btn = ensureWizardMiniButton();
    btn.classList.add('is-visible');
  }

  function currentStepKeyFromDom(){
    var title = document.getElementById('setupWizardTitle');
    if (!title) return '';
    var text = String(title.textContent || '').toLowerCase();
    if (text.indexOf('income') >= 0) return 'income';
    if (text.indexOf('categor') >= 0) return 'categories';
    if (text.indexOf('fixed') >= 0) return 'fixed-costs';
    if (text.indexOf('expenses') >= 0 || text.indexOf('log') >= 0) return 'first-expense';
    if (text.indexOf('subscription') >= 0) return 'subscriptions';
    if (text.indexOf('goal') >= 0) return 'goals';
    if (text.indexOf('overview') >= 0) return 'overview';
    if (text.indexOf('smart') >= 0) return 'smart-insights';
    return '';
  }

  function injectActionableStepCard(){
    var body = document.getElementById('setupWizardBody');
    if (!body || body.querySelector('.setup-wizard-do-card')) return;

    var key = currentStepKeyFromDom();
    var action = ACTION_MAP[key];
    if (!action) return;

    var card = document.createElement('section');
    card.className = 'setup-wizard-do-card';
    card.innerHTML =
      '<div><span>Do this step</span><strong>' + action.label + '</strong><p>' + action.helper + '</p></div>' +
      '<button type="button">' + action.label + '</button>';

    var button = card.querySelector('button');
    button.addEventListener('click', function(){
      minimizeSetupWizardForAction();
      setTimeout(action.run, 80);
    });

    var status = body.querySelector('.setup-wizard-status');
    if (status) body.insertBefore(card, status);
    else body.appendChild(card);
  }

  var originalRender = window.renderSetupWizard;
  // renderSetupWizard is scoped in the original module, so we patch via MutationObserver instead.
  var observer = new MutationObserver(function(){
    var overlay = document.getElementById('setupWizardOverlay');
    if (overlay && overlay.classList.contains('is-open')) {
      setTimeout(injectActionableStepCard, 0);
    }
  });

  document.addEventListener('DOMContentLoaded', function(){
    ensureWizardMiniButton();
    observer.observe(document.body, { childList:true, subtree:true });
    document.addEventListener('click', function(event){
      if (event.target && event.target.closest && event.target.closest('#setupWizardOverlay')) {
        setTimeout(injectActionableStepCard, 0);
      }
    }, true);
  });

  window.minimizeVeyraSetupWizard = minimizeSetupWizardForAction;
})();




/* Wizard close safety fix — prevent hidden overlays from blocking dashboard interactions */
(function(){
  if (window.__veyraWizardCloseSafetyFix) return;
  window.__veyraWizardCloseSafetyFix = true;

  function fullyDisableOverlay(id){
    var el = document.getElementById(id);
    if (!el) return;
    var open = el.classList.contains('is-open') || el.classList.contains('cbm-open');
    if (!open) {
      el.setAttribute('aria-hidden', 'true');
      el.style.pointerEvents = 'none';
      el.style.display = 'none';
      el.classList.remove('is-open', 'cbm-open');
    } else {
      el.style.display = '';
      el.style.pointerEvents = '';
    }
  }

  function cleanupWizardOverlays(){
    fullyDisableOverlay('setupWizardOverlay');
    

    document.querySelectorAll('.setup-wizard-target, .guided-tour-target').forEach(function(el){
      el.classList.remove('setup-wizard-target', 'guided-tour-target');
    });
  }

  document.addEventListener('click', function(event){
    if (event.target && event.target.closest && (
      event.target.closest('#setupWizardCloseBtn') ||
      false
    )) {
      setTimeout(cleanupWizardOverlays, 0);
      setTimeout(cleanupWizardOverlays, 80);
    }
  }, true);

  document.addEventListener('keydown', function(event){
    if (event.key === 'Escape') {
      setTimeout(cleanupWizardOverlays, 0);
      setTimeout(cleanupWizardOverlays, 80);
    }
  }, true);

  window.addEventListener('focus', cleanupWizardOverlays);
  document.addEventListener('DOMContentLoaded', cleanupWizardOverlays);
  setInterval(cleanupWizardOverlays, 1000);

  var oldCloseSetup = window.closeVeyraSetupWizard || window.closeSetupWizard;
  window.closeVeyraSetupWizard = function(){
    if (typeof oldCloseSetup === 'function') {
      try { oldCloseSetup(); } catch(e) {}
    }
    cleanupWizardOverlays();
  };

  window.veyraCleanupWizardOverlays = cleanupWizardOverlays;
})();




/* Public wizard/guide safety bridge — avoids scoped function reference errors */
(function(){
  if (window.__veyraGuidePublicBridge) return;
  window.__veyraGuidePublicBridge = true;

  window.veyraCloseGuideSafe = function(){
    if (typeof window.closeVeyraGuide === 'function') {
      try { window.closeVeyraGuide(); return; } catch(e) {}
    }
    var guideOverlay = document.getElementById('guideOverlay');
    if (guideOverlay) {
      guideOverlay.classList.remove('cbm-open');
      guideOverlay.setAttribute('aria-hidden', 'true');
    }
  };

  window.veyraCloseSetupWizardSafe = function(){
    if (typeof window.closeVeyraSetupWizard === 'function') {
      try { window.closeVeyraSetupWizard(); return; } catch(e) {}
    }
    var overlay = document.getElementById('setupWizardOverlay');
    if (overlay) {
      overlay.classList.remove('is-open');
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.pointerEvents = 'none';
      overlay.style.display = 'none';
    }
  };
})();






/* Fresh budget welcome onboarding */
(function(){
  if (window.__veyraFreshWelcomeOnboarding) return;
  window.__veyraFreshWelcomeOnboarding = true;

  var WELCOME_KEY = 'veyra_welcome_onboarding_v1';

  function loadWelcome(){
    try { return JSON.parse(localStorage.getItem(WELCOME_KEY) || '{}') || {}; } catch(e){ return {}; }
  }

  function saveWelcome(data){
    try { localStorage.setItem(WELCOME_KEY, JSON.stringify(data || {})); } catch(e){}
  }

  function getBudgetState(){
    var s = (typeof window.state !== 'undefined') ? window.state : null;
    var month = s && Array.isArray(s.months)
      ? (s.months.find(function(m){ return m && m.name === s.activeMonth; }) || s.months[0])
      : null;

    var income = month && Array.isArray(month.income) ? month.income : [];
    var expenses = month && Array.isArray(month.expenses) ? month.expenses : [];
    var goals = month && Array.isArray(month.goals) ? month.goals : [];
    var subs = s && Array.isArray(s.subscriptions) ? s.subscriptions : [];

    var hasIncome = income.some(function(row){ return Number(row && row.planned || 0) > 0; });
    var hasActualExpenses = expenses.some(function(row){ return row && Array.isArray(row.transactions) && row.transactions.length > 0; });
    var hasPlannedExpenses = expenses.some(function(row){ return Number(row && row.planned || 0) > 0; });
    var hasGoals = goals.length > 0;
    var hasSubscriptions = subs.length > 0;

    return {
      hasIncome: hasIncome,
      hasActualExpenses: hasActualExpenses,
      hasPlannedExpenses: hasPlannedExpenses,
      hasGoals: hasGoals,
      hasSubscriptions: hasSubscriptions,
      looksFresh: !hasIncome && !hasActualExpenses && !hasGoals && !hasSubscriptions
    };
  }

  function ensureWelcomeDom(){
    var existing = document.getElementById('veyraWelcomeOverlay');
    if (existing) return existing;

    var overlay = document.createElement('div');
    overlay.id = 'veyraWelcomeOverlay';
    overlay.className = 'veyra-welcome-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML =
      '<section class="veyra-welcome-card" role="dialog" aria-modal="true" aria-labelledby="veyraWelcomeTitle">' +
        '<button class="veyra-welcome-close" id="veyraWelcomeCloseBtn" type="button" aria-label="Close welcome">×</button>' +
        '<div class="veyra-welcome-icon">🧭</div>' +
        '<div class="veyra-welcome-kicker">Welcome to Veyra</div>' +
        '<h2 id="veyraWelcomeTitle">Let’s get your budget ready</h2>' +
        '<p class="veyra-welcome-lede">This looks like a new budget. The setup wizard can guide you through the first useful version in a few minutes.</p>' +
        '<div class="veyra-welcome-grid">' +
          '<div><span>✓</span><strong>Add income</strong><small>Set your monthly baseline.</small></div>' +
          '<div><span>✓</span><strong>Configure categories</strong><small>Match Veyra to your real life.</small></div>' +
          '<div><span>✓</span><strong>Add costs</strong><small>Plan fixed and flexible spending.</small></div>' +
          '<div><span>✓</span><strong>Read insights</strong><small>Understand Overview and Smart Insights.</small></div>' +
        '</div>' +
        '<div class="veyra-welcome-actions">' +
          '<button class="veyra-welcome-skip" id="veyraWelcomeSkipBtn" type="button">Skip for now</button>' +
          '<button class="veyra-welcome-start" id="veyraWelcomeStartBtn" type="button">Start Setup</button>' +
        '</div>' +
        '<p class="veyra-welcome-note">You can reopen this anytime from the Setup Wizard / User Guide button.</p>' +
      '</section>';

    document.body.appendChild(overlay);

    document.getElementById('veyraWelcomeCloseBtn').addEventListener('click', dismissWelcome);
    document.getElementById('veyraWelcomeSkipBtn').addEventListener('click', dismissWelcome);
    document.getElementById('veyraWelcomeStartBtn').addEventListener('click', function(){
      var data = loadWelcome();
      data.started = true;
      data.dismissed = true;
      data.startedAt = new Date().toISOString();
      saveWelcome(data);
      closeWelcome();
      setTimeout(function(){
        if (typeof window.startVeyraSetupWizard === 'function') window.startVeyraSetupWizard(0);
        else if (typeof window.openVeyraGuide === 'function') window.openVeyraGuide('setup');
      }, 120);
    });

    overlay.addEventListener('click', function(event){
      if (event.target === overlay) dismissWelcome();
    });

    return overlay;
  }

  function openWelcome(){
    var overlay = ensureWelcomeDom();
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
  }

  function closeWelcome(){
    var overlay = document.getElementById('veyraWelcomeOverlay');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function dismissWelcome(){
    var data = loadWelcome();
    data.dismissed = true;
    data.dismissedAt = new Date().toISOString();
    saveWelcome(data);
    closeWelcome();
  }

  function maybeOpenWelcome(){
    var data = loadWelcome();
    if (data.dismissed || data.started || data.completed) return;

    var budget = getBudgetState();
    if (!budget.looksFresh) return;

    // Avoid colliding with another open onboarding modal.
    var guide = document.getElementById('guideOverlay');
    var wizard = document.getElementById('setupWizardOverlay');
    if (guide && guide.classList.contains('cbm-open')) return;
    if (wizard && wizard.classList.contains('is-open')) return;

    openWelcome();
  }

  document.addEventListener('DOMContentLoaded', function(){
    ensureWelcomeDom();
    setTimeout(maybeOpenWelcome, 900);
  });

  window.openVeyraWelcomeOnboarding = openWelcome;
})();




/* Wizard action navigation + Tools drawer close fix */
(function(){
  if (window.__veyraWizardActionNavigationFix) return;
  window.__veyraWizardActionNavigationFix = true;

  window.veyraWizardOpenView = function(viewName){
    if (!viewName) return false;

    if (typeof window.setActiveView === 'function') {
      try {
        window.setActiveView(viewName);
        return true;
      } catch(e) {}
    }

    var selectors = [
      '[data-view-btn="' + viewName + '"]',
      '[data-view="' + viewName + '"]',
      '#viewNav [data-view-btn][data-view="' + viewName + '"]'
    ];

    for (var i = 0; i < selectors.length; i++) {
      try {
        var btn = document.querySelector(selectors[i]);
        if (btn && typeof btn.click === 'function') {
          btn.click();
          return true;
        }
      } catch(e) {}
    }

    return false;
  };

  window.veyraCloseToolsDrawer = function(){
    document.body.classList.remove('tools-drawer-open');
    ['toolsDrawerBtn','contextToolsBtn'].forEach(function(id){
      var btn = document.getElementById(id);
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
    var drawer = document.getElementById('toolsDrawer');
    if (drawer) {
      drawer.setAttribute('aria-hidden', 'true');
      try { drawer.inert = true; } catch(e) { drawer.setAttribute('inert', ''); }
    }
  };

  document.addEventListener('click', function(event){
    var target = event.target && event.target.closest ? event.target.closest('button, a, [role="button"], input[type="file"]') : null;
    if (!target) return;
    if (target.closest('#toolsDrawer') || target.closest('.tools-drawer') || target.closest('.tools-panel')) {
      setTimeout(window.veyraCloseToolsDrawer, 120);
    }
  }, true);
})();

