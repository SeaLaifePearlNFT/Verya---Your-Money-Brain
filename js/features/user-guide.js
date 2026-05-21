(function() {
  'use strict';

  let GUIDE_KEY = 'veyra_guide_v1';   // localStorage: JSON { dismissed, manualDone: [] }

  // ── Persist helpers ──────────────────────────────────────────────────────
  function loadGuide() {
    try { let r = localStorage.getItem(GUIDE_KEY); return r ? JSON.parse(r) : {}; } catch(e) { return {}; }
  }
  function saveGuide(data) {
    try { localStorage.setItem(GUIDE_KEY, JSON.stringify(data)); } catch(e) {}
  }
  function isManualDone(key) {
    return (loadGuide().manualDone || []).indexOf(key) >= 0;
  }
  function setManualDone(key) {
    let g = loadGuide();
    g.manualDone = g.manualDone || [];
    if (g.manualDone.indexOf(key) < 0) g.manualDone.push(key);
    saveGuide(g);
  }
  function clearManualDone(key) {
    let g = loadGuide();
    g.manualDone = (g.manualDone || []).filter(function(k){ return k !== key; });
    saveGuide(g);
  }

  // ── Step completion detection ────────────────────────────────────────────
  // Each step defines an auto() fn (returns bool) and a manual fallback key.
  // done() = auto() || manualDone(key)
  function getState() {
    // Pull live state from the dashboard's global `state`
    let s = (typeof window.state !== 'undefined') ? window.state : null;
    let month = s && Array.isArray(s.months) ? (s.months.find(function(m){ return m && m.name === s.activeMonth; }) || s.months[0]) : null;
    let income   = month && Array.isArray(month.income)   ? month.income   : [];
    let expenses = month && Array.isArray(month.expenses)  ? month.expenses  : [];
    let subs = (s && Array.isArray(s.subscriptions)) ? s.subscriptions : [];
    let goals = month && Array.isArray(month.goals) ? month.goals : [];

    return { income: income, expenses: expenses, subs: subs, goals: goals, month: month };
  }

  let STEPS = [
    {
      key:   'income',
      label: '💰 Set your Income',
      auto:  function(st) {
        return st.income.some(function(r){ return Number(r.planned||0) > 0; });
      },
      desc:  '<strong>Income is the foundation of your budget.</strong> Go to the Income & Savings tab and set your planned monthly income for salary, freelance work, or any other source you receive regularly.',
      actions: [
        { label: 'Go to Income & Savings', view: 'income-savings' }
      ]
    },
    {
      key:   'expense-categories',
      label: '📂 Review your Expense Categories',
      auto:  null,   // hard to auto-detect meaningfully; user knows when they've reviewed
      desc:  '<strong>The dashboard comes pre-loaded with common expense categories.</strong> Open the Manage Structure panel in the Expenses tab to rename, delete, or add categories that match your actual spending.',
      actions: [
        { label: 'Go to Expenses', view: 'expenses' },
        { label: 'Open Manage Structure', fn: 'openExpenseStructure' }
      ]
    },
    {
      key:   'fixed-costs',
      label: '📌 Set your Fixed Monthly Costs',
      auto:  function(st) {
        return st.expenses.some(function(r){ return r.fixed && Number(r.planned||0) > 0; });
      },
      desc:  '<strong>Fixed costs are things that don\'t change month to month</strong> — rent, internet, insurance. Set a planned amount on any fixed expense row so your budget always accounts for them before you spend a cent.',
      actions: [
        { label: 'Go to Expenses', view: 'expenses' }
      ]
    },
    {
      key:   'non-cash',
      label: '🎁 Explore Non-Cash Benefits',
      auto:  function(st) {
        return st.income.some(function(r){ return r.name === 'Non-Cash Benefits' && Number(r.planned||0) > 0; });
      },
      desc:  '<strong>Do you receive meal vouchers, eco-cheques, or a mobility budget from your employer?</strong> These are Non-Cash Benefits — income that doesn\'t arrive as cash but still offsets real expenses.',
      info:  'Non-Cash Benefits appear as an Income row <em>and</em> an Expense row. The income side records what you receive; the expense side tracks what you spend it on. The net effect on your budget is neutral — but it correctly shows where that value goes.',
      actions: [
        { label: 'Go to Income & Savings', view: 'income-savings' }
      ]
    },
    {
      key:   'subscriptions',
      label: '🔁 Add your Subscriptions',
      auto:  function(st) { return st.subs.length > 0; },
      desc:  '<strong>Subscriptions are recurring charges that hit every month.</strong> The Subscriptions tab lets you track Netflix, Spotify, gym memberships, SaaS tools — anything you pay for regularly. They feed directly into your budget allocation.',
      actions: [
        { label: 'Go to Subscriptions', view: 'subscriptions' }
      ]
    },
    {
      key:   'first-expense',
      label: '📝 Log your First Expenses',
      auto:  function(st) {
        return st.expenses.some(function(r){ return Array.isArray(r.transactions) && r.transactions.length > 0; });
      },
      desc:  '<strong>Start tracking what you actually spend.</strong> You can log expenses manually from the Expenses tab, or import a bank CSV export for a full month in one go using the Import Bank CSV button in the sidebar.',
      actions: [
        { label: 'Go to Expenses', view: 'expenses' },
        { label: 'Import Bank CSV', fn: 'openCSVImport' }
      ]
    },
    {
      key:   'savings-goal',
      label: '🎯 Set a Savings Goal',
      auto:  function(st) { return Array.isArray(st.goals) && st.goals.length > 0; },
      desc:  '<strong>Goals give your budget a purpose.</strong> Whether it\'s a holiday, an emergency fund, or a big purchase — adding a goal to the Financial Goals tab lets the dashboard track your progress automatically each month.',
      actions: [
        { label: 'Go to Financial Goals', view: 'financial-goals' }
      ]
    },
    {
      key:   'analytics',
      label: '📊 Explore Smart Insights',
      auto:  null,
      desc:  '<strong>Once you\'ve logged a few expenses, the Smart Insights tab comes alive.</strong> Open it from the sidebar below Overview — it shows spending trends, category breakdowns, and month-over-month patterns.',
      actions: [
        { label: 'Open Smart Insights', fn: 'openSmartInsights' }
      ]
    }
  ];

  // ── Compute done state for all steps ─────────────────────────────────────
  function computeDone() {
    let st = getState();
    return STEPS.map(function(step) {
      let autoDone = step.auto ? step.auto(st) : false;
      return autoDone || isManualDone(step.key);
    });
  }

  // ── Build step HTML ───────────────────────────────────────────────────────
  function buildStepHtml(step, idx, done, open) {
    let numContent = done ? '✓' : String(idx + 1);
    // done and open are independent — both classes can be present simultaneously
    let classes = 'guide-step';
    if (done) classes += ' step-done';
    if (open) classes += ' step-open';

    let html = '<div class="' + classes + '" data-guide-step="' + idx + '">';

    // Header (always visible, always clickable)
    html += '<div class="guide-step-head">';
    html += '<div class="guide-step-num">' + numContent + '</div>';
    html += '<div class="guide-step-label">' + step.label + '</div>';
    html += '<div class="guide-step-chevron">▾</div>';
    html += '</div>';

    // Body (visible when open — works regardless of done state)
    html += '<div class="guide-step-body">';
    html += '<div class="guide-step-desc">' + step.desc + '</div>';

    // Info box (Non-Cash Benefits tooltip-style explainer)
    if (step.info) {
      html += '<div class="guide-info-box"><div class="guide-info-box-label">ℹ️ How it works</div>' + step.info + '</div>';
    }

    // Action buttons
    html += '<div class="guide-step-actions">';
    (step.actions || []).forEach(function(action, ai) {
      html += '<button class="guide-action-btn' + (ai > 0 ? ' secondary' : '') + '" ';
      if (action.view) html += 'data-guide-view="' + action.view + '"';
      if (action.fn)   html += 'data-guide-fn="' + action.fn + '"';
      html += '>' + action.label + '</button>';
    });

    // Done / Unmark controls
    let manuallyDone = isManualDone(step.key);
    if (!step.auto) {
      // Manual step: toggle between "Mark as done" and "Unmark"
      if (manuallyDone) {
        html += '<button class="guide-mark-done" data-guide-unmark="' + step.key + '">Unmark as done</button>';
      } else {
        html += '<button class="guide-mark-done" data-guide-markdone="' + step.key + '">Mark as done</button>';
      }
    } else if (done) {
      // Auto-detected as complete — show a soft "completed" note
      html += '<span class="guide-auto-done-note">✓ Completed automatically</span>';
    }
    html += '</div>'; // actions

    html += '</div>'; // body
    html += '</div>'; // step
    return html;
  }

  // ── Render ────────────────────────────────────────────────────────────────
  let _openStep = 0;

  function render() {
    let body = document.getElementById('guideBody');
    let bar  = document.getElementById('guideProgressBar');
    let line = document.getElementById('guideProgressLine');
    let note = document.getElementById('guideFooterNote');
    let title = document.getElementById('guideTitle');
    if (!body) return;

    let done = computeDone();
    let doneCount = done.filter(Boolean).length;
    let total = STEPS.length;
    let allDone = doneCount === total;

    // Progress bar
    if (bar) bar.style.width = Math.round(doneCount / total * 100) + '%';

    // Title & subtitle
    if (allDone) {
      if (title) title.textContent = 'You\'re all set 🎉';
      if (line)  line.textContent  = 'All ' + total + ' steps complete — your budget is ready.';
    } else {
      if (title) title.textContent = '👋 Welcome — let\'s get you started';
      if (line)  line.textContent  = doneCount + ' of ' + total + ' steps complete';
    }
    if (note) note.textContent = doneCount + '/' + total + ' complete';

    if (allDone) {
      body.innerHTML = '<div class="guide-all-done">'
        + '<div class="guide-all-done-emoji">🎉</div>'
        + '<div class="guide-all-done-title">Your budget is set up!</div>'
        + '<div class="guide-all-done-sub">You can re-open this guide any time via the User Guide button.</div>'
        + '</div>';
      return;
    }

    // Build step list
    let html = '';
    STEPS.forEach(function(step, idx) {
      html += buildStepHtml(step, idx, done[idx], idx === _openStep);
    });
    body.innerHTML = html;

    // Wire step heads
    body.querySelectorAll('.guide-step-head').forEach(function(head) {
      head.addEventListener('click', function() {
        let idx = parseInt(head.parentElement.dataset.guideStep, 10);
        _openStep = (_openStep === idx) ? -1 : idx;
        render();
      });
    });

    // Wire action buttons
    body.querySelectorAll('[data-guide-view]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        let viewName = btn.dataset.guideView;
        // Use the dashboard's own setActiveView if available
        if (typeof window.setActiveView === 'function') window.setActiveView(viewName);
        else {
          let navBtn = document.querySelector('[data-view-btn="' + viewName + '"]');
          if (navBtn) navBtn.click();
        }
        closeGuide();
      });
    });

    body.querySelectorAll('[data-guide-fn]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        let fn = btn.dataset.guideFn;
        if (fn === 'openExpenseStructure') {
          // Click the Manage Expenses button if present, else navigate to expenses
          let mb = document.getElementById('manageExpensesBtn');
          if (mb) { closeGuide(); if (typeof window.setActiveView === 'function') window.setActiveView('expenses'); setTimeout(function(){ mb.click(); }, 150); }
          else { if (typeof window.setActiveView === 'function') window.setActiveView('expenses'); closeGuide(); }
        } else if (fn === 'openCSVImport') {
          closeGuide();
          if (typeof window.setActiveView === 'function') window.setActiveView('expenses');
          setTimeout(function(){
            let f = document.getElementById('csvImportFile');
            if (f) f.click();
          }, 150);
        } else if (fn === 'openSmartInsights' || fn === 'openAnalytics') {
          closeGuide();
          if (typeof window.openSmartInsightsWorkspace === 'function') {
            setTimeout(window.openSmartInsightsWorkspace, 150);
          } else if (typeof window.setActiveView === 'function') {
            window.setActiveView('smart-insights');
          }
        }
      });
    });

    // Wire mark-done and unmark buttons
    body.querySelectorAll('[data-guide-markdone]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        setManualDone(btn.dataset.guideMarkdone);
        render();
      });
    });
    body.querySelectorAll('[data-guide-unmark]').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        clearManualDone(btn.dataset.guideUnmark);
        render();
      });
    });
  }

  // ── Open / close ──────────────────────────────────────────────────────────
  function openGuide() {
    let o = document.getElementById('guideOverlay');
    if (o) { o.classList.add('cbm-open'); o.setAttribute('aria-hidden', 'false'); }
    _openStep = 0;
    render();
  }
  function closeGuide() {
    let o = document.getElementById('guideOverlay');
    if (o) { o.classList.remove('cbm-open'); o.setAttribute('aria-hidden', 'true'); }
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function() {
    // Wire User Guide button
    let guideBtn = document.getElementById('userGuideBtn');
    if (guideBtn) guideBtn.addEventListener('click', openGuide);

    // Wire close/dismiss
    let closeBtn   = document.getElementById('guideCloseBtn');
    let dismissBtn = document.getElementById('guideDismissBtn');
    if (closeBtn)   closeBtn.addEventListener('click',   closeGuide);
    if (dismissBtn) dismissBtn.addEventListener('click', function() {
      let g = loadGuide(); g.dismissed = true; saveGuide(g);
      closeGuide();
    });

    // Close on overlay backdrop click
    let overlay = document.getElementById('guideOverlay');
    if (overlay) overlay.addEventListener('click', function(e) {
      if (e.target === overlay) closeGuide();
    });

    // Auto-open on first visit to Overview (only if never dismissed)
    let g = loadGuide();
    if (!g.dismissed) {
      // Wait for the dashboard to finish its own init, then open
      setTimeout(openGuide, 600);
    }

    // Re-render when state changes (income/expenses updated) so badges stay live
    // Piggyback on the existing render cycle by polling lightly while open
    setInterval(function() {
      let overlay = document.getElementById('guideOverlay');
      if (overlay && overlay.classList.contains('cbm-open')) render();
    }, 2000);
  });

})();
