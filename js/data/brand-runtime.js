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


