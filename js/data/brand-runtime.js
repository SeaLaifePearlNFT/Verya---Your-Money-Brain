(function () {
  const brand = window.APP_BRAND || {};
  const browserTitle = brand.browserTitle || brand.appName || "Budget Tracker";
  const appName = brand.appName || browserTitle;
  const tagline = brand.tagline || "";

  document.title = browserTitle;

  const brandNameEl = document.querySelector("[data-brand-name]");
  if (brandNameEl) brandNameEl.textContent = appName;

  const brandTaglineEl = document.querySelector("[data-brand-tagline]");
  if (brandTaglineEl) brandTaglineEl.textContent = tagline;
})();


/* v1310 — Smart Insights workspace routing.
   The old Analytics modal has been retired; legacy names are kept only as
   compatibility aliases for older guide actions and saved markup. */
(function(){
  function openSmartInsightsWorkspace(){
    let month = (typeof getActiveMonth === 'function') ? getActiveMonth() : null;
    if (typeof setActiveView === 'function') {
      setActiveView('smart-insights');
    }
    if (month && typeof renderInsights === 'function') {
      try { renderInsights(month); } catch(e) { console.error('Smart Insights render failed', e); }
    }
    if (typeof applyInsightOrder === 'function') applyInsightOrder();
    let grid = document.getElementById('insightGrid');
    if (grid) {
      delete grid.dataset.igDragWired;
      if (typeof wireInsightDrag === 'function') wireInsightDrag();
    }
    if (typeof alignSmartInsightCards === 'function') requestAnimationFrame(alignSmartInsightCards);
    if (month && typeof refreshSmartInsightsPhase2 === 'function') refreshSmartInsightsPhase2(month);
  }

  function closeSmartInsightsWorkspace(){
    /* Smart Insights is a tab, not a modal; retained for compatibility. */
  }

  window.openSmartInsightsWorkspace = openSmartInsightsWorkspace;
  window.closeSmartInsightsWorkspace = closeSmartInsightsWorkspace;
  window.openOverviewAnalyticsModal = openSmartInsightsWorkspace;
  window.closeOverviewAnalyticsModal = closeSmartInsightsWorkspace;

  document.addEventListener('click', function(evt){
    let openBtn = evt.target.closest && evt.target.closest('.smart-insights-open-btn, .overview-analytics-btn, [data-open-smart-insights]');
    if (openBtn) {
      evt.preventDefault();
      evt.stopPropagation();
      openSmartInsightsWorkspace();
    }
  });
})();

/* === Decision Simulator Modal JS === */
(function() {
  'use strict';

  function dsSimulatorOverlay() {
    return document.getElementById('dsSimulatorOverlay');
  }

  function openDecisionSimulatorModal() {
    const overlay = dsSimulatorOverlay();
    if (!overlay) return;

    // Render the DS card into the modal body
    const body = document.getElementById('dsSimulatorBody');
    if (body) {
      body.innerHTML = '';
      const month = (typeof window.getActiveMonth === 'function') ? window.getActiveMonth() : null;
      const safeMonth = month || { scenario: null, goals: [], income: [], savings: [], expenses: [] };
      let cardEl;
      try {
        if (typeof window.renderDecisionSimulator === 'function') {
          cardEl = window.renderDecisionSimulator(safeMonth, body);
        }
      } catch (e) {
        console.error('DS modal render failed', e);
        cardEl = null;
      }
      if (cardEl) {
        body.appendChild(cardEl);
      } else {
        body.innerHTML = '<div style="padding:24px;color:var(--muted);font-size:0.85rem;">Add income, savings, and expenses to generate smart scenarios.</div>';
      }
    }

    overlay.classList.add('cbm-open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('ds-modal-open');

    // Focus the close button for accessibility
    const closeBtn = overlay.querySelector('[data-close-ds-simulator]');
    if (closeBtn && typeof closeBtn.focus === 'function') {
      closeBtn.focus({ preventScroll: true });
    }
  }

  function closeDecisionSimulatorModal() {
    const overlay = dsSimulatorOverlay();
    if (!overlay) return;
    overlay.classList.remove('cbm-open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('ds-modal-open');
  }

  window.openDecisionSimulatorModal  = openDecisionSimulatorModal;
  window.closeDecisionSimulatorModal = closeDecisionSimulatorModal;

  // Wire the trigger button
  function wireDsSimulatorModal() {
    const btn = document.getElementById('dsSimulatorBtn');
    if (btn && !btn.dataset.dsSimWired) {
      btn.dataset.dsSimWired = 'true';
      btn.addEventListener('click', function(evt) {
        evt.preventDefault();
        evt.stopPropagation();
        openDecisionSimulatorModal();
      });
    }
    document.querySelectorAll('[data-close-ds-simulator]').forEach(function(el) {
      if (el.dataset.dsSimCloseWired) return;
      el.dataset.dsSimCloseWired = 'true';
      el.addEventListener('click', function(evt) {
        evt.preventDefault();
        closeDecisionSimulatorModal();
      });
    });
  }

  // Delegate click handler — backdrop close + button trigger
  document.addEventListener('click', function(evt) {
    if (evt.target.closest && evt.target.closest('#dsSimulatorBtn')) {
      evt.preventDefault();
      evt.stopPropagation();
      openDecisionSimulatorModal();
      return;
    }
    if (evt.target.closest && evt.target.closest('[data-close-ds-simulator]')) {
      evt.preventDefault();
      closeDecisionSimulatorModal();
      return;
    }
    const overlay = dsSimulatorOverlay();
    if (overlay && overlay.classList.contains('cbm-open') && evt.target === overlay) {
      closeDecisionSimulatorModal();
    }
  });

  // Escape key
  document.addEventListener('keydown', function(evt) {
    if (evt.key === 'Escape') {
      const overlay = dsSimulatorOverlay();
      if (overlay && overlay.classList.contains('cbm-open')) {
        closeDecisionSimulatorModal();
      }
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireDsSimulatorModal);
  } else {
    wireDsSimulatorModal();
  }
})();
/* === end Decision Simulator Modal JS === */

